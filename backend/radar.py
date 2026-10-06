"""Radar de oportunidades (fase 1, sem IA).

O app lê de leve a lista de conversas da Privacy (sem abrir chats): quanto cada fã já gastou, quem falou por
último e quando, mensagens não lidas e se a última mensagem do fã tem cara de pedido de compra (a palavra é
avaliada no computador do chatter; o texto NUNCA é enviado). Junto com vendas, ofertas e assinantes que o
painel já tem, o servidor gera oportunidades com motivo e valor esperado:

  pediu_preco    fã perguntou preço / pediu conteúdo e ainda não recebeu oferta           (quente: alerta na hora)
  oferta_aberta  oferta enviada há 24 h–3 dias e ainda não paga
  novo_sem_compra assinante ativo há 2–7 dias sem nenhuma compra
  esfriando      baleia/spender da criadora há 10–30 dias sem comprar
  voltou         fã que já gastou e voltou a mandar mensagem depois de 14+ dias

O chatter vê a fila no app (abre a conversa com um clique) e marca como feita ou dispensa; quando ele responde
ou oferta para aquele fã, a oportunidade é marcada sozinha. O gestor vê o aproveitamento na Qualidade.
"""
from datetime import datetime, timedelta
from typing import Optional, Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from core import db, now, iso, uid, manager, settings, clean_time, WORKSPACE
from schemas import Strict

router = APIRouter()
TTL = {'pediu_preco': timedelta(hours=12), 'oferta_aberta': timedelta(days=3), 'novo_sem_compra': timedelta(days=3), 'esfriando': timedelta(days=4), 'voltou': timedelta(days=1)}
LABEL = {'pediu_preco': 'Pediu preço / conteúdo', 'oferta_aberta': 'Oferta sem pagamento', 'novo_sem_compra': 'Assinante novo sem compra',
         'esfriando': 'Bom comprador esfriando', 'voltou': 'Voltou a falar'}
CONVERT_DAYS = 2
OFFER_MAX_DAYS = 3
MIN_RETURN_DAYS = 14

def money_br(c): return 'R$ ' + f"{(c or 0)/100:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')

# ---------- leitura da lista (app) ----------
class RadarRow(Strict):
    fan_ref: str = Field(pattern=r'^[a-f0-9]{64}$')
    fan_name: Optional[str] = Field(default=None, max_length=80)
    cid: Optional[str] = Field(default=None, max_length=80)
    spent_cents: Optional[int] = Field(default=None, ge=0, le=100000000)
    last_from: Optional[Literal['fan', 'us']] = None
    last_at: Optional[datetime] = None
    unread: int = Field(default=0, ge=0, le=9999)
    intent: bool = False
class RadarIn(Strict):
    creator_id: str = Field(max_length=64)
    platform: Literal['privacy', 'onlyfans', 'fatalfans', 'closefans'] = 'privacy'
    rows: list[RadarRow] = Field(max_length=500)

async def save_radar(body: RadarIn, user):
    config = await settings()
    if not config.get('storage_allowed'): raise HTTPException(409, 'Armazenamento de métricas desabilitado.')
    if user['role'] != 'manager' and body.creator_id not in (user.get('creator_ids') or []): raise HTTPException(403, 'Criadora não autorizada.')
    if not await db.creators.find_one({'id': body.creator_id, 'deleted_at': None}, {'_id': 1}): raise HTTPException(404, 'Criadora não encontrada.')
    names = bool(config.get('fan_names_allowed')); t = now(); stamp = t.isoformat()
    for r in body.rows:
        key = {'creator_id': body.creator_id, 'fan_ref': r.fan_ref}
        old = await db.fan_radar.find_one(key, {'_id': 0}) or {}
        last_at = clean_time(r.last_at) if r.last_at else old.get('last_at')
        patch = {'platform': body.platform, 'seen_at': stamp, 'unread': r.unread, 'workspace_id': WORKSPACE, 'expires_at': t + timedelta(days=120)}
        if r.last_from: patch['last_from'] = r.last_from
        if last_at: patch['last_at'] = last_at
        if r.spent_cents is not None: patch['spent_cents'] = r.spent_cents
        if r.cid: patch['cid'] = r.cid
        if names and r.fan_name: patch['fan_name'] = r.fan_name
        # pedido de compra: vale para a mensagem atual do fã (mesmo horário não gera de novo)
        if r.intent and r.last_from == 'fan' and last_at and old.get('asked_last_at') != last_at: patch['asked_at'] = stamp; patch['asked_last_at'] = last_at
        # voltou a falar: fã escreveu agora e a conversa estava parada havia 14+ dias
        if r.last_from == 'fan' and last_at and old.get('last_at') and old.get('last_at') != last_at:
            if datetime.fromisoformat(last_at) - datetime.fromisoformat(old['last_at']) >= timedelta(days=MIN_RETURN_DAYS): patch['returned_at'] = stamp
        await db.fan_radar.update_one(key, {'$set': patch, '$setOnInsert': {'first_seen_at': stamp}}, upsert=True)
    await refresh_creator(body.creator_id)
    return {'ok': True, 'saved': len(body.rows)}

