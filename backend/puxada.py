"""Lote 118 — Puxar conversa: frase curtinha, com contexto, para o fã que está ONLINE agora e com a conversa parada.

Separado da automação de resposta e do plantão noturno: chave própria por criadora (painel → Puxar conversa).
Todas as travas ficam AQUI no servidor, então valem para o botão do chatter e para qualquer disparador futuro:
  - criadora ligada, sem pausa automática, dentro da janela de horário;
  - no máximo N puxadas por hora (enviadas + reservadas);
  - 1 puxada por fã a cada X horas; quem não respondeu a uma puxada fica 3 dias sem outra;
  - nunca para quem está esperando resposta (última mensagem é dele), falou há pouco, está bloqueado para a IA
    ou tem mídia paga aguardando entrega;
  - cada frase sai com uma autorização (token) que vence em 10 min; o envio só conta com o token;
  - pausa sozinha se 15 puxadas seguidas (com 2 h+ de chance) ficarem sem resposta, ou com 3 erros de envio seguidos.
Quem responde vira a oportunidade "Voltou a falar" para o chatter assumir.
"""
from datetime import timedelta
from typing import Literal
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from core import db, now, iso, uid, manager, audit, is_staff, WORKSPACE
from schemas import Strict
from extension_routes import extension_user

router = APIRouter()
BR = ZoneInfo('America/Sao_Paulo')
CLAIM_MIN = 10            # validade da autorização (min)
NO_REPLY_DAYS = 3         # puxada sem resposta: fã fica X dias sem outra
PAUSE_STREAK = 15         # sem resposta seguidas → pausa
PAUSE_ERRORS = 3          # erros de envio seguidos → pausa
HM = r'^([01]\d|2[0-3]):[0-5]\d$'


class ConfigIn(Strict):
    enabled: bool = False
    per_hour: int = Field(default=6, ge=1, le=30)
    window_start: str = Field(default='09:00', pattern=HM)
    window_end: str = Field(default='23:30', pattern=HM)
    cooldown_hours: int = Field(default=24, ge=6, le=168)
    idle_hours: int = Field(default=4, ge=1, le=48)        # fã que falou há menos que isso está em conversa: não puxa
    auto: bool = False                                      # envio automático (disparador do Grok) — só o dono liga

def defaults(): return ConfigIn().model_dump()

async def get_cfg(creator_id):
    c = await db.puxada_configs.find_one({'creator_id': creator_id}, {'_id': 0})
    return {**defaults(), **(c or {}), 'creator_id': creator_id}

def _hm(s): h, m = s.split(':'); return int(h) * 60 + int(m)
def in_window(cfg, t=None):
    t = (t or now()).astimezone(BR); cur = t.hour * 60 + t.minute
    s, e = _hm(cfg['window_start']), _hm(cfg['window_end'])
    return s <= cur < e if s <= e else (cur >= s or cur < e)

async def used_last_hour(creator_id):
    since = (now() - timedelta(hours=1)).isoformat()
    sent = await db.puxada_log.count_documents({'creator_id': creator_id, 'sent_at': {'$gt': since}})
    held = await db.puxada_claims.count_documents({'creator_id': creator_id, 'status': 'aberta', 'expires_at': {'$gt': now()}})
    return sent + held

