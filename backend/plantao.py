"""Plantão noturno: agente que aborda assinantes parados de madrugada, dentro do app, só nas criadoras ligadas.

Tudo aqui fica atrás da permissão especial 'plantao' (concedida só pelo dono da conta). Quem não tem a permissão
não vê configuração, relatório nem o que foi enviado; a tentativa de acesso vai para o registro de atividade.
O agente nunca responde ao fã: só manda a abertura. Quando o fã responde, a conversa vai para as Oportunidades do
chatter (quem não tem a permissão vê a etiqueta neutra "Voltou a falar").
"""
from datetime import datetime, timedelta
from typing import Optional, Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from core import db, now, iso, uid, audit, perm, has_perm, expiration

router = APIRouter()
PERM = 'plantao'
plantao_user = perm(PERM)
DEFAULT_OPENERS = [
    'oi, sumido… tá tudo bem por aí?',
    'acordei pensando em você 😏 sumiu por quê?',
    'ei, faz tempo que você não aparece aqui…',
    'tô sem sono… me faz companhia?',
    'você some e eu fico aqui curiosa, hein',
]

class Filters(BaseModel):
    model_config = ConfigDict(extra='forbid')
    inactive_days: int = Field(default=7, ge=1, le=90)     # assinante sem mensagem há X dias
    never_messaged: bool = True                             # nunca mandou mensagem
    ghosted: bool = True                                    # a criadora respondeu por último e ele sumiu
    min_spent_cents: Optional[int] = Field(default=None, ge=0)  # já gastou pelo menos R$ (None = não filtra)
    never_spent: bool = False                               # incluir quem nunca gastou (se False e min_spent None, ambos entram)
    skip_dismissed: bool = True                             # pula "dispensar" das Oportunidades
    skip_with_notes: bool = True                            # pula quem tem anotação da equipe