# ---------- geração ----------
async def _names(creator_id, refs):
    out = {}
    if not refs: return out
    async for r in db.fan_radar.find({'creator_id': creator_id, 'fan_ref': {'$in': refs}}, {'_id': 0, 'fan_ref': 1, 'fan_name': 1, 'cid': 1}): out[r['fan_ref']] = r
    async for s in db.subscribers.find({'creator_id': creator_id, 'fan_ref': {'$in': refs}, 'fan_name': {'$ne': None}}, {'_id': 0, 'fan_ref': 1, 'fan_name': 1}):
        out.setdefault(s['fan_ref'], {}).setdefault('fan_name', s['fan_name'])
        if not out[s['fan_ref']].get('fan_name'): out[s['fan_ref']]['fan_name'] = s['fan_name']
    return out

async def _upsert(creator, fan_ref, kind, key, value_cents, reason, info, t):
    """Uma oportunidade aberta por (fã, tipo, chave). Já existente (aberta ou resolvida) não é recriada."""
    ref = f"{kind}:{key}"
    if await db.opportunities.find_one({'creator_id': creator['id'], 'fan_ref': fan_ref, 'ref': ref}, {'_id': 1}): return False
    # um fã com oportunidade aberta de outro tipo: mantém só a mais valiosa visível (evita alerta duplicado)
    await db.opportunities.insert_one({'id': uid(), 'creator_id': creator['id'], 'creator_name': creator['name'], 'fan_ref': fan_ref, 'fan_name': (info or {}).get('fan_name'),
        'cid': (info or {}).get('cid'), 'platform': (info or {}).get('platform') or 'privacy', 'kind': kind, 'ref': ref, 'reason': reason, 'value_cents': int(value_cents or 0), 'hot': kind == 'pediu_preco',
        'source_at': (info or {}).get('_source_at'), 'status': 'open', 'created_at': t.isoformat(), 'due_at': (t + TTL[kind]).isoformat(), 'workspace_id': WORKSPACE, 'expires_at': t + timedelta(days=120)})
    return True

