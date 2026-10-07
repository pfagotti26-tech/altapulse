"""Qualidade como gestão de vendas: nota por chatter (0–100) medida contra METAS do gestor (tempo de resposta,
conversão de ofertas, R$ por hora), quebra por criadora, painel individual dia a dia, e alertas resumidos.
Só chatters entram no ranking (gestores e contas de teste ficam de fora, salvo pedido).
"""
from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Optional
from pydantic import Field
from fastapi import APIRouter, Depends, HTTPException
from core import db, now, staff, STAFF, settings, clean_time, audit
from schemas import Strict
from metrics import report_data

router = APIRouter()
WEIGHTS = {'speed': 30, 'care': 15, 'conversion': 25, 'productivity': 30}
BRT = timezone(timedelta(hours=-3))
DEFAULT_GOALS = {'goal_conversion_pct': 30, 'goal_sales_hour_cents': 5000, 'alert_minutes': 10}

def clamp(v): return max(0, min(100, round(v)))
def pct(a, b): return round(a / b * 100) if b else None
def p90(xs): xs = sorted(xs); return xs[min(len(xs) - 1, int(len(xs) * 0.9))] if xs else None
def human(seconds):
    m = round(seconds / 60)
    if m < 60: return f'{m} min'
    h, m = divmod(m, 60)
    if h < 24: return f'{h} h' + (f' {m} min' if m else '')
    d, h = divmod(h, 24)
    return f'{d} d' + (f' {h} h' if h else '')

async def goals():
    c = await settings()
    return {'sla_minutes': c['sla_minutes'], **{k: c.get(k, v) for k, v in DEFAULT_GOALS.items()}}

class GoalsIn(Strict):
    sla_minutes: int = Field(ge=1, le=120)
    goal_conversion_pct: int = Field(ge=1, le=100)
    goal_sales_hour_cents: int = Field(ge=100, le=10000000)
    alert_minutes: int = Field(default=10, ge=1, le=240)

@router.get('/quality/goals')
async def get_goals(user=Depends(staff)): return await goals()

@router.put('/quality/goals')
async def put_goals(body: GoalsIn, user=Depends(staff)):
    await db.settings.update_one({'id': 'main'}, {'$set': body.model_dump()}, upsert=True)
    await audit(user, 'Metas da equipe atualizadas', 'Qualidade', body.model_dump())
    return await goals()

async def shift_hours(start, end, creator_id=None):
    """Horas de turno por (operador, criadora) e horas de RELÓGIO por operador (pausas contam como turno).
    Quem atende 4 criadoras ao mesmo tempo trabalhou 1 hora, não 4: o R$/hora usa as horas de relógio."""
    q = {'started_at': {'$lt': end.isoformat()}}
    if creator_id: q['creator_id'] = creator_id
    hours, spans = {}, {}
    for sh in await db.shifts.find(q, {'_id': 0, 'operator_id': 1, 'creator_id': 1, 'started_at': 1, 'ended_at': 1}).to_list(50000):
        a = max(datetime.fromisoformat(sh['started_at']), start)
        b = min(datetime.fromisoformat(sh['ended_at']) if sh.get('ended_at') else now(), end)
        if b > a:
            k = (sh['operator_id'], sh['creator_id']); hours[k] = hours.get(k, 0) + (b - a).total_seconds() / 3600
            spans.setdefault(sh['operator_id'], []).append((a, b))
    clock = {}
    for oid, xs in spans.items():
        xs.sort(); total = 0; cur_a, cur_b = xs[0]
        for a, b in xs[1:]:
            if a <= cur_b: cur_b = max(cur_b, b)
            else: total += (cur_b - cur_a).total_seconds(); cur_a, cur_b = a, b
        total += (cur_b - cur_a).total_seconds(); clock[oid] = total / 3600
    return hours, clock

def new_cell():
    return {'resp': [], 'late': 0, 'pending': 0, 'pending_24h': 0, 'over_alert': 0, 'offers': 0, 'paid': 0, 'offered_cents': 0, 'paid_cents': 0, 'sales': 0, 'sales_cents': 0,
            'tickets': [], 'fans': set(), 'offer_fans': set(), 'hours': 0.0}