async def excluded(creator_id, cfg):
    """fan_ref → motivo, para quem não pode receber puxada agora (o app tira da lista; /line confere de novo)."""
    t = now(); out = {}
    since_cd = (t - timedelta(hours=cfg['cooldown_hours'])).isoformat()
    since_nr = (t - timedelta(days=NO_REPLY_DAYS)).isoformat()
    async for r in db.puxada_log.find({'creator_id': creator_id, 'sent_at': {'$gt': min(since_cd, since_nr)}}, {'_id': 0, 'fan_ref': 1, 'sent_at': 1, 'replied_at': 1}):
        if r['sent_at'] > since_cd: out[r['fan_ref']] = 'já recebeu puxada há pouco'
        elif not r.get('replied_at'): out.setdefault(r['fan_ref'], 'não respondeu à última puxada')
    async for r in db.puxada_claims.find({'creator_id': creator_id, 'status': 'aberta', 'expires_at': {'$gt': t}}, {'_id': 0, 'fan_ref': 1}):
        out[r['fan_ref']] = 'puxada em andamento'
    async for r in db.assist_blocked.find({'creator_id': creator_id}, {'_id': 0, 'fan_ref': 1}):
        out[r['fan_ref']] = 'bloqueado para a IA'
    async for r in db.media_requests.find({'creator_id': creator_id, 'status': 'aguardando'}, {'_id': 0, 'fan_ref': 1}):
        out[r['fan_ref']] = 'mídia paga aguardando entrega'
    idle = (t - timedelta(hours=cfg['idle_hours'])).isoformat()
    async for r in db.fan_radar.find({'creator_id': creator_id, '$or': [{'fan_last_at': {'$gt': idle}}, {'last_from': 'fan', 'last_at': {'$gt': idle}}]}, {'_id': 0, 'fan_ref': 1}):
        out.setdefault(r['fan_ref'], 'conversou há pouco')
    return out

async def auto_pause(creator_id, reason):
    await db.puxada_configs.update_one({'creator_id': creator_id}, {'$set': {'paused_reason': reason, 'paused_at': iso()}}, upsert=True)
    creator = await db.creators.find_one({'id': creator_id}, {'_id': 0, 'name': 1}) or {}
    await audit({'id': 'sistema', 'name': 'Sistema', 'role': 'system'}, 'Puxar conversa pausado automaticamente', creator.get('name') or creator_id, None, reason)

async def check_streak(creator_id):
    """15 puxadas seguidas (todas com 2 h+ de chance de resposta) sem nenhuma resposta → pausa."""
    cut = (now() - timedelta(hours=2)).isoformat()
    rows = await db.puxada_log.find({'creator_id': creator_id, 'sent_at': {'$lt': cut}}, {'_id': 0, 'replied_at': 1, 'sent_at': 1}).sort('sent_at', -1).limit(PAUSE_STREAK).to_list(PAUSE_STREAK)
    cfg = await db.puxada_configs.find_one({'creator_id': creator_id}, {'_id': 0, 'resumed_at': 1}) or {}
    if cfg.get('resumed_at'): rows = [r for r in rows if r['sent_at'] > cfg['resumed_at']]  # religou: conta do zero
    if len(rows) >= PAUSE_STREAK and not any(r.get('replied_at') for r in rows):
        await auto_pause(creator_id, f'{PAUSE_STREAK} puxadas seguidas sem resposta')
        return True
    return False


# ---------------- painel (gestor) ----------------
async def stats(hours=24):
    since = (now() - timedelta(hours=hours)).isoformat(); out = {}
    async for r in db.puxada_log.find({'sent_at': {'$gt': since}}, {'_id': 0, 'creator_id': 1, 'replied_at': 1, 'sold_cents': 1}):
        s = out.setdefault(r['creator_id'], {'sent': 0, 'replied': 0})
        s['sent'] += 1
        if r.get('replied_at'): s['replied'] += 1
    return out

@router.get('/puxada')
async def overview(user=Depends(manager)):
    creators = await db.creators.find({'deleted_at': None}, {'_id': 0, 'id': 1, 'name': 1, 'avatar': 1}).sort('name', 1).to_list(1000)
    cfgs = {c['creator_id']: c for c in await db.puxada_configs.find({}, {'_id': 0}).to_list(2000)}
    st24, st7 = await stats(24), await stats(24 * 7)
    rows = []
    for c in creators:
        cfg = {**defaults(), **(cfgs.get(c['id']) or {})}
        rows.append({'creator_id': c['id'], 'name': c['name'], 'avatar': c.get('avatar'), 'enabled': bool(cfg.get('enabled')), 'auto': bool(cfg.get('auto')),
                     'paused_reason': cfg.get('paused_reason'), 'paused_at': cfg.get('paused_at'), 'per_hour': cfg['per_hour'],
                     'window': f"{cfg['window_start']}–{cfg['window_end']}", 'day': st24.get(c['id'], {'sent': 0, 'replied': 0}), 'week': st7.get(c['id'], {'sent': 0, 'replied': 0})})
    return {'creators': rows, 'defaults': defaults()}

