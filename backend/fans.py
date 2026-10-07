"""Bloco D: CRM de assinantes, montado a partir das vendas do extrato (que trazem o nome de exibição do
assinante quando a opção "guardar nome do assinante" está ligada) e das ofertas do chat.
Só gestor. Sem texto de mensagem: nome, valores, datas e produtos.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import re
from typing import Optional, Literal
from pydantic import Field
from fastapi import APIRouter, Depends, HTTPException
from core import db, now, iso, uid, staff, is_staff, settings, clean_time, audit
from schemas import Strict

router = APIRouter()
BR = ZoneInfo('America/Sao_Paulo')

# passo 2: lista de assinantes lida no Meu Privacy → Assinantes (situação, preço e duração)
class SubscriberRow(Strict):
    fan_ref: str = Field(pattern=r'^[a-f0-9]{64}$')
    fan_name: Optional[str] = Field(default=None, max_length=80)
    status: str = Field(default='', max_length=40)
    price_cents: Optional[int] = Field(default=None, ge=0, le=10000000)
    duration: str = Field(default='', max_length=40)
class SubscribersIn(Strict):
    creator_id: str
    platform: Optional[Literal['privacy', 'fatalfans', 'closefans', 'onlyfans']] = None
    taken_at: datetime
    total_label: str = Field(default='', max_length=40)
    revenue_cents: Optional[int] = Field(default=None, ge=0)
    rows: list[SubscriberRow] = Field(max_length=3000)

def is_active(status):
    t = (status or '').lower()
    return None if not t else not re.search(r'inativ|expir|cancel|venc|encerr', t) and bool(re.search(r'ativ|vigent|em dia', t))

async def save_subscribers(body: SubscribersIn, user):
    config = await settings()
    if not config.get('storage_allowed'): raise HTTPException(409, 'Armazenamento de métricas desabilitado.')
    if not await db.creators.find_one({'id': body.creator_id}): raise HTTPException(404, 'Criadora não cadastrada.')
    if not is_staff(user) and body.creator_id not in user['creator_ids']: raise HTTPException(403, 'Criadora não autorizada.')
    seen = clean_time(body.taken_at); names = bool(config.get('fan_names_allowed'))
    for r in body.rows:
        await db.subscribers.update_one({'creator_id': body.creator_id, 'fan_ref': r.fan_ref},
            {'$set': {'fan_name': r.fan_name if names else None, 'status': r.status, 'active': is_active(r.status), 'price_cents': r.price_cents,
                'duration': r.duration, 'platform': body.platform or 'privacy', 'seen_at': seen, 'expires_at': now() + timedelta(days=400)}, '$setOnInsert': {'first_seen_at': seen}}, upsert=True)
    label_key = 'subscribers_label' if (body.platform or 'privacy') == 'privacy' else f'subscribers_label_{body.platform}'
    await db.creators.update_one({'id': body.creator_id}, {'$set': {'subscribers_read_at': seen, label_key: body.total_label}})
    return {'ok': True, 'saved': len(body.rows)}

@router.get('/fans')
async def fans(creator_id: str = None, days: int = 90, user=Depends(staff)):
    days = max(7, min(days, 365))
    config = await settings()
    since = (now() - timedelta(days=days)).isoformat()
    query = {'kind': {'$in': ['sale', 'offer']}, 'expires_at': {'$gt': now()}, 'fan_ref': {'$ne': None}}
    if creator_id: query['creator_id'] = creator_id
    rows = await db.events.find(query, {'_id': 0, 'creator_id': 1, 'kind': 1, 'fan_ref': 1, 'fan_name': 1, 'amount_cents': 1, 'confirmed_at': 1, 'offered_at': 1, 'sale_status': 1, 'sale_origin': 1, 'offer_status': 1, 'payment_method': 1}).to_list(50000)
    creators = {c['id']: c['name'] for c in await db.creators.find({}, {'_id': 0, 'id': 1, 'name': 1}).to_list(1000)}
    fans = {}
    for r in rows:
        key = (r['creator_id'], r['fan_ref'])
        f = fans.setdefault(key, {'creator_id': r['creator_id'], 'creator_name': creators.get(r['creator_id'], '?'), 'fan_ref': r['fan_ref'], 'fan_name': None,
            'total_cents': 0, 'purchases': 0, 'chat_cents': 0, 'subscription_cents': 0, 'post_cents': 0, 'tip_cents': 0, 'refunded_cents': 0,
            'first_at': None, 'last_at': None, 'last_product': None, 'offers_sent': 0, 'offers_paid': 0, 'payment_methods': {}})
        if r.get('fan_name'): f['fan_name'] = r['fan_name']
        if r['kind'] == 'sale':
            at = r.get('confirmed_at')
            if r.get('sale_status') in ['refunded', 'cancelled']: f['refunded_cents'] += r['amount_cents']; continue
            if at and at < since: continue
            f['total_cents'] += r['amount_cents']; f['purchases'] += 1
            f[{'chat': 'chat_cents', 'subscription': 'subscription_cents', 'renewal': 'subscription_cents', 'post': 'post_cents', 'tip': 'tip_cents'}.get(r.get('sale_origin'), 'chat_cents')] += r['amount_cents']
            if at:
                if not f['first_at'] or at < f['first_at']: f['first_at'] = at
                if not f['last_at'] or at > f['last_at']: f['last_at'] = at; f['last_product'] = r.get('sale_origin')
            pm = r.get('payment_method') or '?'; f['payment_methods'][pm] = f['payment_methods'].get(pm, 0) + 1
        else:
            if r.get('offered_at') and r['offered_at'] < since: continue
            f['offers_sent'] += 1
            if r.get('offer_status') == 'paid': f['offers_paid'] += 1
    subs_q = {'expires_at': {'$gt': now()}}
    if creator_id: subs_q['creator_id'] = creator_id
    for sub in await db.subscribers.find(subs_q, {'_id': 0}).to_list(20000):
        key = (sub['creator_id'], sub['fan_ref'])
        f = fans.get(key)
        if not f:
            f = fans[key] = {'creator_id': sub['creator_id'], 'creator_name': creators.get(sub['creator_id'], '?'), 'fan_ref': sub['fan_ref'], 'fan_name': sub.get('fan_name'),
                'total_cents': 0, 'purchases': 0, 'chat_cents': 0, 'subscription_cents': 0, 'post_cents': 0, 'tip_cents': 0, 'refunded_cents': 0,
                'first_at': None, 'last_at': None, 'last_product': None, 'offers_sent': 0, 'offers_paid': 0, 'payment_methods': {}}
        if sub.get('fan_name') and not f['fan_name']: f['fan_name'] = sub['fan_name']
        f.update({'sub_status': sub.get('status'), 'sub_active': sub.get('active'), 'sub_price_cents': sub.get('price_cents'), 'sub_duration': sub.get('duration'), 'sub_first_seen': sub.get('first_seen_at')})
    out = [f for f in fans.values() if f['purchases'] or f['offers_sent'] or f.get('sub_status')]
    today = now()
    by_creator = {}
    for f in out: by_creator.setdefault(f['creator_id'], {})[f['fan_ref']] = f['total_cents']
    tier_map = {cid: tiers_for(t) for cid, t in by_creator.items()}
    notes_count = {}
    async for n in db.fan_notes.find({'creator_id': creator_id} if creator_id else {}, {'_id': 0, 'creator_id': 1, 'fan_ref': 1}):
        k = (n['creator_id'], n['fan_ref']); notes_count[k] = notes_count.get(k, 0) + 1
    for f in out:
        last = datetime.fromisoformat(f['last_at']) if f['last_at'] else None
        f['days_since_last'] = (today - last).days if last else None
        f['segment'] = ('sumiu' if f['days_since_last'] is not None and f['days_since_last'] >= 30 and f['purchases'] else
                        'novo' if f['first_at'] and (today - datetime.fromisoformat(f['first_at'])).days <= 7 else
                        'vip' if f['total_cents'] >= 30000 else 'ativo' if f['purchases'] else
                        'sem_compra' if f.get('sub_active') else 'inativo' if f.get('sub_active') is False else 'so_ofertas')
        # assinatura inativa de quem já comprou: risco de perder o fã
        f['churn_risk'] = f.get('sub_active') is False and f['purchases'] > 0
        f['tier'] = tier_map.get(f['creator_id'], {}).get(f['fan_ref'])
        sub = {'active': f.get('sub_active'), 'first_seen_at': f.get('sub_first_seen')} if f.get('sub_status') else None
        f['tags'] = state_tags(f['tier'], f['days_since_last'], f['purchases'], sub, today)
        f['notes_count'] = notes_count.get((f['creator_id'], f['fan_ref']), 0)
        f['ticket_cents'] = round(f['total_cents'] / f['purchases']) if f['purchases'] else None
    out.sort(key=lambda f: -f['total_cents'])
    segments = {}
    for f in out: segments[f['segment']] = segments.get(f['segment'], 0) + 1
    segments['risco'] = sum(1 for f in out if f.get('churn_risk'))
    segments['baleia'] = sum(1 for f in out if f.get('tier') == 'baleia')
    segments['spender'] = sum(1 for f in out if f.get('tier') == 'spender')
    for tag in ['esfriando', 'dormente', 'novo_sem_compra']: segments[tag] = sum(1 for f in out if tag in f.get('tags', []))
    segments['assinantes_ativos'] = sum(1 for f in out if f.get('sub_active'))
    return {'fans': out[:2000], 'count': len(out), 'segments': segments, 'fan_names_allowed': bool(config.get('fan_names_allowed')), 'days': days,
        'total_cents': sum(f['total_cents'] for f in out)}


# ---------- faixas relativas por criadora (padrão de mercado: top 5% baleias, próximos 15% spenders) ----------
import math
def tiers_for(totals):
    """totals: {fan_ref: cents} de uma criadora → {fan_ref: 'baleia'|'spender'|'comum'}"""
    ranked = sorted([k for k, v in totals.items() if v > 0], key=lambda k: -totals[k])
    n = len(ranked); whales = max(1, math.ceil(n * 0.05)) if n else 0; spenders = math.ceil(n * 0.20) if n else 0
    return {k: ('baleia' if i < whales else 'spender' if i < max(spenders, whales) else 'comum') for i, k in enumerate(ranked)}

def state_tags(tier, days_since, purchases, sub, today):
    tags = []
    if tier in ['baleia', 'spender'] and days_since is not None and 10 <= days_since < 30: tags.append('esfriando')
    if purchases and days_since is not None and days_since >= 30: tags.append('dormente')
    if not purchases and sub and sub.get('active') and sub.get('first_seen_at') and (today - datetime.fromisoformat(sub['first_seen_at'])).days <= 3: tags.append('novo_sem_compra')
    if sub and sub.get('active') is False and purchases: tags.append('assinatura_inativa')
    return tags

HOURS = [(0, 6, 'de madrugada'), (6, 12, 'de manhã'), (12, 18, 'à tarde'), (18, 24, 'à noite')]
def money_br(c): return 'R$ ' + f"{c/100:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')

async def fan_card(creator_id, fan_ref, user_id=None):
    today = now(); since = (today - timedelta(days=90)).isoformat()
    sales = await db.events.find({'creator_id': creator_id, 'kind': 'sale', 'expires_at': {'$gt': today}, 'fan_ref': {'$ne': None}, 'sale_status': {'$nin': ['refunded', 'cancelled']}},
        {'_id': 0, 'fan_ref': 1, 'fan_name': 1, 'amount_cents': 1, 'confirmed_at': 1, 'sale_origin': 1}).to_list(50000)
    totals = {}
    for s in sales:
        if (s.get('confirmed_at') or '') >= since: totals[s['fan_ref']] = totals.get(s['fan_ref'], 0) + s['amount_cents']
    mine = sorted([s for s in sales if s['fan_ref'] == fan_ref], key=lambda s: s.get('confirmed_at') or '', reverse=True)
    sub = await db.subscribers.find_one({'creator_id': creator_id, 'fan_ref': fan_ref}, {'_id': 0})
    offers = await db.events.find({'creator_id': creator_id, 'kind': 'offer', 'fan_ref': fan_ref, 'offer_status': 'sent', 'expires_at': {'$gt': today}}, {'_id': 0, 'amount_cents': 1, 'offered_at': 1, 'offer_type': 1, 'media_type': 1}).sort('offered_at', -1).to_list(5)
    notes = await db.fan_notes.find({'creator_id': creator_id, 'fan_ref': fan_ref}, {'_id': 0}).sort('created_at', -1).to_list(30)
    # tempo de resposta com este fã (30 dias): da primeira mensagem dele sem resposta até a resposta
    since30 = (today - timedelta(days=30)).isoformat()
    resp = await db.events.find({'creator_id': creator_id, 'kind': 'response', 'fan_ref': fan_ref, 'expires_at': {'$gt': today}, 'responded_at': {'$gte': since30}},
        {'_id': 0, 'started_at': 1, 'responded_at': 1, 'operator_id': 1}).sort('responded_at', -1).to_list(500)
    secs = [(r, (datetime.fromisoformat(r['responded_at']) - datetime.fromisoformat(r['started_at'])).total_seconds()) for r in resp if r.get('started_at') and r.get('responded_at')]
    avg = lambda xs: round(sum(xs) / len(xs)) if xs else None
    mine_secs = [x for r, x in secs if user_id and r.get('operator_id') == user_id]
    response = {'count': len(secs), 'avg_seconds': avg([x for _, x in secs]), 'last_seconds': round(secs[0][1]) if secs else None,
        'mine_count': len(mine_secs), 'mine_avg_seconds': avg(mine_secs)} if secs else None
    task = await db.fan_tasks.find_one({'creator_id': creator_id, 'fan_ref': fan_ref, 'status': 'open', **({'assigned_to': user_id} if user_id else {})}, {'_id': 0})
    total = sum(s['amount_cents'] for s in mine); n = len(mine)
    last = mine[0].get('confirmed_at') if mine else None
    days_since = (today - datetime.fromisoformat(last)).days if last else None
    tier = tiers_for(totals).get(fan_ref, 'comum' if n else None)
    tags = state_tags(tier, days_since, n, sub, today)
    amounts = sorted(s['amount_cents'] for s in mine)
    low = amounts[len(amounts) // 4] if amounts else None; high = amounts[(len(amounts) * 3) // 4] if amounts else None
    hours = {}
    for s in mine:
        if s.get('confirmed_at'):
            h = datetime.fromisoformat(s['confirmed_at']).astimezone(BR).hour
            label = next(l for a, b, l in HOURS if a <= h < b); hours[label] = hours.get(label, 0) + 1
    habit = max(hours, key=hours.get) if hours and max(hours.values()) >= max(2, n // 2) else None
    # sugestão em uma frase, pelo estado do fã
    tips = []
    if offers:
        what = 'solicitação de mídia' if offers[0].get('offer_type') == 'request' else 'mídia paga' if offers[0].get('offer_type') == 'ppv' else 'oferta'
        tips.append(f"tem {what} de {money_br(offers[0]['amount_cents'])} ainda não paga: retome com leveza antes de mandar outra")
    if 'novo_sem_compra' in tags: tips.append('assinou há poucos dias e ainda não comprou: é a melhor janela para a primeira oferta')
    elif 'esfriando' in tags: tips.append(f"está {days_since} dias sem comprar: boa hora para uma oferta exclusiva")
    elif 'dormente' in tags: tips.append('sumiu há mais de 30 dias: puxe conversa antes de oferecer')
    elif tier == 'baleia': tips.append('é um dos maiores compradores desta criadora: atenção prioritária')
    if n >= 2 and low is not None: tips.append(f"costuma comprar entre {money_br(low)} e {money_br(high)}" + (f", geralmente {habit}" if habit else ''))
    elif n == 1: tips.append(f"comprou uma vez ({money_br(mine[0]['amount_cents'])})")
    return {'found': bool(n or sub or notes), 'fan_ref': fan_ref, 'fan_name': next((s.get('fan_name') for s in mine if s.get('fan_name')), None) or (sub or {}).get('fan_name'),
        'total_cents': total, 'purchases': n, 'ticket_cents': round(total / n) if n else None, 'last_at': last, 'days_since_last': days_since,
        'recent': [{'at': s.get('confirmed_at'), 'origin': s.get('sale_origin'), 'amount_cents': s['amount_cents']} for s in mine[:5]],
        'tier': tier, 'tags': tags, 'suggestion': ('. '.join(t[0].upper() + t[1:] for t in tips) + '.') if tips else None,
        'subscription': {k: sub.get(k) for k in ['status', 'active', 'price_cents', 'duration']} if sub else None,
        'pending_offers': offers, 'notes': notes, 'task': task, 'response': response}

# ---------- anotações do fã (equipe) e listas de trabalho ----------
class NoteIn(Strict):
    creator_id: str
    fan_ref: str = Field(pattern=r'^[a-f0-9]{64}$')
    text: str = Field(min_length=1, max_length=300)
class TasksIn(Strict):
    creator_id: str
    fan_refs: list[str] = Field(min_length=1, max_length=200)
    assigned_to: str
    reason: str = Field(default='', max_length=80)

async def can_see(user, creator_id):
    if not is_staff(user) and creator_id not in user.get('creator_ids', []): raise HTTPException(403, 'Criadora não autorizada.')

async def add_note(body: NoteIn, user):
    await can_see(user, body.creator_id)
    row = {'id': uid(), 'creator_id': body.creator_id, 'fan_ref': body.fan_ref, 'text': body.text.strip(), 'author_id': user['id'], 'author_name': user['name'], 'created_at': iso(), 'expires_at': now() + timedelta(days=400)}
    await db.fan_notes.insert_one(dict(row)); row.pop('expires_at'); return row

async def delete_note(note_id, user):
    note = await db.fan_notes.find_one({'id': note_id}, {'_id': 0})
    if not note: raise HTTPException(404, 'Anotação não encontrada.')
    if not is_staff(user) and note['author_id'] != user['id']: raise HTTPException(403, 'Só quem escreveu (ou um gestor) pode apagar.')
    await db.fan_notes.delete_one({'id': note_id}); return {'ok': True}

async def tasks_with_result(query):
    rows = await db.fan_tasks.find(query, {'_id': 0}).sort('created_at', -1).to_list(2000)
    for t in rows:
        t['converted_cents'] = 0
        if t.get('contacted_at'):
            until = (datetime.fromisoformat(t['contacted_at']) + timedelta(days=3)).isoformat()
            async for s in db.events.find({'creator_id': t['creator_id'], 'fan_ref': t['fan_ref'], 'kind': 'sale', 'sale_status': {'$nin': ['refunded', 'cancelled']},
                    'confirmed_at': {'$gte': t['contacted_at'], '$lte': until}}, {'_id': 0, 'amount_cents': 1}):
                t['converted_cents'] += s['amount_cents']
    return rows

@router.get('/fans/card')
async def panel_fan_card(creator_id: str, fan_ref: str, user=Depends(staff)): return await fan_card(creator_id, fan_ref)
@router.post('/fans/notes')
async def panel_add_note(body: NoteIn, user=Depends(staff)): return await add_note(body, user)
@router.delete('/fans/notes/{note_id}')
async def panel_delete_note(note_id: str, user=Depends(staff)): return await delete_note(note_id, user)

@router.post('/fan-tasks')
async def create_tasks(body: TasksIn, user=Depends(staff)):
    target = await db.users.find_one({'id': body.assigned_to, 'active': True}, {'_id': 0, 'id': 1, 'name': 1, 'role': 1, 'creator_ids': 1})
    if not target: raise HTTPException(404, 'Chatter não encontrado.')
    if not is_staff(target) and body.creator_id not in target.get('creator_ids', []): raise HTTPException(409, f"{target['name']} não tem acesso a esta criadora. Libere em Equipe e turnos.")
    creator = await db.creators.find_one({'id': body.creator_id}, {'_id': 0, 'name': 1})
    names = {}
    async for s in db.events.find({'creator_id': body.creator_id, 'fan_ref': {'$in': body.fan_refs}, 'fan_name': {'$ne': None}}, {'_id': 0, 'fan_ref': 1, 'fan_name': 1}): names[s['fan_ref']] = s['fan_name']
    async for s in db.subscribers.find({'creator_id': body.creator_id, 'fan_ref': {'$in': body.fan_refs}, 'fan_name': {'$ne': None}}, {'_id': 0, 'fan_ref': 1, 'fan_name': 1}): names.setdefault(s['fan_ref'], s['fan_name'])
    created = 0
    for ref in dict.fromkeys(body.fan_refs):
        if await db.fan_tasks.find_one({'creator_id': body.creator_id, 'fan_ref': ref, 'status': 'open'}): continue
        await db.fan_tasks.insert_one({'id': uid(), 'creator_id': body.creator_id, 'creator_name': creator['name'] if creator else '?', 'fan_ref': ref, 'fan_name': names.get(ref),
            'reason': body.reason, 'assigned_to': target['id'], 'assigned_name': target['name'], 'assigned_by': user['name'], 'status': 'open',
            'created_at': iso(), 'contacted_at': None, 'expires_at': now() + timedelta(days=90)})
        created += 1
    await audit(user, 'Lista de fãs atribuída', f"{created} fãs → {target['name']}")
    return {'ok': True, 'created': created}

@router.get('/fan-tasks')
async def list_tasks(days: int = 14, user=Depends(staff)):
    return await tasks_with_result({'created_at': {'$gte': (now() - timedelta(days=max(1, min(days, 90)))).isoformat()}})

@router.delete('/fan-tasks/{task_id}')
async def delete_task(task_id: str, user=Depends(staff)):
    await db.fan_tasks.delete_one({'id': task_id}); return {'ok': True}