def finish(c, g):
    sla = g['sla_minutes'] * 60; xs = c.pop('resp'); n = len(xs); h = c['hours']
    fans = c.pop('fans'); offer_fans = c.pop('offer_fans'); tickets = c.pop('tickets')
    c.update({'hours': round(h, 1), 'creator_hours': round(c.pop('creator_hours', h), 1), 'response_count': n, 'median_seconds': round(median(xs)) if n else None, 'p90_seconds': round(p90(xs)) if n else None,
        'mean_seconds': round(sum(xs) / n) if n else None, 'within_goal_pct': pct(sum(1 for x in xs if x <= sla), n), 'late_pct': pct(c['late'], n),
        'conversion': pct(c['paid'], c['offers']), 'value_conversion': pct(c['paid_cents'], c['offered_cents']),
        'sales_per_hour_cents': round(c['sales_cents'] / h) if h >= 0.5 else None, 'ticket_cents': round(median(tickets)) if tickets else None,
        'fans_attended': len(fans), 'fans_per_hour': round(len(fans) / h, 1) if h >= 0.5 else None, 'offer_rate': pct(len(offer_fans), len(fans | offer_fans))})
    parts = {}
    if n >= 3: parts['speed'] = clamp(c['within_goal_pct'])
    # cuidado: fãs que ficaram sem resposta nas últimas 24 h (conversas antigas e paradas não punem a nota)
    if n or c['pending_24h']: parts['care'] = clamp(100 - c['pending_24h'] * 10)
    if c['offers'] >= 3: parts['conversion'] = clamp(c['conversion'] / g['goal_conversion_pct'] * 100)
    if c['sales_per_hour_cents'] is not None: parts['productivity'] = clamp(c['sales_per_hour_cents'] / g['goal_sales_hour_cents'] * 100)
    w = sum(WEIGHTS[k] for k in parts)
    c['parts'] = parts
    c['score'] = round(sum(parts[k] * WEIGHTS[k] for k in parts) / w) if w and len(parts) >= 2 else None
    return c

async def collect(start, end, creator_id=None, operator_id=None):
    """Tudo que o sistema mediu no período, agregado por operador e por (operador, criadora), mais série diária."""
    data = await report_data(creator_id or None, operator_id or None, start.isoformat(), end.isoformat())
    hours, clock = await shift_hours(start, end, creator_id)
    g = await goals(); alert_s = g.get('alert_minutes', 10) * 60; recent = (now() - timedelta(hours=24)).isoformat()
    ops, pairs, days = {}, {}, {}
    names = {u['id']: u for u in await db.users.find({}, {'_id': 0, 'id': 1, 'name': 1, 'role': 1, 'avatar': 1}).to_list(1000)}
    creators = {c['id']: c['name'] for c in await db.creators.find({}, {'_id': 0, 'id': 1, 'name': 1}).to_list(1000)}
    def cells(oid, cid):
        a = ops.setdefault(oid, new_cell()); b = pairs.setdefault((oid, cid), new_cell()); return a, b
    def day(at): return datetime.fromisoformat(at).astimezone(BRT).strftime('%Y-%m-%d') if at else None
    def dcell(oid, at):
        d = day(at); return days.setdefault(oid, {}).setdefault(d, {'sales_cents': 0, 'sales': 0, 'responses': 0, 'resp': []}) if d else None
    for r in data['responses']:
        if not r.get('operator_id'): continue
        for c in cells(r['operator_id'], r['creator_id']):
            c['resp'].append(r['seconds']); c['late'] += r['late']; c['over_alert'] += r['seconds'] > alert_s; r.get('fan_ref') and c['fans'].add(r['fan_ref'])
        dc = dcell(r['operator_id'], r.get('responded_at'))
        if dc: dc['responses'] += 1; dc['resp'].append(r['seconds'])
    for p in data['pending']:
        if p.get('operator_id'):
            for c in cells(p['operator_id'], p['creator_id']):
                c['pending'] += 1; p.get('fan_ref') and c['fans'].add(p['fan_ref'])
                if (p.get('started_at') or '') >= recent and p['seconds'] > g['sla_minutes'] * 60: c['pending_24h'] += 1
    for o in data['offers']:
        if not o.get('operator_id'): continue
        for c in cells(o['operator_id'], o['creator_id']):
            c['offers'] += 1; c['offered_cents'] += o['amount_cents']; o.get('fan_ref') and c['offer_fans'].add(o['fan_ref'])
            if o.get('offer_status') == 'paid': c['paid'] += 1; c['paid_cents'] += o['amount_cents']
    for s in data['sales']:
        if s.get('eligible') and s.get('operator_id') and s['sale_status'] == 'confirmed':
            for c in cells(s['operator_id'], s['creator_id']): c['sales'] += 1; c['sales_cents'] += s['amount_cents']; c['tickets'].append(s['amount_cents'])
            dc = dcell(s['operator_id'], s.get('confirmed_at'))
            if dc: dc['sales'] += 1; dc['sales_cents'] += s['amount_cents']
    for (oid, cid), h in hours.items():
        if operator_id and oid != operator_id: continue
        a, b = cells(oid, cid); a['creator_hours'] = a.get('creator_hours', 0) + h; b['hours'] += h
    for oid, h in clock.items():
        if operator_id and oid != operator_id: continue
        if oid in ops: ops[oid]['hours'] = h
    return ops, pairs, days, names, creators

