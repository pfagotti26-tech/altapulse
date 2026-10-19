"""Lote 143 (Paulo): teste de faixas de preço por item (ex.: vídeo curto da Aline em 39,90 · 45 · 49,90 · 59,90).

- Cada fã recebe SEMPRE a mesma faixa (gravada em price_test_assign): ninguém vê o preço mudar, nunca vira desconto.
- Só para quem ainda não comprou (fã com ticket médio já tem preço próprio: ticket + 20%).
- Escolha da faixa: até cada faixa ter MIN_OFFERS fãs com oferta, vai para a que tem menos; depois, amostragem
  de Thompson pelo dinheiro esperado por oferta (Beta(1+pagos, 1+não pagos) × preço) — a faixa que rende mais
  passa a receber mais ofertas sozinha, sem parar de testar as outras.
- Pago = solicitação paga (media_requests) do mesmo fã e mesmo valor depois da 1ª oferta.
"""
import random
from datetime import datetime, timezone
from core import db, iso, uid

MIN_OFFERS = 8


async def active_test(creator_id, item):
    if not creator_id or not item: return None
    return await db.price_tests.find_one({'creator_id': creator_id, 'item': item, 'active': True}, {'_id': 0})


async def _stats(test):
    """Por faixa: fãs com oferta, fãs que pagaram aquele valor depois da oferta."""
    out = {c: {'cents': c, 'offers': 0, 'paid': 0} for c in test['variants']}
    rows = await db.price_test_assign.find({'test_id': test['id'], 'offered_at': {'$ne': None}}, {'_id': 0}).to_list(20000)
    for r in rows:
        s = out.get(r['cents'])
        if not s: continue
        s['offers'] += 1
        if await db.media_requests.find_one({'creator_id': test['creator_id'], 'fan_ref': r['fan_ref'], 'amount_cents': r['cents'],
                                            'paid_seen_at': {'$gte': r['offered_at']}}, {'_id': 1}):
            s['paid'] += 1
    for s in out.values():
        s['conv'] = round(s['paid'] / s['offers'], 3) if s['offers'] else 0
        s['revenue_cents'] = s['paid'] * s['cents']
        s['per_offer_cents'] = round(s['revenue_cents'] / s['offers']) if s['offers'] else 0
    return list(out.values())


def _choose(stats):
    few = [s for s in stats if s['offers'] < MIN_OFFERS]
    if few: return min(few, key=lambda s: (s['offers'], random.random()))['cents']
    return max(stats, key=lambda s: random.betavariate(1 + s['paid'], 1 + s['offers'] - s['paid']) * s['cents'])['cents']


async def price_for(creator_id, item, fan_ref, is_buyer):
    """Valor da faixa deste fã (fixo depois de escolhido) ou None quando não há teste/não se aplica."""
    if not fan_ref or is_buyer: return None
    test = await active_test(creator_id, item)
    if not test: return None
    got = await db.price_test_assign.find_one({'test_id': test['id'], 'fan_ref': fan_ref}, {'_id': 0, 'cents': 1})
    if got: return got['cents']
    cents = _choose(await _stats(test))
    await db.price_test_assign.update_one({'test_id': test['id'], 'fan_ref': fan_ref},
        {'$setOnInsert': {'id': uid(), 'test_id': test['id'], 'creator_id': creator_id, 'item': item, 'fan_ref': fan_ref, 'cents': cents,
                          'assigned_at': iso(), 'offered_at': None, 'offers': 0}}, upsert=True)
    got = await db.price_test_assign.find_one({'test_id': test['id'], 'fan_ref': fan_ref}, {'_id': 0, 'cents': 1})
    return got['cents']


async def mark_offer(creator_id, item, fan_ref):
    test = await active_test(creator_id, item)
    if not test or not fan_ref: return
    await db.price_test_assign.update_one({'test_id': test['id'], 'fan_ref': fan_ref, 'offered_at': None}, {'$set': {'offered_at': iso()}})
    await db.price_test_assign.update_one({'test_id': test['id'], 'fan_ref': fan_ref}, {'$inc': {'offers': 1}})


async def item_for_cents(creator_id, cents):
    """Valor pago que não está na tabela mas é faixa de um teste → nome do item (para o pedido de entrega)."""
    t = await db.price_tests.find_one({'creator_id': creator_id, 'variants': cents}, {'_id': 0, 'item': 1})
    return (t or {}).get('item') or ''


async def report(creator_id=''):
    q = {'creator_id': creator_id} if creator_id else {}
    tests = await db.price_tests.find(q, {'_id': 0}).sort('created_at', -1).to_list(50)
    out = []
    for t in tests:
        st = await _stats(t)
        best = max(st, key=lambda s: s['per_offer_cents']) if any(s['offers'] for s in st) else None
        out.append({**t, 'variants_stats': st, 'leader_cents': best['cents'] if best else None,
                    'total_offers': sum(s['offers'] for s in st), 'total_paid': sum(s['paid'] for s in st)})
    return out


async def create(creator_id, item, variants, user):
    variants = sorted({int(v) for v in variants if int(v) >= 500})
    if len(variants) < 2: raise ValueError('Informe pelo menos 2 faixas de preço (R$ 5 ou mais).')
    await db.price_tests.update_many({'creator_id': creator_id, 'item': item, 'active': True}, {'$set': {'active': False, 'ended_at': iso()}})
    t = {'id': uid(), 'creator_id': creator_id, 'item': item, 'variants': variants, 'active': True, 'created_at': iso(),
         'by_id': user['id'], 'by_name': user['name']}
    await db.price_tests.insert_one(dict(t))
    return t