class ConfigIn(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    enabled: bool = False
    window_start: str = Field(default='03:00', pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    window_end: str = Field(default='08:00', pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    days: list[int] = Field(default=[0, 1, 2, 3, 4, 5, 6], max_length=7)  # 0 = segunda … 6 = domingo
    only_without_shift: bool = True
    per_hour: int = Field(default=8, ge=1, le=30)
    gap_min: int = Field(default=2, ge=1, le=30)   # minutos
    gap_max: int = Field(default=6, ge=1, le=60)
    cooldown_days: int = Field(default=7, ge=1, le=90)  # 1 abordagem por fã a cada Z dias
    mode: Literal['list', 'ai'] = 'list'           # 'list' = só as aberturas aprovadas; 'ai' = gera na persona (módulo autônomo)
    after_reply: Literal['handoff', 'hold'] = 'handoff'  # handoff = entrega ao chatter; hold = módulo autônomo segura a conversa até hold_max respostas
    hold_max: int = Field(default=2, ge=1, le=5)
    openers: list[str] = Field(default_factory=lambda: list(DEFAULT_OPENERS), max_length=40)
    filters: Filters = Field(default_factory=Filters)
    @field_validator('days')
    @classmethod
    def valid_days(cls, v):
        if any(d < 0 or d > 6 for d in v): raise ValueError('Dia da semana inválido.')
        return sorted(set(v))
    @field_validator('openers')
    @classmethod
    def valid_openers(cls, v):
        out = [o.strip()[:300] for o in v if o and o.strip()]
        return out

class SentIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    creator_id: str
    fan_ref: str = Field(max_length=120)
    fan_name: Optional[str] = Field(default=None, max_length=80)
    text: str = Field(max_length=400)
    platform: str = 'privacy'
class RepliedIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    creator_id: str
    fan_ref: str = Field(max_length=120)
class RunIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    creator_id: str
    event: Literal['start', 'stop', 'skip', 'error']
    detail: Optional[str] = Field(default=None, max_length=300)

def defaults(): return ConfigIn().model_dump()

async def all_configs():
    rows = await db.plantao_configs.find({}, {'_id': 0}).to_list(2000)
    return {r['creator_id']: r for r in rows}

def today_br():
    return (now() - timedelta(hours=3)).date().isoformat()

async def night_stats(since_hours=24):
    """Por criadora: abordagens e respostas nas últimas N horas."""
    since = (now() - timedelta(hours=since_hours)).isoformat()
    out = {}
    async for r in db.plantao_log.find({'sent_at': {'$gt': since}}, {'_id': 0, 'creator_id': 1, 'replied_at': 1}):
        s = out.setdefault(r['creator_id'], {'sent': 0, 'replied': 0})
        s['sent'] += 1
        if r.get('replied_at'): s['replied'] += 1
    return out

@router.get('/plantao')
async def overview(user=Depends(plantao_user)):
    creators = await db.creators.find({'deleted_at': None}, {'_id': 0, 'id': 1, 'name': 1, 'avatar': 1}).sort('name', 1).to_list(1000)
    configs, stats = await all_configs(), await night_stats()
    shifts = {s['creator_id'] for s in await db.shifts.find({'active': True}, {'_id': 0, 'creator_id': 1}).to_list(1000)}
    runs = {r['creator_id']: r for r in await db.plantao_runs.find({}, {'_id': 0}).to_list(2000)}
    td = today_br()
    rows = []
    for c in creators:
        cfg = configs.get(c['id']) or {}
        rows.append({'creator_id': c['id'], 'name': c['name'], 'avatar': c.get('avatar'), 'enabled': bool(cfg.get('enabled')),
            'paused_today': cfg.get('paused_day') == td, 'window': f"{cfg.get('window_start', '03:00')}–{cfg.get('window_end', '08:00')}" if cfg else None,
            'in_shift': c['id'] in shifts, 'stats': stats.get(c['id'], {'sent': 0, 'replied': 0}), 'last_run': runs.get(c['id'])})
    return {'creators': rows, 'defaults': defaults(), 'today': td}

@router.get('/plantao/{creator_id}')
async def get_config(creator_id: str, user=Depends(plantao_user)):
    cfg = await db.plantao_configs.find_one({'creator_id': creator_id}, {'_id': 0})
    return cfg or {**defaults(), 'creator_id': creator_id}

@router.put('/plantao/{creator_id}')
async def put_config(creator_id: str, body: ConfigIn, user=Depends(plantao_user)):
    creator = await db.creators.find_one({'id': creator_id, 'deleted_at': None}, {'_id': 0, 'name': 1})
    if not creator: raise HTTPException(404, 'Criadora não encontrada.')
    if body.gap_min > body.gap_max: raise HTTPException(422, 'O intervalo mínimo não pode ser maior que o máximo.')
    if body.mode == 'list' and not body.openers: raise HTTPException(422, 'Cadastre pelo menos uma abertura ou mude para geração pela persona.')
    old = await db.plantao_configs.find_one({'creator_id': creator_id}, {'_id': 0}) or {}
    doc = {**body.model_dump(), 'creator_id': creator_id, 'updated_at': iso(), 'updated_by': user['id'], 'paused_day': old.get('paused_day')}
    await db.plantao_configs.update_one({'creator_id': creator_id}, {'$set': doc}, upsert=True)
    if old.get('enabled') != body.enabled: await audit(user, 'Plantão noturno ' + ('ligado' if body.enabled else 'desligado'), creator['name'])
    return {'ok': True}

@router.post('/plantao/{creator_id}/toggle')
async def toggle(creator_id: str, user=Depends(plantao_user)):
    creator = await db.creators.find_one({'id': creator_id, 'deleted_at': None}, {'_id': 0, 'name': 1})
    if not creator: raise HTTPException(404, 'Criadora não encontrada.')
    old = await db.plantao_configs.find_one({'creator_id': creator_id}, {'_id': 0})
    if not old: old = {**defaults(), 'creator_id': creator_id}
    enabled = not old.get('enabled')
    await db.plantao_configs.update_one({'creator_id': creator_id}, {'$set': {**old, 'enabled': enabled, 'updated_at': iso(), 'updated_by': user['id']}}, upsert=True)
    await audit(user, 'Plantão noturno ' + ('ligado' if enabled else 'desligado'), creator['name'])
    return {'ok': True, 'enabled': enabled}

@router.post('/plantao/{creator_id}/pause')
async def pause_today(creator_id: str, user=Depends(plantao_user)):
    """Pausa só hoje (a configuração continua)."""
    cfg = await db.plantao_configs.find_one({'creator_id': creator_id}, {'_id': 0})
    if not cfg: raise HTTPException(404, 'Esta criadora ainda não tem plantão configurado.')
    td = today_br(); paused = cfg.get('paused_day') != td
    await db.plantao_configs.update_one({'creator_id': creator_id}, {'$set': {'paused_day': td if paused else None}})
    return {'ok': True, 'paused_today': paused}

@router.get('/plantao/log/list')
async def log(days: int = 7, creator_id: str = '', user=Depends(plantao_user)):
    since = (now() - timedelta(days=max(1, min(days, 90)))).isoformat()
    q = {'sent_at': {'$gt': since}}
    if creator_id: q['creator_id'] = creator_id
    rows = await db.plantao_log.find(q, {'_id': 0}).sort('sent_at', -1).to_list(2000)
    return rows

# ---- rotas do app (token da extensão) ----
async def app_user(request: Request):
    from extension_routes import extension_user
    user = await extension_user(request)
    if not has_perm(user, PERM): raise HTTPException(403, 'Sem permissão para o plantão.')
    return user

async def candidates(cfg, recent, noted, dismissed, limit=40, stats=None):
    """Quem abordar, pelo histórico do painel (radar + eventos), não pela lista da Privacy: a lista mostra 'última mensagem
    hoje' para todo mundo por causa dos disparos em massa. Conta os dias desde a última mensagem DO FÃ.
    `stats` (dict) recebe a contagem de quem ficou de fora e por quê — para o painel mostrar 'por que a fila está vazia'."""
    f = cfg.get('filters') or {}; cid = cfg['creator_id']; t = now()
    cutoff = (t - timedelta(days=int(f.get('inactive_days') or 7))).isoformat()
    st = stats if stats is not None else {}
    for k in ['radar', 'sem_historico', 'falou_recente', 'abordado', 'com_nota', 'dispensado', 'sumiu_desligado', 'gasto', 'sem_nome']: st[k] = 0
    # última mensagem do fã: fan_last_at (radar) ou início de uma resposta/pendência registrada (eventos)
    last = {}
    async for e in db.events.aggregate([{'$match': {'creator_id': cid, 'kind': {'$in': ['response', 'pending']}, 'fan_ref': {'$ne': None}}}, {'$group': {'_id': '$fan_ref', 'at': {'$max': '$started_at'}}}]):
        if e.get('at'): last[e['_id']] = e['at']
    st['eventos'] = len(last)
    out = []
    async for r in db.fan_radar.find({'creator_id': cid, 'platform': 'privacy'}, {'_id': 0, 'fan_ref': 1, 'fan_name': 1, 'cid': 1, 'spent_cents': 1, 'last_from': 1, 'last_at': 1, 'fan_last_at': 1, 'first_seen_at': 1}):
        ref = r['fan_ref']; st['radar'] += 1
        fla = max([x for x in [r.get('fan_last_at'), last.get(ref), r.get('last_at') if r.get('last_from') == 'fan' else None] if x] or [None])
        basis = 'fan'
        if not fla:
            # sem registro de mensagem do fã. Se a última da conversa é NOSSA e é antiga, o fã não fala desde antes dela
            # (limite superior seguro). Se "incluir quem nunca mandou mensagem" está ligado, vale quem o radar acompanha há
            # mais tempo que o filtro sem nunca ter visto o fã escrever (os disparos em massa deixam a última sempre nossa).
            if r.get('last_from') == 'us' and r.get('last_at') and r['last_at'] <= cutoff: fla, basis = r['last_at'], 'ours'
            elif f.get('never_messaged') and r.get('first_seen_at') and r['first_seen_at'] <= cutoff: fla, basis = r['first_seen_at'], 'never'
            else: st['sem_historico'] += 1; continue
        if fla > cutoff: st['falou_recente'] += 1; continue
        if ref in recent: st['abordado'] += 1; continue
        if ref in noted and f.get('skip_with_notes', True): st['com_nota'] += 1; continue
        if f.get('skip_dismissed', True) and (cid, ref) in dismissed: st['dispensado'] += 1; continue
        ghosted = r.get('last_from') == 'us'
        if not f.get('ghosted', True) and ghosted: st['sumiu_desligado'] += 1; continue
        spent = int(r.get('spent_cents') or 0)
        if f.get('never_spent'):
            if spent > 0: st['gasto'] += 1; continue
        elif f.get('min_spent_cents') is not None and spent < f['min_spent_cents']: st['gasto'] += 1; continue
        try: days = max(0, (t - datetime.fromisoformat(fla)).days)
        except ValueError: st['sem_historico'] += 1; continue
        if not r.get('fan_name'): st['sem_nome'] += 1; continue
        # prioridade: quem já falou (sumiu depois da resposta) > última do fã conhecida > nunca visto escrevendo; gasto desempata
        out.append({'fan_ref': ref, 'name': r.get('fan_name'), 'rid': r.get('cid'), 'days': days, 'spent_cents': spent, 'ghosted': ghosted, 'basis': basis,
            'score': (1000 if ghosted and basis != 'never' else 0) + (-500 if basis == 'never' else 0) + min(spent, 100000) / 100})
    out.sort(key=lambda x: -x['score'])
    st['fila'] = len(out)
    return out[:limit]

async def exclusions(creator_id, cfg):
    """Conjuntos que tiram um fã da fila: abordado dentro do intervalo, com anotação, dispensado nos últimos 30 dias."""
    since = (now() - timedelta(days=cfg.get('cooldown_days', 7))).isoformat()
    since30 = (now() - timedelta(days=30)).isoformat()
    recent = await db.plantao_log.find({'creator_id': creator_id, 'sent_at': {'$gt': since}}, {'_id': 0, 'fan_ref': 1}).to_list(5000)
    noted = await db.fan_notes.find({'creator_id': creator_id}, {'_id': 0, 'fan_ref': 1}).to_list(5000)
    dismissed = await db.opportunities.find({'creator_id': creator_id, 'status': 'dismissed', 'dismissed_at': {'$gt': since30}}, {'_id': 0, 'fan_ref': 1}).to_list(5000)
    return {r['fan_ref'] for r in recent}, {n['fan_ref'] for n in noted}, {(creator_id, d['fan_ref']) for d in dismissed}

@router.get('/plantao/{creator_id}/preview')
async def preview(creator_id: str, user=Depends(plantao_user)):
    """Quem entraria na fila agora com a configuração salva, e quantos ficaram de fora por cada motivo."""
    cfg = await db.plantao_configs.find_one({'creator_id': creator_id}, {'_id': 0}) or {**defaults(), 'creator_id': creator_id}
    rset, nset, dset = await exclusions(creator_id, cfg)
    st = {}
    items = await candidates(cfg, rset, nset, dset, limit=40, stats=st)
    return {'items': items, 'stats': st, 'filters': cfg.get('filters') or {}, 'cooldown_days': cfg.get('cooldown_days', 7)}

@router.get('/extension/plantao')
async def app_configs(user=Depends(app_user)):
    """Configurações das criadoras ligadas + fãs já abordados recentemente (para o app respeitar o intervalo por fã)."""
    configs = [c for c in (await all_configs()).values() if c.get('enabled')]
    td = today_br()
    since30 = (now() - timedelta(days=30)).isoformat()
    dismissed = await db.opportunities.find({'status': 'dismissed', 'dismissed_at': {'$gt': since30}}, {'_id': 0, 'creator_id': 1, 'fan_ref': 1}).to_list(20000)
    dset = {(d['creator_id'], d['fan_ref']) for d in dismissed}
    out = []
    for c in configs:
        if c.get('paused_day') == td: continue
        since = (now() - timedelta(days=c.get('cooldown_days', 7))).isoformat()
        recent = await db.plantao_log.find({'creator_id': c['creator_id'], 'sent_at': {'$gt': since}}, {'_id': 0, 'fan_ref': 1}).to_list(5000)
        noted = await db.fan_notes.find({'creator_id': c['creator_id']}, {'_id': 0, 'fan_ref': 1}).to_list(5000)
        rset, nset = {r['fan_ref'] for r in recent}, {n['fan_ref'] for n in noted}
        out.append({**c, 'recent_fans': sorted(rset), 'noted_fans': sorted(nset), 'candidates': await candidates(c, rset, nset, dset)})
    return {'configs': out, 'dismissed': [[d['creator_id'], d['fan_ref']] for d in dismissed], 'server_time': iso()}

@router.post('/extension/plantao/sent')
async def app_sent(body: SentIn, user=Depends(app_user)):
    creator = await db.creators.find_one({'id': body.creator_id}, {'_id': 0, 'name': 1})
    row = {'id': uid(), 'creator_id': body.creator_id, 'creator_name': creator['name'] if creator else '?', 'fan_ref': body.fan_ref, 'fan_name': body.fan_name,
        'platform': body.platform, 'text': body.text, 'sent_at': iso(), 'replied_at': None, 'by_user': user['id'], 'expires_at': await expiration()}
    await db.plantao_log.insert_one(row.copy())
    return {'ok': True, 'id': row['id']}

@router.post('/extension/plantao/replied')
async def app_replied(body: RepliedIn, user=Depends(app_user)):
    r = await db.plantao_log.find_one({'creator_id': body.creator_id, 'fan_ref': body.fan_ref, 'replied_at': None}, {'_id': 0}, sort=[('sent_at', -1)])
    if r:
        await db.plantao_log.update_one({'id': r['id']}, {'$set': {'replied_at': iso()}})
        await mark_opportunity(body.creator_id, body.fan_ref, r.get('fan_name'), r.get('platform') or 'privacy', hot=False)
    return {'ok': True, 'matched': bool(r)}

async def mark_opportunity(creator_id, fan_ref, fan_name, platform, hot):
    """Oportunidade 'Voltou a falar' para o chatter assumir. O motivo real (abordagem do plantão) só aparece para quem
    tem a permissão; os demais veem a etiqueta neutra (ver my_opportunities em radar.py)."""
    creator = await db.creators.find_one({'id': creator_id}, {'_id': 0, 'name': 1})
    t = now(); hm = (t - timedelta(hours=3)).strftime('%Hh%M')
    doc = {'creator_name': creator['name'] if creator else '?', 'fan_name': fan_name, 'platform': platform, 'kind': 'voltou', 'reason': f'Voltou a falar às {hm}',
        'plantao': True, 'plantao_at': iso(), 'hot': hot, 'status': 'open', 'due_at': (t + timedelta(hours=18)).isoformat(), 'expires_at': await expiration()}
    await db.opportunities.update_one({'creator_id': creator_id, 'fan_ref': fan_ref, 'ref': f'plantao:{fan_ref}'},
        {'$set': doc, '$setOnInsert': {'id': uid(), 'creator_id': creator_id, 'fan_ref': fan_ref, 'ref': f'plantao:{fan_ref}', 'value_cents': 0, 'source_at': iso(), 'created_at': iso()}}, upsert=True)

# ---- contrato do módulo autônomo (// ALTA AUTO: implementado no Emergent) ----
class Msg(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ours: bool
    text: str = Field(max_length=400)
class ReplyIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    creator_id: str
    fan_ref: str = Field(max_length=120)
    fan_name: Optional[str] = Field(default=None, max_length=80)
    msgs: list[Msg] = Field(max_length=8)   # últimas mensagens, já mascaradas pelo app (sem e-mail/telefone/@/links)
    hold_count: int = Field(default=0, ge=0, le=10)

@router.post('/extension/plantao/reply')
async def app_reply(body: ReplyIn, user=Depends(app_user)):
    """Modo 'segurar a conversa'. Contrato: devolve {'stop': True, 'reason': str} para entregar ao chatter ou
    {'stop': False, 'text': str} com a próxima mensagem. Enquanto o módulo autônomo não está instalado, sempre entrega."""
    await mark_opportunity(body.creator_id, body.fan_ref, body.fan_name, 'privacy', hot=False)
    return {'stop': True, 'reason': 'módulo autônomo não instalado'}

@router.post('/extension/plantao/run')
async def app_run(body: RunIn, user=Depends(app_user)):
    """Estado do plantão por criadora (o painel mostra 'rodou ontem às 03:00 no PC do Paulo' ou 'PC dormiu')."""
    await db.plantao_runs.update_one({'creator_id': body.creator_id}, {'$set': {'creator_id': body.creator_id, 'event': body.event, 'detail': body.detail, 'at': iso(), 'user': user['name']}}, upsert=True)
    return {'ok': True}

async def replied_refs(creator_ids, hours=18):
    """Para as Oportunidades: fãs que responderam à abordagem nas últimas horas → {(creator_id, fan_ref): replied_at}."""
    since = (now() - timedelta(hours=hours)).isoformat()
    rows = await db.plantao_log.find({'creator_id': {'$in': list(creator_ids)}, 'replied_at': {'$gt': since}}, {'_id': 0, 'creator_id': 1, 'fan_ref': 1, 'replied_at': 1}).to_list(5000)
    return {(r['creator_id'], r['fan_ref']): r['replied_at'] for r in rows}
