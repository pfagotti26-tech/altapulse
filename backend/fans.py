"""Bloco D: CRM de assinantes, montado a partir das vendas do extrato (que trazem o nome de exibição do
assinante quando a opção "guardar nome do assinante" está ligada) e das ofertas do chat.
Só gestor. Sem texto de mensagem: nome, valores, datas e produtos.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends
from core import db, now, manager, settings

router = APIRouter()
BR = ZoneInfo('America/Sao_Paulo')

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
    out = [f for f in fans.values() if f['purchases'] or f['offers_sent']]
    today = now()
    for f in out:
        last = datetime.fromisoformat(f['last_at']) if f['last_at'] else None
        f['days_since_last'] = (today - last).days if last else None
        f['segment'] = ('sumiu' if f['days_since_last'] is not None and f['days_since_last'] >= 30 and f['purchases'] else
                        'novo' if f['first_at'] and (today - datetime.fromisoformat(f['first_at'])).days <= 7 else
                        'vip' if f['total_cents'] >= 30000 else 'ativo' if f['purchases'] else 'so_ofertas')
        f['ticket_cents'] = round(f['total_cents'] / f['purchases']) if f['purchases'] else None
    out.sort(key=lambda f: -f['total_cents'])
    segments = {}
    for f in out: segments[f['segment']] = segments.get(f['segment'], 0) + 1
    return {'fans': out[:2000], 'count': len(out), 'segments': segments, 'fan_names_allowed': bool(config.get('fan_names_allowed')), 'days': days,
        'total_cents': sum(f['total_cents'] for f in out)}