@router.get('/puxada/{creator_id}')
async def get_config(creator_id: str, user=Depends(manager)):
    return await get_cfg(creator_id)

@router.put('/puxada/{creator_id}')
async def put_config(creator_id: str, body: ConfigIn, user=Depends(manager)):
    creator = await db.creators.find_one({'id': creator_id, 'deleted_at': None}, {'_id': 0, 'name': 1})
    if not creator: raise HTTPException(404, 'Criadora não encontrada.')
    old = await get_cfg(creator_id)
    doc = body.model_dump()
    if doc['auto'] != bool(old.get('auto')) and not user.get('owner'): raise HTTPException(403, 'Só o dono da conta liga ou desliga o envio automático.')
    doc.update({'updated_at': iso(), 'updated_by': user['id']})
    if doc['enabled'] and not old.get('enabled'): doc.update({'paused_reason': None, 'paused_at': None, 'resumed_at': iso(), 'errors': 0})
    await db.puxada_configs.update_one({'creator_id': creator_id}, {'$set': doc}, upsert=True)
    if bool(old.get('enabled')) != body.enabled: await audit(user, 'Puxar conversa ' + ('ligado' if body.enabled else 'desligado'), creator['name'])
    if bool(old.get('auto')) != body.auto: await audit(user, 'Puxar conversa: envio automático ' + ('ligado' if body.auto else 'desligado'), creator['name'])
    return {'ok': True}

@router.post('/puxada/{creator_id}/toggle')
async def toggle(creator_id: str, user=Depends(manager)):
    """Liga/desliga. Ligar de novo também tira a pausa automática (e a contagem recomeça)."""
    creator = await db.creators.find_one({'id': creator_id, 'deleted_at': None}, {'_id': 0, 'name': 1})
    if not creator: raise HTTPException(404, 'Criadora não encontrada.')
    cfg = await get_cfg(creator_id)
    on = not cfg.get('enabled') or bool(cfg.get('paused_reason'))
    upd = {'enabled': on, 'updated_at': iso(), 'updated_by': user['id']}
    if on: upd.update({'paused_reason': None, 'paused_at': None, 'resumed_at': iso(), 'errors': 0})
    base = {k: v for k, v in cfg.items() if k in defaults()}
    await db.puxada_configs.update_one({'creator_id': creator_id}, {'$set': {**base, **upd}}, upsert=True)
    if not on: await db.puxada_claims.update_many({'creator_id': creator_id, 'status': 'aberta'}, {'$set': {'status': 'cancelada', 'closed_at': iso()}})
    await audit(user, 'Puxar conversa ' + ('ligado' if on else 'desligado'), creator['name'])
    return {'ok': True, 'enabled': on}

@router.get('/puxada/log/list')
async def log_list(days: int = 7, creator_id: str = '', user=Depends(manager)):
    since = (now() - timedelta(days=max(1, min(days, 60)))).isoformat()
    q = {'sent_at': {'$gt': since}}
    if creator_id: q['creator_id'] = creator_id
    return await db.puxada_log.find(q, {'_id': 0, 'expires_at': 0}).sort('sent_at', -1).to_list(2000)


# ---------------- app ----------------
async def _app_cfgs(user):
    rows = [c for c in await db.puxada_configs.find({'enabled': True}, {'_id': 0}).to_list(2000)]
    if not is_staff(user): rows = [c for c in rows if c['creator_id'] in (user.get('creator_ids') or [])]
    return rows

