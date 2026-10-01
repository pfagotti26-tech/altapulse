"""Qualidade como boletim: nota de atendimento por chatter (0–100), calculada sem avaliação manual a partir do
que o sistema já mede (tempo de resposta, fãs sem resposta, ofertas, vendas por hora de turno), com tendência
contra o período anterior de mesmo tamanho, e alertas do dia para o gestor.
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from core import db, now, manager, settings, clean_time
from metrics import report_data

router = APIRouter()
WEIGHTS = {'speed': 35, 'care': 15, 'conversion': 25, 'productivity': 25}

def clamp(v): return max(0, min(100, round(v)))

async def shift_hours(start, end, creator_id=None):
    """Horas de turno por operador dentro do período (pausas contam como turno; é uma aproximação)."""
    q = {'started_at': {'$lt': end.isoformat()}}
    if creator_id: q['creator_id'] = creator_id
    hours = {}
    for sh in await db.shifts.find(q, {'_id': 0, 'operator_id': 1, 'started_at': 1, 'ended_at': 1}).to_list(50000):
        a = max(datetime.fromisoformat(sh['started_at']), start)
        b = min(datetime.fromisoformat(sh['ended_at']) if sh.get('ended_at') else now(), end)
        if b > a: hours[sh['operator_id']] = hours.get(sh['operator_id'], 0) + (b - a).total_seconds() / 3600
    return hours

async def scores(start, end, creator_id=None):
    config = await settings(); sla = config['sla_minutes'] * 60
    data = await report_data(creator_id or None, None, start.isoformat(), end.isoformat())
    hours = await shift_hours(start, end, creator_id)
    ops = {}
    def cell(oid, name):
        return ops.setdefault(oid, {'operator_id': oid, 'name': name, 'responses': [], 'late': 0, 'pending': 0, 'offers': 0, 'paid': 0, 'sales_cents': 0, 'sales': 0})
    for r in data['responses']:
        if not r.get('operator_id'): continue
        c = cell(r['operator_id'], r['operator_name']); c['responses'].append(r['seconds']); c['late'] += r['late']
    for p in data['pending']:
        if p.get('operator_id'): cell(p['operator_id'], p['operator_name'])['pending'] += 1
    for o in data['offers']:
        if not o.get('operator_id'): continue
        c = cell(o['operator_id'], o['operator_name']); c['offers'] += 1; c['paid'] += o.get('offer_status') == 'paid'
    for s in data['sales']:
        if s.get('eligible') and s.get('operator_id') and s['sale_status'] == 'confirmed':
            c = cell(s['operator_id'], s['operator_name']); c['sales'] += 1; c['sales_cents'] += s['amount_cents']
    for oid in hours:
        if oid not in ops:
            u = await db.users.find_one({'id': oid}, {'_id': 0, 'name': 1})
            if u: cell(oid, u['name'])
    out = []
    for oid, c in ops.items():
        h = hours.get(oid, 0); xs = c.pop('responses'); n = len(xs)
        mean = sum(xs) / n if n else None
        c.update({'hours': round(h, 1), 'response_count': n, 'mean_seconds': round(mean) if mean is not None else None,
                  'late_pct': round(c['late'] / n * 100) if n else None, 'conversion': round(c['paid'] / c['offers'] * 100) if c['offers'] else None,
                  'sales_per_hour_cents': round(c['sales_cents'] / h) if h >= 0.5 else None, 'ticket_cents': round(c['sales_cents'] / c['sales']) if c['sales'] else None})
        out.append(c)
    best_sph = max([c['sales_per_hour_cents'] or 0 for c in out] or [0])
    for c in out:
        parts = {}
        if c['response_count'] >= 3:
            by_mean = 100 if c['mean_seconds'] <= sla else 100 - (c['mean_seconds'] / sla - 1) * 40
            parts['speed'] = clamp((by_mean + (100 - c['late_pct'])) / 2)
        if c['response_count'] or c['pending']: parts['care'] = clamp(100 - c['pending'] * 15)
        if c['offers'] >= 3: parts['conversion'] = clamp(c['conversion'] * 2)  # 50% de ofertas pagas já é nota máxima
        if c['sales_per_hour_cents'] is not None and best_sph: parts['productivity'] = clamp(c['sales_per_hour_cents'] / best_sph * 100)
        w = sum(WEIGHTS[k] for k in parts)
        c['parts'] = parts
        c['score'] = round(sum(parts[k] * WEIGHTS[k] for k in parts) / w) if w and len(parts) >= 2 else None
    return out

async def alerts(creator_id=None):
    t = now(); out = []
    data = await report_data(creator_id or None, None, (t - timedelta(days=2)).isoformat(), None)
    for p in data['pending']:
        if p['seconds'] >= 1800:
            out.append({'kind': 'waiting', 'level': 'red' if p['seconds'] >= 3600 else 'amber', 'creator': p['creator_name'], 'who': p['operator_name'],
                        'text': f"{p.get('fan_name') or 'Fã'} esperando resposta há {round(p['seconds'] / 60)} min", 'at': p.get('started_at')})
    limit = (t - timedelta(hours=24)).isoformat()
    for o in data['offers']:
        if o.get('offer_status') == 'sent' and (o.get('offered_at') or '') < limit:
            out.append({'kind': 'offer', 'level': 'amber', 'creator': o['creator_name'], 'who': o['operator_name'],
                        'text': f"Oferta de R$ {o['amount_cents'] / 100:.2f}".replace('.', ',') + f" sem pagamento há mais de 24 h ({o.get('fan_name') or 'fã'})", 'at': o.get('offered_at')})
    q = {'active': True, 'started_at': {'$lt': (t - timedelta(hours=12)).isoformat()}}
    if creator_id: q['creator_id'] = creator_id
    for sh in await db.shifts.find(q, {'_id': 0}).to_list(500):
        hrs = round((t - datetime.fromisoformat(sh['started_at'])).total_seconds() / 3600)
        out.append({'kind': 'shift', 'level': 'amber', 'creator': sh.get('creator_name'), 'who': sh.get('operator_name'), 'text': f"Turno aberto há {hrs} h (esqueceram de encerrar?)", 'at': sh['started_at']})
    for a in await db.assist_alerts.find({'resolved_at': None}, {'_id': 0}).to_list(50):
        out.append({'kind': 'minor', 'level': 'red', 'creator': a.get('creator_name'), 'who': a.get('user_name'), 'text': f"Alta Ajuda: possível menor de idade — {a.get('reason')}", 'at': a.get('created_at')})
    order = {'red': 0, 'amber': 1}
    return sorted(out, key=lambda x: (order.get(x['level'], 2), x.get('at') or ''))[:60]

@router.get('/quality/scorecard')
async def scorecard(start: datetime | None = None, end: datetime | None = None, creator_id: str = '', user=Depends(manager)):
    end = datetime.fromisoformat(clean_time(end)) if end else now()
    start = datetime.fromisoformat(clean_time(start)) if start else end - timedelta(days=7)
    span = end - start
    cur = await scores(start, end, creator_id)
    prev = {c['operator_id']: c for c in await scores(start - span, start, creator_id)}
    avatars = {u['id']: u.get('avatar') for u in await db.users.find({'id': {'$in': [c['operator_id'] for c in cur]}}, {'_id': 0, 'id': 1, 'avatar': 1}).to_list(500)}
    for c in cur:
        p = prev.get(c['operator_id'])
        c['previous_score'] = p['score'] if p else None
        c['trend'] = (c['score'] - p['score']) if p and p['score'] is not None and c['score'] is not None else None
        c['avatar'] = avatars.get(c['operator_id'])
    cur.sort(key=lambda c: (c['score'] is None, -(c['score'] or 0)))
    return {'start': start.isoformat(), 'end': end.isoformat(), 'sla_minutes': (await settings())['sla_minutes'], 'chatters': cur, 'alerts': await alerts(creator_id)}