async def scores(start, end, creator_id=None, include_managers=False):
    g = await goals()
    ops, pairs, _, names, creators = await collect(start, end, creator_id)
    out = []
    for oid, c in ops.items():
        u = names.get(oid) or {}
        if not include_managers and u.get('role') in STAFF: continue
        row = finish(c, g); row.update({'operator_id': oid, 'name': u.get('name', 'Excluído'), 'avatar': u.get('avatar'), 'role': u.get('role')})
        row['creators'] = sorted([{**finish(pc, g), 'creator_id': cid, 'creator_name': creators.get(cid, 'Criadora excluída')} for (o, cid), pc in pairs.items() if o == oid],
                                 key=lambda x: -(x['sales_cents'] or 0))
        out.append(row)
    return out

async def alerts(creator_id=None):
    """Alertas acionáveis: espera acima da meta (até 48 h), ofertas paradas, turnos esquecidos e alerta de menor.
    Espera acima de 48 h vira 'para reativar' (follow-up), não emergência."""
    t = now(); out = []; g = await goals(); sla = g['sla_minutes'] * 60
    data = await report_data(creator_id or None, None, (t - timedelta(days=7)).isoformat(), None)
    for p in data['pending']:
        if p['seconds'] < g.get('alert_minutes', 10) * 60: continue
        stale = p['seconds'] >= 48 * 3600
        out.append({'kind': 'stale' if stale else 'waiting', 'level': 'gray' if stale else 'red' if p['seconds'] >= 3600 else 'amber',
            'creator': p['creator_name'], 'who': p['operator_name'], 'at': p.get('started_at'), 'seconds': round(p['seconds']),
            'text': f"{p.get('fan_name') or 'Fã'} {'parado' if stale else 'esperando resposta'} há {human(p['seconds'])}"})
    limit = (t - timedelta(hours=24)).isoformat(); oldest = (t - timedelta(days=3)).isoformat()
    for o in data['offers']:
        if o.get('offer_status') == 'sent' and oldest <= (o.get('offered_at') or '') < limit:
            out.append({'kind': 'offer', 'level': 'amber', 'creator': o['creator_name'], 'who': o['operator_name'], 'at': o.get('offered_at'),
                'text': f"Oferta de R$ {o['amount_cents'] / 100:.2f}".replace('.', ',') + f" sem pagamento há {human((t - datetime.fromisoformat(o['offered_at'])).total_seconds()) if o.get('offered_at') else 'mais de 24 h'} ({o.get('fan_name') or 'fã'})"})
    q = {'active': True, 'started_at': {'$lt': (t - timedelta(hours=12)).isoformat()}}
    if creator_id: q['creator_id'] = creator_id
    for sh in await db.shifts.find(q, {'_id': 0}).to_list(500):
        out.append({'kind': 'shift', 'level': 'amber', 'creator': sh.get('creator_name'), 'who': sh.get('operator_name'), 'at': sh['started_at'],
            'text': f"Turno aberto há {human((t - datetime.fromisoformat(sh['started_at'])).total_seconds())} (esqueceram de encerrar?)"})
    for a in await db.assist_alerts.find({'resolved_at': None}, {'_id': 0}).to_list(50):
        out.append({'kind': 'minor', 'level': 'red', 'creator': a.get('creator_name'), 'who': a.get('user_name'), 'text': f"Alta Ajuda: possível menor de idade — {a.get('reason')}", 'at': a.get('created_at')})
    order = {'red': 0, 'amber': 1, 'gray': 2}
    return sorted(out, key=lambda x: (order.get(x['level'], 3), x.get('at') or ''))[:200]

