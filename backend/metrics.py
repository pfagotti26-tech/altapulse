from datetime import datetime, timedelta
from statistics import mean, median
from fastapi import HTTPException
from core import db, now, assign_shift, settings

async def report_data(creator_id=None, operator_id=None, start=None, end=None):
    config = await settings()
    if start and end and start > end: raise HTTPException(422, 'O início deve ser anterior ao fim do período.')
    query = {'expires_at': {'$gt': now()}}
    if creator_id: query['creator_id'] = creator_id
    rows = await db.events.find(query, {'_id': 0, 'expires_at': 0}).sort('observed_at', -1).to_list(10000) if config['storage_allowed'] else []
    creators = {c['id']: c['name'] for c in await db.creators.find({}, {'_id': 0, 'id': 1, 'name': 1}).to_list(1000)}
    responses, pending, sales, offers, incomplete = [], [], [], [], 0
    for row in rows:
        at = row.get('confirmed_at') if row['kind'] == 'sale' else row.get('offered_at') if row['kind'] == 'offer' else row.get('responded_at') or row.get('started_at')
        filter_at = at or row['observed_at']
        if start and filter_at < start: continue
        if end and filter_at >= end: continue
        shift = await assign_shift(row['creator_id'], at)
        row.update({'creator_name': creators.get(row['creator_id'], 'Criadora excluída'),
            'operator_id': shift['operator_id'] if shift else None,
            'operator_name': shift['operator_name'] if shift else 'Sem atribuição', 'shift_id': shift['id'] if shift else None})
        if row['kind'] == 'sale':
            # atribuível ao turno: venda de chat com instante conhecido (assinatura, postagem e mimo ficam só no total da criadora)
            row['eligible'] = row.get('sale_origin') == 'chat' and bool(row.get('confirmed_at')) and row.get('sale_status') in ['confirmed', 'pending', 'refunded', 'cancelled']
            if not row['eligible']: row.update({'operator_id': None, 'operator_name': 'Sem atribuição', 'shift_id': None})
            if row.get('manual_assignment') is not None:
                chosen = await db.shifts.find_one({'id': row['manual_assignment'].get('shift_id')}, {'_id': 0})
                row.update({'operator_id': chosen['operator_id'] if chosen else None, 'operator_name': chosen['operator_name'] if chosen else 'Sem atribuição', 'shift_id': chosen['id'] if chosen else None, 'assignment_type': 'manual'})
            else: row['assignment_type'] = 'shift_time'
            if operator_id and row['operator_id'] != operator_id: continue
            sales.append(row)
        elif row['kind'] == 'offer':
            if operator_id and row['operator_id'] != operator_id: continue
            offers.append(row)
        elif operator_id and row['operator_id'] != operator_id: continue
        elif not row.get('sequence_complete'):
            incomplete += 1
        else:
            begin = datetime.fromisoformat(row['started_at'])
            row['seconds'] = ((datetime.fromisoformat(row['responded_at']) if row.get('responded_at') else now()) - begin).total_seconds()
            row['late'] = row['seconds'] > config['sla_minutes'] * 60
            begin_shift = await assign_shift(row['creator_id'], row['started_at'])
            current_shift = shift if row['kind'] == 'response' else await db.shifts.find_one({'creator_id': row['creator_id'], 'active': True}, {'_id': 0})
            row['inherited'] = bool(current_shift and (not begin_shift or begin_shift['id'] != current_shift['id']))
            (responses if row['kind'] == 'response' else pending).append(row)
    eligible = [s for s in sales if s['eligible']]
    confirmed = [s for s in eligible if s['sale_status'] == 'confirmed']
    refunded = [s for s in eligible if s['sale_status'] == 'refunded']
    cancelled = [s for s in eligible if s['sale_status'] == 'cancelled']
    pending_sales = [s for s in eligible if s['sale_status'] == 'pending']
    # bloco A: totais da criadora por produto e por forma de pagamento (todas as origens, exceto estornos/cancelados)
    def breakdown(key):
        out = {}
        for s in sales:
            if s['sale_status'] in ['refunded', 'cancelled']: continue
            k = s.get(key) or 'unknown'
            cell = out.setdefault(k, {'count': 0, 'cents': 0, 'commission_cents': 0, 'pending_cents': 0})
            cell['count'] += 1; cell['cents'] += s['amount_cents']; cell['commission_cents'] += s.get('commission_cents') or 0
            if s['sale_status'] == 'pending': cell['pending_cents'] += s['amount_cents']
        return out
    by_origin, by_payment = breakdown('sale_origin'), breakdown('payment_method')
    by_operator = {}
    for s in eligible:
        if s['sale_status'] in ['refunded', 'cancelled']: continue
        cell = by_operator.setdefault(s['operator_name'], {'count': 0, 'cents': 0, 'operator_id': s['operator_id']})
        cell['count'] += 1; cell['cents'] += s['amount_cents']
    extrato_count = sum(s.get('sale_source') == 'extrato' for s in sales)
    # bloco C: funil de ofertas por chatter
    offers_by_operator = {}
    for o in offers:
        cell = offers_by_operator.setdefault(o['operator_name'], {'sent': 0, 'paid': 0, 'sent_cents': 0, 'paid_cents': 0, 'operator_id': o['operator_id']})
        cell['sent'] += 1; cell['sent_cents'] += o['amount_cents']
        if o.get('offer_status') == 'paid': cell['paid'] += 1; cell['paid_cents'] += o['amount_cents']
    for cell in offers_by_operator.values(): cell['conversion'] = round(cell['paid'] / cell['sent'] * 100) if cell['sent'] else None
    times = [r['seconds'] for r in responses]
    has_sample = bool(responses or pending or incomplete)
    return {'responses': responses, 'pending': sorted(pending, key=lambda p: p['seconds'], reverse=True), 'sales': sales, 'offers': offers,
        'summary': {'mean_seconds': round(mean(times)) if times else None, 'median_seconds': round(median(times)) if times else None,
        'response_count': len(responses), 'pending_count': len(pending) if has_sample else None, 'late_count': sum(p['late'] for p in pending) if has_sample else None,
        'sample_count': len(responses) + len(pending), 'incomplete_count': incomplete,
        'confirmed_count': len(confirmed) if sales else None, 'confirmed_cents': sum(s['amount_cents'] for s in confirmed) if sales else None,
        'refunded_cents': sum(s['amount_cents'] for s in refunded) if sales else None, 'cancelled_cents': sum(s['amount_cents'] for s in cancelled) if sales else None,
        'unassigned_sales': sum(s['operator_id'] is None for s in sales), 'sales_sample': len(sales),
        'pending_cents': sum(s['amount_cents'] for s in pending_sales) if sales else None,
        'gross_cents': sum(s['amount_cents'] for s in sales if s['sale_status'] not in ['refunded', 'cancelled']) if sales else None,
        'commission_cents': sum(s.get('commission_cents') or 0 for s in sales if s['sale_status'] not in ['refunded', 'cancelled']) if sales else None,
        'by_origin': by_origin, 'by_payment': by_payment, 'by_operator': by_operator, 'extrato_count': extrato_count,
        'offers_sent': len(offers), 'offers_paid': sum(o.get('offer_status') == 'paid' for o in offers), 'offers_by_operator': offers_by_operator,
        'last_observed_at': max((r['observed_at'] for r in responses + pending + sales), default=None),
        'coverage': 'partial' if has_sample or sales else 'no_data', 'storage_allowed': config['storage_allowed']}}