async def refresh_creator(creator_id):
    creator = await db.creators.find_one({'id': creator_id, 'deleted_at': None}, {'_id': 0, 'id': 1, 'name': 1})
    if not creator: return 0
    t = now(); created = 0
    from fans import tiers_for
    # vendas dos últimos 90 dias por fã (faixa baleia/spender e última compra)
    since90 = (t - timedelta(days=90)).isoformat()
    totals, last_buy, count = {}, {}, {}
    async for s in db.events.find({'creator_id': creator_id, 'kind': 'sale', 'fan_ref': {'$ne': None}, 'sale_status': {'$nin': ['refunded', 'cancelled']}, 'confirmed_at': {'$ne': None}},
                                  {'_id': 0, 'fan_ref': 1, 'amount_cents': 1, 'confirmed_at': 1}):
        f = s['fan_ref']; count[f] = count.get(f, 0) + 1
        if s['confirmed_at'] >= since90: totals[f] = totals.get(f, 0) + s['amount_cents']
        if s['confirmed_at'] > last_buy.get(f, ''): last_buy[f] = s['confirmed_at']
    tiers = tiers_for(totals)
    radar = {r['fan_ref']: r async for r in db.fan_radar.find({'creator_id': creator_id}, {'_id': 0})}
    # última oferta nossa por fã (para saber se o pedido já foi atendido)
    last_offer = {}
    async for o in db.events.find({'creator_id': creator_id, 'kind': 'offer', 'fan_ref': {'$ne': None}, 'offered_at': {'$gte': (t - timedelta(days=8)).isoformat()}},
                                  {'_id': 0, 'fan_ref': 1, 'offered_at': 1, 'offer_status': 1, 'amount_cents': 1, 'event_ref': 1}):
        if o['offered_at'] > (last_offer.get(o['fan_ref']) or {}).get('offered_at', ''): last_offer[o['fan_ref']] = o
    ticket = lambda f: round(totals[f] / max(1, count.get(f, 1))) if totals.get(f) else 0

    # 1) pediu preço / conteúdo e não recebeu oferta depois
    for f, r in radar.items():
        if r.get('asked_at') and r.get('last_from') == 'fan' and r['asked_at'] >= (t - TTL['pediu_preco']).isoformat():
            lo = last_offer.get(f)
            if lo and lo['offered_at'] >= r.get('asked_last_at', r['asked_at']): continue
            spent = r.get('spent_cents') or 0
            reason = 'Perguntou preço ou pediu conteúdo e ainda não recebeu oferta' + (f" · já gastou {money_br(spent)}" if spent else '')
            created += await _upsert(creator, f, 'pediu_preco', r.get('asked_last_at') or r['asked_at'], max(ticket(f), 3000), reason, r, t)
    # 2) oferta sem pagamento há 24 h–3 dias (mais antiga que isso vira ruído)
    for f, o in last_offer.items():
        if o.get('offer_status') == 'sent' and (t - timedelta(days=OFFER_MAX_DAYS)).isoformat() <= o['offered_at'] <= (t - timedelta(hours=24)).isoformat():
            if last_buy.get(f, '') > o['offered_at']: continue
            info = {**(radar.get(f) or (await _names(creator_id, [f])).get(f) or {}), '_source_at': o['offered_at']}
            created += await _upsert(creator, f, 'oferta_aberta', o['event_ref'], o.get('amount_cents') or 0, f"Oferta de {money_br(o.get('amount_cents'))} enviada e ainda não paga: retome com leveza antes de mandar outra", info, t)
    # 3) assinante novo (2–7 dias) sem compra
    async for s in db.subscribers.find({'creator_id': creator_id, 'active': True, 'first_seen_at': {'$gte': (t - timedelta(days=7)).isoformat(), '$lte': (t - timedelta(days=2)).isoformat()}}, {'_id': 0}):
        f = s['fan_ref']
        if count.get(f): continue
        info = radar.get(f) or {'fan_name': s.get('fan_name')}
        created += await _upsert(creator, f, 'novo_sem_compra', s['first_seen_at'][:10], s.get('price_cents') or 3000, 'Assinou há poucos dias e ainda não comprou: melhor janela para a primeira oferta', info, t)
    # 4) baleia / spender esfriando (10–30 dias sem comprar)
    for f, tier in tiers.items():
        if tier not in ['baleia', 'spender'] or not last_buy.get(f): continue
        days = (t - datetime.fromisoformat(last_buy[f])).days
        if 10 <= days < 30:
            info = radar.get(f) or (await _names(creator_id, [f])).get(f)
            created += await _upsert(creator, f, 'esfriando', last_buy[f][:10], ticket(f), f"{'Baleia' if tier == 'baleia' else 'Bom comprador'} há {days} dias sem comprar (costuma gastar {money_br(ticket(f))} por compra): oferta exclusiva", info, t)
    # 5) voltou a falar depois de 14+ dias, e já gastou
    for f, r in radar.items():
        if r.get('returned_at') and r['returned_at'] >= (t - TTL['voltou']).isoformat() and ((r.get('spent_cents') or 0) > 0 or count.get(f)):
            created += await _upsert(creator, f, 'voltou', r['returned_at'][:13], max(ticket(f), 2000), f"Voltou a mandar mensagem depois de {MIN_RETURN_DAYS}+ dias parado · já gastou {money_br(r.get('spent_cents') or totals.get(f))}", r, t)
    await settle(creator_id)
    return created

def _offer_too_old(o, t, offered):
    at = o.get('source_at') or offered.get((o['creator_id'], o['ref'].split(':', 1)[1]))
    return bool(at) and at < (t - timedelta(days=OFFER_MAX_DAYS)).isoformat()

