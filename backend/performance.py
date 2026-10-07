"""Bloco B: raio-x diário da criadora.

- POST /extension/snapshots (app desktop): retrato da "Visão geral" do Meu Privacy, uma vez por hora; o
  painel guarda um por criadora por dia (o mais recente) por 400 dias. Só números agregados.
- GET /performance (gestor): por criadora, o último retrato, a variação de 7 dias e o faturamento por dia
  dos últimos 30 dias calculado pelas vendas do extrato (exatas), mais alertas simples.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional, Any
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from core import db, now, iso, uid, staff, creator_access
from schemas import Strict

router = APIRouter()
BR = ZoneInfo('America/Sao_Paulo')
SNAPSHOT_DAYS = 400
NUMERIC = ['sales_today_cents', 'sales_month_cents', 'sales_total_cents', 'intl_today_cents', 'intl_month_cents', 'intl_total_cents',
    'subscribers_total', 'subscribers_active', 'revenue_rank_pct', 'projection_month_cents', 'projection_avg_day_cents', 'projection_cents',
    'revenue_today_cents', 'balance_national_cents', 'balance_international_cents', 'balance_pending_cents', 'record_day_cents', 'period_total_cents']

class SnapshotIn(Strict):
    creator_id: str
    taken_at: datetime
    period: Optional[str] = Field(default=None, max_length=80)
    data: dict[str, Any]

def clean(data):
    out = {}
    for k in NUMERIC:
        v = data.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool): out[k] = v
    bp = data.get('by_product')
    if isinstance(bp, list):
        out['by_product'] = [{'product': str(x.get('product'))[:40], 'count': x.get('count') if isinstance(x.get('count'), int) else None, 'cents': x.get('cents') if isinstance(x.get('cents'), int) else None} for x in bp if isinstance(x, dict) and x.get('product')][:12]
    return out

async def save_snapshot(body: SnapshotIn, user):
    creator = await creator_access(body.creator_id, user)
    if body.taken_at.tzinfo is None: raise HTTPException(422, 'Informe o fuso horário.')
    day = body.taken_at.astimezone(BR).date().isoformat()
    data = clean(body.data)
    if not data: raise HTTPException(422, 'Retrato sem números reconhecidos.')
    await db.creator_snapshots.update_one({'creator_id': body.creator_id, 'day': day},
        {'$set': {'creator_id': body.creator_id, 'day': day, 'taken_at': body.taken_at.astimezone(timezone.utc).isoformat(), 'period': body.period, 'data': data,
                  'operator_id': user['id'], 'expires_at': now() + timedelta(days=SNAPSHOT_DAYS)}, '$setOnInsert': {'id': uid()}}, upsert=True)
    return {'ok': True, 'day': day}

@router.get('/performance')
async def performance(days: int = 30, user=Depends(staff)):
    days = max(7, min(days, 90))
    today = datetime.now(BR).date()
    start = today - timedelta(days=days - 1)
    creators = await db.creators.find({'deleted_at': None}, {'_id': 0, 'id': 1, 'name': 1, 'color': 1, 'handle': 1}).to_list(1000)
    snaps = await db.creator_snapshots.find({'day': {'$gte': (today - timedelta(days=days + 7)).isoformat()}}, {'_id': 0}).sort('day', 1).to_list(20000)
    by_creator = {}
    for s in snaps: by_creator.setdefault(s['creator_id'], []).append(s)
    # vendas exatas do extrato, por dia (Brasília), sem estornos/cancelamentos
    since = datetime.combine(start, datetime.min.time(), BR).astimezone(timezone.utc).isoformat()
    sales = await db.events.find({'kind': 'sale', 'confirmed_at': {'$gte': since}, 'sale_status': {'$in': ['confirmed', 'pending']}, 'expires_at': {'$gt': now()}},
        {'_id': 0, 'creator_id': 1, 'confirmed_at': 1, 'amount_cents': 1, 'sale_origin': 1, 'sale_source': 1}).to_list(50000)
    daily = {}
    for s in sales:
        d = datetime.fromisoformat(s['confirmed_at']).astimezone(BR).date().isoformat()
        cell = daily.setdefault(s['creator_id'], {}).setdefault(d, {'cents': 0, 'count': 0, 'chat_cents': 0})
        cell['cents'] += s['amount_cents']; cell['count'] += 1
        if s.get('sale_origin') == 'chat': cell['chat_cents'] += s['amount_cents']
    day_list = [(start + timedelta(days=i)).isoformat() for i in range(days)]
    rows = []
    for c in creators:
        series = [daily.get(c['id'], {}).get(d, {'cents': 0, 'count': 0, 'chat_cents': 0}) for d in day_list]
        last7 = sum(x['cents'] for x in series[-7:]); prev7 = sum(x['cents'] for x in series[-14:-7])
        total = sum(x['cents'] for x in series)
        snaps_c = by_creator.get(c['id'], [])
        latest = snaps_c[-1] if snaps_c else None
        week_ago = next((s for s in reversed(snaps_c) if s['day'] <= (today - timedelta(days=7)).isoformat()), None)
        alerts = []
        if latest and week_ago:
            a, b = latest['data'].get('subscribers_active'), week_ago['data'].get('subscribers_active')
            if a is not None and b and a < b * 0.9: alerts.append(f'Assinantes ativos caíram {b} → {a} em 7 dias')
        if prev7 and last7 < prev7 * 0.7: alerts.append('Faturamento da semana 30% abaixo da anterior')
        if series and all(x['count'] == 0 for x in series[-3:]) and any(x['count'] for x in series[:-3]): alerts.append('3 dias sem venda registrada')
        if latest and latest['day'] < (today - timedelta(days=2)).isoformat(): alerts.append(f"Sem retrato desde {latest['day']} (app fechado?)")
        rows.append({'creator_id': c['id'], 'name': c['name'], 'color': c.get('color'), 'handle': c.get('handle'),
            'today_cents': series[-1]['cents'], 'last7_cents': last7, 'prev7_cents': prev7, 'total_cents': total, 'sales_count': sum(x['count'] for x in series),
            'series': [x['cents'] for x in series], 'snapshot': latest and {'day': latest['day'], 'taken_at': latest['taken_at'], **latest['data']},
            'week_ago': week_ago and {'day': week_ago['day'], 'subscribers_active': week_ago['data'].get('subscribers_active'), 'subscribers_total': week_ago['data'].get('subscribers_total')},
            'alerts': alerts})
    rows.sort(key=lambda r: -r['last7_cents'])
    return {'days': day_list, 'creators': rows, 'totals': {'today_cents': sum(r['today_cents'] for r in rows), 'last7_cents': sum(r['last7_cents'] for r in rows), 'total_cents': sum(r['total_cents'] for r in rows), 'active_subscribers': sum((r['snapshot'] or {}).get('subscribers_active') or 0 for r in rows)}}

@router.get('/performance/{creator_id}/snapshots')
async def snapshots(creator_id: str, user=Depends(staff)):
    await creator_access(creator_id, user)
    return await db.creator_snapshots.find({'creator_id': creator_id}, {'_id': 0, 'expires_at': 0}).sort('day', -1).to_list(400)