@router.get('/extension/puxada')
async def app_state(user=Depends(extension_user)):
    """Criadoras ligadas que esta pessoa atende + quem não pode receber puxada agora (o app monta a lista de online)."""
    out = []
    for c in await _app_cfgs(user):
        cfg = {**defaults(), **c}
        used = await used_last_hour(c['creator_id'])
        ex = await excluded(c['creator_id'], cfg)
        out.append({'creator_id': c['creator_id'], 'per_hour': cfg['per_hour'], 'used_hour': used, 'left_hour': max(0, cfg['per_hour'] - used),
                    'in_window': in_window(cfg), 'window': f"{cfg['window_start']}–{cfg['window_end']}", 'paused_reason': cfg.get('paused_reason'),
                    'auto': bool(cfg.get('auto')), 'excluded': ex})
    return {'configs': out, 'server_time': iso()}

class LineIn(Strict):
    creator_id: str = Field(min_length=1, max_length=80)
    fan_ref: str = Field(pattern=r'^[a-f0-9]{64}$')
    fan_name: str = Field(default='', max_length=80)
    platform: Literal['privacy', 'fatalfans', 'onlyfans'] = 'privacy'
    messages: list[dict] = Field(default_factory=list, max_length=16)
    auto: bool = False   # pedido do disparador automático (só passa com a chave "envio automático" ligada)

@router.post('/extension/puxada/line')
async def line(body: LineIn, user=Depends(extension_user)):
    """Confere todas as travas e, se puder, devolve a frase + a autorização (token) para este fã."""
    from fans import can_see
    await can_see(user, body.creator_id)
    cfg = await get_cfg(body.creator_id)
    def no(reason): return {'ok': False, 'reason': reason}
    if not cfg.get('enabled'): return no('Puxar conversa está desligado para esta criadora.')
    if cfg.get('paused_reason'): return no(f"Pausado: {cfg['paused_reason']}. Um gestor religa no painel.")
    if body.auto and not cfg.get('auto'): return no('Envio automático desligado para esta criadora.')
    if not in_window(cfg): return no(f"Fora do horário ({cfg['window_start']}–{cfg['window_end']}).")
    if await check_streak(body.creator_id): return no(f'{PAUSE_STREAK} puxadas seguidas sem resposta: pausado. Um gestor religa no painel.')
    if await used_last_hour(body.creator_id) >= cfg['per_hour']: return no(f"Limite de {cfg['per_hour']} puxadas por hora atingido.")
    ex = await excluded(body.creator_id, cfg)
    if body.fan_ref in ex: return no(ex[body.fan_ref][:1].upper() + ex[body.fan_ref][1:] + '.')
    msgs = [{'ours': bool(m.get('ours')), 'text': str(m.get('text') or '')[:1200]} for m in body.messages if str(m.get('text') or '').strip()]
    if msgs and not msgs[-1]['ours']: return no('Ele está esperando resposta: use o Sugerir resposta.')
    from assist import suggest, SuggestIn
    out = await suggest(SuggestIn(creator_id=body.creator_id, fan_ref=body.fan_ref, messages=msgs[-14:], mode='puxada', platform=body.platform), user)
    if not out or out.get('alert'): return no((out or {}).get('reason') or 'A IA não sugeriu nada.')
    text = str(out.get('text') or '').strip()
    if not text: return no('A IA não sugeriu nada.')
    t = now(); token = uid()
    await db.puxada_claims.insert_one({'token': token, 'creator_id': body.creator_id, 'fan_ref': body.fan_ref, 'fan_name': body.fan_name, 'platform': body.platform,
                                       'text': text, 'auto': body.auto, 'user_id': user['id'], 'user_name': user['name'], 'status': 'aberta',
                                       'created_at': t.isoformat(), 'expires_at': t + timedelta(minutes=CLAIM_MIN)})
    return {'ok': True, 'text': text, 'token': token, 'valid_min': CLAIM_MIN, 'remaining': out.get('remaining')}

class SentIn(Strict):
    token: str = Field(min_length=10, max_length=40)
    text: str = Field(default='', max_length=600)   # o que foi enviado de fato (o chatter pode ter mexido)