def window(start, end):
    end = datetime.fromisoformat(clean_time(end)) if end else now()
    start = datetime.fromisoformat(clean_time(start)) if start else end - timedelta(days=7)
    return start, end

@router.get('/quality/scorecard')
async def scorecard(start: datetime | None = None, end: datetime | None = None, creator_id: str = '', managers: bool = False, user=Depends(staff)):
    start, end = window(start, end); span = end - start
    cur = await scores(start, end, creator_id, managers)
    prev = {c['operator_id']: c for c in await scores(start - span, start, creator_id, managers)}
    for c in cur:
        p = prev.get(c['operator_id'])
        c['previous_score'] = p['score'] if p else None
        c['trend'] = (c['score'] - p['score']) if p and p['score'] is not None and c['score'] is not None else None
    # nota da IA no período (média das análises que citam o chatter): qualidade da conversa e engajamento
    ai = {}
    for ins in await db.insights.find({'period_end': {'$gte': start.isoformat()}, 'period_start': {'$lt': end.isoformat()}}, {'_id': 0, 'items': 1}).to_list(200):
        for it in ins.get('items', []):
            k = (it.get('operator_name') or '').strip().lower(); a_ = ai.setdefault(k, {'s': [], 'e': [], 'd': []})
            if it.get('score') is not None: a_['s'].append(it['score'])
            if it.get('engagement') is not None: a_['e'].append(it['engagement'])
            if it.get('dry_pct') is not None: a_['d'].append(it['dry_pct'])
    avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else None
    for c in cur:
        a_ = ai.get((c['name'] or '').strip().lower()) or {}
        c['ai_score'] = avg(a_.get('s') or []); c['ai_engagement'] = avg(a_.get('e') or []); c['ai_dry_pct'] = avg(a_.get('d') or [])
    cur.sort(key=lambda c: (c['score'] is None, -(c['score'] or 0)))
    g = await goals()
    return {'start': start.isoformat(), 'end': end.isoformat(), 'sla_minutes': g['sla_minutes'], 'goals': g, 'chatters': cur, 'alerts': await alerts(creator_id)}

@router.get('/quality/chatter/{operator_id}')
async def chatter(operator_id: str, start: datetime | None = None, end: datetime | None = None, user=Depends(staff)):
    """Painel individual: totais, por criadora, dia a dia, comparação com a mediana da equipe e o que a IA disse dele."""
    start, end = window(start, end); g = await goals()
    u = await db.users.find_one({'id': operator_id}, {'_id': 0, 'id': 1, 'name': 1, 'avatar': 1, 'role': 1})
    if not u: raise HTTPException(404, 'Integrante não encontrado.')
    ops, pairs, days, _, creators = await collect(start, end)
    me = finish(ops.get(operator_id) or new_cell(), g)
    team = [finish(c, g) for oid, c in ops.items() if oid != operator_id]
    def med(k):
        xs = [t[k] for t in team if t.get(k) is not None]; return round(median(xs)) if xs else None
    by_creator = sorted([{**finish(pc, g), 'creator_id': cid, 'creator_name': creators.get(cid, 'Criadora excluída')} for (o, cid), pc in pairs.items() if o == operator_id],
                        key=lambda x: -(x['sales_cents'] or 0))
    series = []; d = start.astimezone(BRT).date(); last = (end - timedelta(seconds=1)).astimezone(BRT).date()
    mine = days.get(operator_id, {})
    while d <= last and len(series) < 93:
        k = d.strftime('%Y-%m-%d'); x = mine.get(k) or {}
        series.append({'day': k, 'sales_cents': x.get('sales_cents', 0), 'sales': x.get('sales', 0), 'responses': x.get('responses', 0),
                       'median_seconds': round(median(x['resp'])) if x.get('resp') else None})
        d += timedelta(days=1)
    ai = await ai_items(u['name'], start, end)
    return {'user': u, 'start': start.isoformat(), 'end': end.isoformat(), 'goals': g, 'totals': me, 'by_creator': by_creator, 'series': series,
            'team_median': {k: med(k) for k in ['median_seconds', 'within_goal_pct', 'conversion', 'sales_per_hour_cents', 'ticket_cents', 'fans_per_hour', 'offer_rate']},
            'ai': ai['items'], 'ai_score': ai['score']}