_settled_at = {}
async def settle(creator_id=None, min_gap=45):
    """Marca como 'atendida' quando houve resposta/oferta nossa ao fã depois de criada; expira as vencidas.
    Tudo em poucas consultas (antes era uma consulta por oportunidade e a página estourava o tempo)."""
    from pymongo import UpdateOne
    t = now(); key = creator_id or '*'
    if (t - _settled_at.get(key, t - timedelta(days=1))).total_seconds() < min_gap: return
    _settled_at[key] = t
    q = {'status': 'open'}
    if creator_id: q['creator_id'] = creator_id
    opens = await db.opportunities.find(q, {'_id': 0}).to_list(20000)
    if not opens: return
    creators = sorted({o['creator_id'] for o in opens}); since = min(o['created_at'] for o in opens)
    # respostas/ofertas nossas desde a oportunidade mais antiga, agrupadas por (criadora, fã)
    acts = {}
    async for ev in db.events.find({'creator_id': {'$in': creators}, 'kind': {'$in': ['response', 'offer']}, '$or': [{'responded_at': {'$gte': since}}, {'offered_at': {'$gte': since}}]},
                                   {'_id': 0, 'creator_id': 1, 'fan_ref': 1, 'kind': 1, 'responded_at': 1, 'offered_at': 1, 'event_ref': 1}):
        acts.setdefault((ev['creator_id'], ev.get('fan_ref')), []).append(ev)
    # ofertas (para saber a idade das "oferta_aberta" sem source_at)
    offered = {}
    refs = [(o['creator_id'], o['ref'].split(':', 1)[1]) for o in opens if o['kind'] == 'oferta_aberta' and not o.get('source_at')]
    if refs:
        async for ev in db.events.find({'creator_id': {'$in': sorted({c for c, _ in refs})}, 'event_ref': {'$in': sorted({r for _, r in refs})}}, {'_id': 0, 'creator_id': 1, 'event_ref': 1, 'offered_at': 1}):
            offered[(ev['creator_id'], ev['event_ref'])] = ev.get('offered_at')
    # turnos das criadoras (quem estava atendendo na hora da resposta)
    shifts = {}
    async for sh in db.shifts.find({'creator_id': {'$in': creators}}, {'_id': 0, 'creator_id': 1, 'started_at': 1, 'operator_id': 1, 'operator_name': 1}).sort('started_at', 1):
        shifts.setdefault(sh['creator_id'], []).append(sh)
    def who_at(cid, when):
        best = None
        for sh in shifts.get(cid, []):
            if sh['started_at'] <= when: best = sh
            else: break
        return best or {}
    ops = []
    for o in opens:
        evs = [e for e in acts.get((o['creator_id'], o['fan_ref']), []) if (e.get('responded_at') if e['kind'] == 'response' else e.get('offered_at')) and (e.get('responded_at') if e['kind'] == 'response' else e.get('offered_at')) >= o['created_at']]
        if evs:
            ev = min(evs, key=lambda e: e.get('responded_at') or e.get('offered_at')); when = ev.get('responded_at') or ev.get('offered_at'); who = who_at(o['creator_id'], when)
            ops.append(UpdateOne({'id': o['id']}, {'$set': {'status': 'contacted', 'contacted_at': when, 'contacted_how': 'oferta' if ev['kind'] == 'offer' else 'resposta', 'contacted_by': who.get('operator_id'), 'contacted_name': who.get('operator_name')}}))
        elif o['kind'] == 'oferta_aberta' and _offer_too_old(o, t, offered):
            ops.append(UpdateOne({'id': o['id']}, {'$set': {'status': 'expired', 'stale': True}}))
        elif o['due_at'] < t.isoformat():
            ops.append(UpdateOne({'id': o['id']}, {'$set': {'status': 'expired'}}))
    if ops: await db.opportunities.bulk_write(ops, ordered=False)

async def sweep():
    for c in await db.creators.find({'deleted_at': None}, {'_id': 0, 'id': 1}).to_list(1000):
        try: await refresh_creator(c['id'])
        except Exception: pass

# ---------- resultado (conversão) ----------
async def with_result(rows):
    """Vendas do fã até CONVERT_DAYS depois do atendimento: uma consulta só, somada em memória."""
    for o in rows: o['converted_cents'] = 0; o['label'] = LABEL.get(o['kind'], o['kind'])
    if not rows: return rows
    creators = sorted({o['creator_id'] for o in rows}); since = min(o['created_at'] for o in rows)
    sales = {}
    async for s_ in db.events.find({'creator_id': {'$in': creators}, 'kind': 'sale', 'sale_status': {'$nin': ['refunded', 'cancelled']}, 'confirmed_at': {'$gte': since}},
                                   {'_id': 0, 'creator_id': 1, 'fan_ref': 1, 'amount_cents': 1, 'confirmed_at': 1}):
        sales.setdefault((s_['creator_id'], s_.get('fan_ref')), []).append(s_)
    for o in rows:
        start = o.get('contacted_at') or o['created_at']
        until = (datetime.fromisoformat(start) + timedelta(days=CONVERT_DAYS)).isoformat()
        for s_ in sales.get((o['creator_id'], o['fan_ref']), []):
            if o['created_at'] <= s_['confirmed_at'] <= until: o['converted_cents'] += s_.get('amount_cents') or 0
    return rows