@router.post('/extension/puxada/sent')
async def sent(body: SentIn, user=Depends(extension_user)):
    cl = await db.puxada_claims.find_one_and_update({'token': body.token, 'status': 'aberta', 'expires_at': {'$gt': now()}},
                                                    {'$set': {'status': 'enviada', 'closed_at': iso()}}, projection={'_id': 0})
    if not cl: raise HTTPException(409, 'Autorização vencida ou já usada.')
    creator = await db.creators.find_one({'id': cl['creator_id']}, {'_id': 0, 'name': 1}) or {}
    row = {'id': uid(), 'creator_id': cl['creator_id'], 'creator_name': creator.get('name') or '?', 'fan_ref': cl['fan_ref'], 'fan_name': cl.get('fan_name') or None,
           'platform': cl.get('platform') or 'privacy', 'suggested': cl['text'], 'text': (body.text or cl['text'])[:600], 'auto': bool(cl.get('auto')),
           'sent_at': iso(), 'replied_at': None, 'by_user': user['id'], 'by_name': user['name'], 'expires_at': now() + timedelta(days=120)}
    await db.puxada_log.insert_one(dict(row))
    await db.puxada_configs.update_one({'creator_id': cl['creator_id']}, {'$set': {'errors': 0}})
    return {'ok': True, 'id': row['id']}

class TokenIn(Strict):
    token: str = Field(min_length=10, max_length=40)
    detail: str = Field(default='', max_length=200)

@router.post('/extension/puxada/cancel')
async def cancel(body: TokenIn, user=Depends(extension_user)):
    await db.puxada_claims.update_one({'token': body.token, 'status': 'aberta'}, {'$set': {'status': 'cancelada', 'closed_at': iso(), 'detail': body.detail}})
    return {'ok': True}

@router.post('/extension/puxada/error')
async def error(body: TokenIn, user=Depends(extension_user)):
    """O disparador não conseguiu enviar: devolve a vaga; 3 erros seguidos pausam a criadora."""
    cl = await db.puxada_claims.find_one_and_update({'token': body.token}, {'$set': {'status': 'erro', 'closed_at': iso(), 'detail': body.detail}}, projection={'_id': 0})
    if not cl: return {'ok': True}
    r = await db.puxada_configs.find_one_and_update({'creator_id': cl['creator_id']}, {'$inc': {'errors': 1}}, projection={'_id': 0, 'errors': 1}, return_document=True)
    if r and (r.get('errors') or 0) >= PAUSE_ERRORS: await auto_pause(cl['creator_id'], f'{PAUSE_ERRORS} erros de envio seguidos ({body.detail[:80]})')
    return {'ok': True}

class RepliedIn(Strict):
    creator_id: str = Field(min_length=1, max_length=80)
    fan_ref: str = Field(pattern=r'^[a-f0-9]{64}$')

@router.post('/extension/puxada/replied')
async def replied(body: RepliedIn, user=Depends(extension_user)):
    since = (now() - timedelta(hours=48)).isoformat()
    r = await db.puxada_log.find_one({'creator_id': body.creator_id, 'fan_ref': body.fan_ref, 'replied_at': None, 'sent_at': {'$gt': since}}, {'_id': 0}, sort=[('sent_at', -1)])
    if not r: return {'ok': True, 'matched': False}
    await db.puxada_log.update_one({'id': r['id']}, {'$set': {'replied_at': iso()}})
    t = now(); hm = t.astimezone(BR).strftime('%Hh%M')
    await db.opportunities.update_one({'creator_id': body.creator_id, 'fan_ref': body.fan_ref, 'ref': f'puxada:{body.fan_ref}'},
        {'$set': {'creator_name': r.get('creator_name'), 'fan_name': r.get('fan_name'), 'platform': r.get('platform') or 'privacy', 'kind': 'voltou',
                  'reason': f'Respondeu à puxada às {hm} · continue a conversa', 'hot': False, 'status': 'open', 'due_at': (t + timedelta(hours=12)).isoformat(),
                  'expires_at': t + timedelta(days=30)},
         '$setOnInsert': {'id': uid(), 'value_cents': 0, 'source_at': iso(), 'created_at': iso(), 'workspace_id': WORKSPACE}}, upsert=True)
    return {'ok': True, 'matched': True}
