"""Bloco D: CRM de assinantes, montado a partir das vendas do extrato (que trazem o nome de exibição do
assinante quando a opção "guardar nome do assinante" está ligada) e das ofertas do chat.
Só gestor. Sem texto de mensagem: nome, valores, datas e produtos.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import re
from typing import Optional
from pydantic import Field
from fastapi import APIRouter, Depends, HTTPException
from core import db, now, iso, manager, settings, clean_time
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
    if user['role'] != 'manager' and body.creator_id not in user['creator_ids']: raise HTTPException(403, 'Criadora não autorizada.')
    seen = clean_time(body.taken_at); names = bool(config.get('fan_names_allowed'))
    for r in body.rows:
        await db.subscribers.update_one({'creator_id': body.creator_id, 'fan_ref': r.fan_ref},
            {'$set': {'fan_name': r.fan_name if names else None, 'status': r.status, 'active': is_active(r.status), 'price_cents': r.price_cents,
                'duration': r.duration, 'seen_at': seen, 'expires_at': now() + timedelta(days=400)}, '$setOnInsert': {'first_seen_at': seen}}, upsert=True)
    await db.creators.update_one({'id': body.creator_id}, {'$set': {'subscribers_read_at': seen, 'subscribers_label': body.total_label}})
    return {'ok': True, 'saved': len(body.rows)}

@router.get('/fans')
async def fans(creator_id: str = None, days: int = 90, user=Depends(manager)):
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
    for f in out:
        last = datetime.fromisoformat(f['last_at']) if f['last_at'] else None
        f['days_since_last'] = (today - last).days if last else None
        f['segment'] = ('sumiu' if f['days_since_last'] is not None and f['days_since_last'] >= 30 and f['purchases'] else
                        'novo' if f['first_at'] and (today - datetime.fromisoformat(f['first_at'])).days <= 7 else
                        'vip' if f['total_cents'] >= 30000 else 'ativo' if f['purchases'] else
                        'sem_compra' if f.get('sub_active') else 'inativo' if f.get('sub_active') is False else 'so_ofertas')
        # assinatura inativa de quem já comprou: risco de perder o fã
        f['churn_risk'] = f.get('sub_active') is False and f['purchases'] > 0
        f['ticket_cents'] = round(f['total_cents'] / f['purchases']) if f['purchases'] else None
    out.sort(key=lambda f: -f['total_cents'])
    segments = {}
    for f in out: segments[f['segment']] = segments.get(f['segment'], 0) + 1
    segments['risco'] = sum(1 for f in out if f.get('churn_risk'))
    segments['assinantes_ativos'] = sum(1 for f in out if f.get('sub_active'))
    return {'fans': out[:2000], 'count': len(out), 'segments': segments, 'fan_names_allowed': bool(config.get('fan_names_allowed')), 'days': days,
        'total_cents': sum(f['total_cents'] for f in out)}
