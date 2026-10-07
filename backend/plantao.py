"""Plantão noturno: agente que aborda assinantes parados de madrugada, dentro do app, só nas criadoras ligadas.

Tudo aqui fica atrás da permissão especial 'plantao' (concedida só pelo dono da conta). Quem não tem a permissão
não vê configuração, relatório nem o que foi enviado; a tentativa de acesso vai para o registro de atividade.
O agente nunca responde ao fã: só manda a abertura. Quando o fã responde, a conversa vai para as Oportunidades do
chatter (quem não tem a permissão vê a etiqueta neutra "Voltou a falar").
"""
from datetime import timedelta
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
    mode: Literal['list', 'ai'] = 'list'           # 'list' = só as aberturas aprovadas; 'ai' = gera na persona (só abertura)
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

@router.get('/extension/plantao')
async def app_configs(user=Depends(app_user)):
    """Configurações das criadoras ligadas + fãs já abordados recentemente (para o app respeitar o intervalo por fã)."""
    configs = [c for c in (await all_configs()).values() if c.get('enabled')]
    td = today_br()
    out = []
    for c in configs:
        if c.get('paused_day') == td: continue
        since = (now() - timedelta(days=c.get('cooldown_days', 7))).isoformat()
        recent = await db.plantao_log.find({'creator_id': c['creator_id'], 'sent_at': {'$gt': since}}, {'_id': 0, 'fan_ref': 1}).to_list(5000)
        out.append({**c, 'recent_fans': sorted({r['fan_ref'] for r in recent})})
    since = (now() - timedelta(days=30)).isoformat()
    dismissed = await db.opportunities.find({'status': 'dismissed', 'dismissed_at': {'$gt': since}}, {'_id': 0, 'creator_id': 1, 'fan_ref': 1}).to_list(20000)
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
    r = await db.plantao_log.find_one({'creator_id': body.creator_id, 'fan_ref': body.fan_ref, 'replied_at': None}, {'_id': 0, 'id': 1}, sort=[('sent_at', -1)])
    if r: await db.plantao_log.update_one({'id': r['id']}, {'$set': {'replied_at': iso()}})
    return {'ok': True, 'matched': bool(r)}

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