# ---------- app do chatter ----------
async def my_opportunities(user):
    q = {'status': 'open', 'due_at': {'$gt': now().isoformat()}}
    if user['role'] != 'manager': q['creator_id'] = {'$in': user.get('creator_ids') or []}
    rows = await db.opportunities.find(q, {'_id': 0, 'expires_at': 0}).sort([('hot', -1), ('value_cents', -1)]).to_list(5000)
    # uma por fã: a quente primeiro, depois a mais valiosa (as outras do mesmo fã ficam guardadas)
    seen, out = set(), []
    for o in rows:
        k = (o['creator_id'], o['fan_ref'])
        if k in seen: continue
        seen.add(k); o['label'] = LABEL.get(o['kind'], o['kind']); out.append(o)
    return out[:2000]

class OppAction(Strict):
    action: Literal['contacted', 'dismissed']
    reason: str = Field(default='', max_length=120)
async def act(opp_id, body: OppAction, user):
    o = await db.opportunities.find_one({'id': opp_id}, {'_id': 0})
    if not o: raise HTTPException(404, 'Oportunidade não encontrada.')
    if user['role'] != 'manager' and o['creator_id'] not in (user.get('creator_ids') or []): raise HTTPException(403, 'Criadora não autorizada.')
    await db.opportunities.update_one({'id': opp_id}, {'$set': {'status': body.action, f"{body.action}_at": iso(), 'contacted_by' if body.action == 'contacted' else 'dismissed_by': user['id'],
        'contacted_name' if body.action == 'contacted' else 'dismissed_name': user['name'], 'dismiss_reason': body.reason if body.action == 'dismissed' else None, 'contacted_how': 'manual' if body.action == 'contacted' else None}})
    return {'ok': True}

# ---------- painel (gestor) ----------
@router.get('/quality/opportunities')
async def board(start: Optional[datetime] = None, end: Optional[datetime] = None, creator_id: str = '', operator_id: str = '', user=Depends(manager)):
    await settle()
    q = {'stale': {'$ne': True}}
    if start: q.setdefault('created_at', {})['$gte'] = clean_time(start)
    if end: q.setdefault('created_at', {})['$lt'] = clean_time(end)
    if creator_id: q['creator_id'] = creator_id
    rows = await with_result(await db.opportunities.find(q, {'_id': 0, 'expires_at': 0}).sort('created_at', -1).to_list(3000))
    if operator_id: rows = [o for o in rows if o.get('contacted_by') == operator_id or o.get('dismissed_by') == operator_id]
    def agg(items):
        a = {'total': len(items), 'open': 0, 'contacted': 0, 'dismissed': 0, 'expired': 0, 'converted': 0, 'converted_cents': 0, 'value_cents': 0}
        for o in items:
            a[o['status']] = a.get(o['status'], 0) + 1; a['value_cents'] += o.get('value_cents') or 0
            if o['converted_cents']: a['converted'] += 1; a['converted_cents'] += o['converted_cents']
        a['handled_pct'] = round(100 * a['contacted'] / max(1, a['total'] - a['open'])) if a['total'] - a['open'] else None
        a['conversion_pct'] = round(100 * a['converted'] / max(1, a['contacted'])) if a['contacted'] else None
        return a
    by_chatter, by_creator, by_kind = {}, {}, {}
    for o in rows:
        name = o.get('contacted_name') or o.get('dismissed_name') or 'Ninguém atendeu'
        by_chatter.setdefault(name, []).append(o); by_creator.setdefault(o['creator_name'], []).append(o); by_kind.setdefault(o['label'], []).append(o)
    pack = lambda d: sorted(({'name': k, **agg(v)} for k, v in d.items()), key=lambda x: -x['converted_cents'])
    return {'totals': agg(rows), 'by_chatter': pack(by_chatter), 'by_creator': pack(by_creator), 'by_kind': pack(by_kind), 'items': rows[:300], 'labels': LABEL}
