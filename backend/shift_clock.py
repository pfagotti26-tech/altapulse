"""Relógio dos turnos: 10h–19h e 19h–03h (horário de Brasília).
5 min depois do fim o app do chatter pergunta se ele continua. Sim → informa até que horas (o turno passa a
terminar nesse horário). Não ou sem resposta em 1 min → o app encerra os turnos de todas as criadoras dele.
Se o app estiver fechado ou o computador desligado, o painel encerra sozinho 6 min depois do fim.
"""
import asyncio, logging
from datetime import datetime, timedelta, timezone
from typing import Literal
from fastapi import HTTPException
from core import db, now, iso, lock, audit, expiration, clean_time
from schemas import Strict

BRT = timezone(timedelta(hours=-3))
ASK_AFTER = timedelta(minutes=5)       # o app pergunta 5 min depois do fim
SERVER_AFTER = timedelta(minutes=6)    # o painel encerra se ninguém respondeu (app fechado)
PROMPT_GRACE = timedelta(minutes=4)    # com a pergunta na tela: 1 min para Sim/Não + 1 min para o horário + folga
MAX_EXTEND = timedelta(hours=12)
SYSTEM = {'id': 'system', 'name': 'Alta Pulse (automático)'}
REASONS = {'nao': 'Turno encerrado (chatter respondeu que não continua)', 'sem_resposta': 'Turno encerrado automaticamente (sem resposta)',
    'automatico': 'Turno encerrado automaticamente (app fechado ou sem resposta)'}

def planned_end(started_at: str) -> datetime:
    """Fim previsto pelo horário de início: 10h–19h ou 19h–03h. Quem entra até 30 min antes já conta no turno seguinte."""
    t = datetime.fromisoformat(started_at).astimezone(BRT)
    h = t.hour + t.minute / 60
    base = t.replace(hour=0, minute=0, second=0, microsecond=0)
    if h < 3: end = base + timedelta(hours=3)
    elif h < 18.5: end = base + timedelta(hours=19)
    else: end = base + timedelta(days=1, hours=3)
    return end.astimezone(timezone.utc)

def ends_at(shift) -> str:
    return shift.get('extended_until') or planned_end(shift['started_at']).isoformat()

def decorate(shift):
    if shift and shift.get('active'): shift['ends_at'] = ends_at(shift)
    return shift

async def end_shifts(query, reason, actor):
    """Encerra os turnos ativos que casam com a busca; devolve os nomes das criadoras."""
    names = []
    for shift in await db.shifts.find({**query, 'active': True}, {'_id': 0}).to_list(200):
        done = await db.shifts.update_one({'id': shift['id'], 'active': True}, {'$set': {'ended_at': iso(), 'active': False, 'paused': False,
            'ended_reason': reason, 'expires_at': await expiration()}})
        if done.modified_count:
            names.append(shift['creator_name'])
            await audit(actor, REASONS.get(reason, 'Turno encerrado'), shift['creator_name'], {'chatter': shift['operator_name'], 'previsto': ends_at(shift)})
    return names

async def sweep():
    """Encerra turnos esquecidos: 6 min depois do fim, ou 4 min depois de a pergunta aparecer sem resposta."""
    t = now(); overdue = []
    for shift in await db.shifts.find({'active': True}, {'_id': 0}).to_list(500):
        end = datetime.fromisoformat(ends_at(shift))
        deadline = end + SERVER_AFTER
        if shift.get('prompt_at') and datetime.fromisoformat(shift['prompt_at']) >= end: deadline = max(deadline, datetime.fromisoformat(shift['prompt_at']) + PROMPT_GRACE)
        if t >= deadline: overdue.append(shift['id'])
    if overdue:
        async with lock: await end_shifts({'id': {'$in': overdue}}, 'automatico', SYSTEM)
    return len(overdue)

_last = {'at': None}
async def sweep_soon():
    """Varredura barata chamada pelas listagens (caso o processo tenha dormido); no máximo 1x a cada 30 s."""
    if _last['at'] and now() - _last['at'] < timedelta(seconds=30): return
    _last['at'] = now()
    try: await sweep()
    except Exception: logging.exception('varredura de turnos')

_radar_tick = 0
async def sweep_loop():
    global _radar_tick
    while True:
        try: await sweep()
        except Exception: logging.exception('varredura de turnos')
        try:
            from team_live import purge_expired
            await purge_expired()
            from password_reset import purge as purge_resets
            await purge_resets()
        except Exception: logging.exception('lixeira de criadoras')
        # radar de oportunidades: regras por tempo (ofertas, assinantes novos, esfriando) a cada ~10 min
        _radar_tick = (_radar_tick + 1) % 10
        if _radar_tick == 1:
            try:
                from radar import sweep as radar_sweep
                await radar_sweep()
            except Exception: logging.exception('radar de oportunidades')
        try:
            from content import goal_tick
            await goal_tick()  # metas de posts: alertas às 14h e 19h, registro do dia às 23h50
        except Exception: logging.exception('metas de conteúdo')
        await asyncio.sleep(60)

class ExtendIn(Strict):
    until: datetime
class EndMineIn(Strict):
    reason: Literal['nao', 'sem_resposta']

async def mine(user): return await db.shifts.find({'operator_id': user['id'], 'active': True}, {'_id': 0}).to_list(200)

async def prompt_shown(user):
    """O app avisa que a pergunta apareceu: o painel espera a resposta antes de encerrar sozinho."""
    await db.shifts.update_many({'operator_id': user['id'], 'active': True}, {'$set': {'prompt_at': iso()}})
    return {'ok': True}

async def extend_mine(body: ExtendIn, user):
    until = datetime.fromisoformat(clean_time(body.until))
    if until <= now() + timedelta(minutes=1): raise HTTPException(422, 'Informe um horário depois de agora.')
    if until > now() + MAX_EXTEND: raise HTTPException(422, 'No máximo 12 horas a partir de agora.')
    shifts = await mine(user)
    if not shifts: raise HTTPException(404, 'Nenhum turno ativo.')
    async with lock:
        await db.shifts.update_many({'operator_id': user['id'], 'active': True}, {'$set': {'extended_until': until.isoformat(), 'prompt_at': None}})
    hm = until.astimezone(BRT).strftime('%H:%M')
    for s in shifts: await audit(user, f'Turno estendido até {hm}', s['creator_name'])
    return {'ok': True, 'ends_at': until.isoformat(), 'creators': [s['creator_name'] for s in shifts]}

async def end_mine(body: EndMineIn, user):
    async with lock: names = await end_shifts({'operator_id': user['id']}, body.reason, user)
    return {'ok': True, 'ended': names}