async def ai_items(name, start, end):
    """Itens das análises da IA sobre um chatter cujas conversas cruzam o período (mais recente primeiro)."""
    items = []
    for ins in await db.insights.find({'period_end': {'$gte': start.isoformat()}, 'period_start': {'$lt': end.isoformat()}}, {'_id': 0}).sort('created_at', -1).to_list(200):
        for it in ins.get('items', []):
            if (it.get('operator_name') or '').strip().lower() == name.strip().lower():
                items.append({**it, 'insight_id': ins['id'], 'created_at': ins['created_at'], 'period_start': ins['period_start'], 'period_end': ins['period_end'], 'summary': ins.get('summary'), 'recommendations': ins.get('recommendations')})
    def avg(k):
        xs = [a[k] for a in items if a.get(k) is not None]; return round(sum(xs) / len(xs), 1) if xs else None
    return {'items': items, 'score': avg('score'), 'engagement': avg('engagement'), 'dry_pct': avg('dry_pct')}

@router.get('/quality/chatter/{operator_id}/ai')
async def chatter_ai(operator_id: str, start: datetime | None = None, end: datetime | None = None, user=Depends(staff)):
    """Só a parte da IA do painel do chatter, com período próprio, e a média do período anterior de mesmo tamanho para a tendência."""
    start, end = window(start, end)
    u = await db.users.find_one({'id': operator_id}, {'_id': 0, 'name': 1})
    if not u: raise HTTPException(404, 'Integrante não encontrado.')
    cur = await ai_items(u['name'], start, end)
    prev = await ai_items(u['name'], start - (end - start), start)
    return {**cur, 'start': start.isoformat(), 'end': end.isoformat(), 'prev_score': prev['score'], 'prev_engagement': prev['engagement']}


@router.get('/quality/waiting')
async def waiting(creator_id: str = '', user=Depends(staff)):
    """Fãs esperando resposta há mais que o limite das metas (padrão 10 min), nas últimas 48 h, do maior tempo para o menor.
    Traz nome do fã (se a agência guarda nomes), criadora, chatter de turno agora, quanto o fã já gastou e a conversa para abrir no app."""
    t = now(); g = await goals(); limit = g.get('alert_minutes', 10) * 60
    data = await report_data(creator_id or None, None, (t - timedelta(hours=48)).isoformat(), None)
    rows = [p for p in data['pending'] if p['seconds'] >= limit]
    active = {sh['creator_id']: sh for sh in await db.shifts.find({'active': True}, {'_id': 0, 'creator_id': 1, 'operator_name': 1, 'operator_id': 1, 'paused': 1}).to_list(1000)}
    keys = [(p['creator_id'], p.get('fan_ref')) for p in rows if p.get('fan_ref')]
    radar = {}
    if keys:
        async for r in db.fan_radar.find({'$or': [{'creator_id': c, 'fan_ref': f} for c, f in keys[:500]]}, {'_id': 0, 'creator_id': 1, 'fan_ref': 1, 'cid': 1, 'platform': 1, 'spent_cents': 1, 'fan_name': 1}):
            radar[(r['creator_id'], r['fan_ref'])] = r
    spent = {}
    if keys:
        async for s in db.events.find({'kind': 'sale', 'fan_ref': {'$in': list({f for _, f in keys})}, 'sale_status': {'$nin': ['refunded', 'cancelled']}}, {'_id': 0, 'creator_id': 1, 'fan_ref': 1, 'amount_cents': 1}):
            k = (s['creator_id'], s['fan_ref']); spent[k] = spent.get(k, 0) + (s.get('amount_cents') or 0)
    out = []
    for p in rows:
        k = (p['creator_id'], p.get('fan_ref')); r = radar.get(k) or {}; sh = active.get(p['creator_id'])
        out.append({'creator_id': p['creator_id'], 'creator_name': p['creator_name'], 'fan_ref': p.get('fan_ref'), 'fan_name': p.get('fan_name') or r.get('fan_name'),
            'seconds': round(p['seconds']), 'waiting': human(p['seconds']), 'since': p.get('started_at'),
            'on_shift': sh['operator_name'] if sh else None, 'shift_paused': bool(sh and sh.get('paused')), 'blamed': p.get('operator_name'),
            'spent_cents': max(r.get('spent_cents') or 0, spent.get(k, 0)), 'cid': r.get('cid'), 'platform': r.get('platform') or 'privacy'})
    return {'limit_minutes': g.get('alert_minutes', 10), 'rows': out[:300], 'count': len(out)}
