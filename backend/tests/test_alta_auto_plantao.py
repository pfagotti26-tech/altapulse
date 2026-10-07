"""ALTA AUTO: árvore de decisão do modo "segurar a conversa" e travas de texto (sem banco e sem xAI)."""
import asyncio
import sys
import types

sys.path.insert(0, '/app/backend')
import plantao  # noqa: E402

USER = {'id': 'u1', 'name': 'QA'}


class Coll:
    def __init__(self, docs=None): self.docs, self.inserted, self.updates = docs or [], [], []
    async def find_one(self, q, p=None, **kw):
        for d in self.docs:
            if all(d.get(k) == v for k, v in q.items() if not isinstance(v, dict)): return d
        return None
    async def insert_one(self, doc): self.inserted.append(doc); return types.SimpleNamespace(inserted_id='x')
    async def update_one(self, q, u, upsert=False): self.updates.append((q, u)); return types.SimpleNamespace(matched_count=1)


class FakeDB:
    def __init__(self, cfg):
        self.plantao_configs = Coll([cfg])
        self.creators = Coll([{'id': 'c1', 'name': 'Mel'}])
        self.assist_profiles = Coll([{'creator_id': 'c1', 'style': 'doce', 'persona': {}, 'limits': ''}])
        self.plantao_log, self.opportunities, self.assist_alerts = Coll(), Coll(), Coll()


def run(cfg, msgs, hold_count=0, grok=None):
    plantao.db = FakeDB({**{'creator_id': 'c1', 'enabled': True, 'after_reply': 'hold', 'hold_max': 2}, **cfg})
    plantao.expiration = lambda: asyncio.sleep(0, result=None)
    if grok is not None: plantao.grok = grok
    body = plantao.ReplyIn(creator_id='c1', fan_ref='f1', fan_name='Joao',
                           msgs=[plantao.Msg(ours=o, text=t) for o, t in msgs], hold_count=hold_count)
    return asyncio.run(plantao.app_reply(body, USER)), plantao.db


FAN = lambda t: [(True, 'oi, sumido…'), (False, t)]
CASES = [
    ('handoff configurado', {'after_reply': 'handoff'}, FAN('oi'), 0, 'entregar'),
    ('plantao desligado', {'enabled': False}, FAN('oi'), 0, 'desligado'),
    ('limite de holds', {}, FAN('oi'), 2, 'limite'),
    ('menor de idade', {}, FAN('tenho 16 anos'), 0, 'menor'),
    ('perguntou se e bot', {}, FAN('vc é um bot?'), 0, 'robô'),
    ('pediu contato', {}, FAN('me passa seu whatsapp'), 0, 'contato'),
    ('pediu preco', {}, FAN('quanto custa um pack?'), 0, 'preço'),
]

fails = []
for name, cfg, msgs, hc, expect in CASES:
    out, db = run(cfg, msgs, hc)
    ok = out['stop'] and expect in out['reason']
    print(f"{'OK ' if ok else 'FAIL'} {name}: stop={out['stop']} reason={out['reason']!r}")
    if not ok: fails.append(name)

# menor de idade gera alerta para o gestor
out, db = run({}, FAN('tenho 15 anos'))
ok = len(db.assist_alerts.inserted) == 1
print(f"{'OK ' if ok else 'FAIL'} alerta de menor registrado: {len(db.assist_alerts.inserted)}")
if not ok: fails.append('alerta menor')

# pedido de preco/contato marca a oportunidade como quente
out, db = run({}, FAN('quanto é a chamada?'))
hot = db.opportunities.updates and db.opportunities.updates[0][1]['$set'].get('hot')
print(f"{'OK ' if hot else 'FAIL'} oportunidade quente no pedido de preço: hot={hot}")
if not hot: fails.append('hot')

# resposta boa da Grok passa e fica registrada
async def good(s, p, temperature=0.9): return {'parar': False, 'texto': 'oi, que bom te ver por aqui 😊 como foi seu dia?'}, None
out, db = run({}, FAN('tudo bem e vc?'), grok=good)
ok = out['stop'] is False and out['text'].startswith('oi')
logged = [r for r in db.plantao_log.inserted if r['kind'] == 'reply' and r['text']]
print(f"{'OK ' if ok else 'FAIL'} resposta liberada: {out}")
print(f"{'OK ' if logged and 'sent_at' not in logged[0] else 'FAIL'} registrada em plantao_log sem sent_at")
if not ok: fails.append('resposta boa')
if not (logged and 'sent_at' not in logged[0]): fails.append('log reply')

# travas na saída da Grok
for bad, why in [('são R$ 50 reais', 'valor'), ('tenho 30 fotos novas', 'número'), ('me chama no telegram', 'contato')]:
    async def g(s, p, temperature=0.9, _b=bad): return {'parar': False, 'texto': _b}, None
    out, db = run({}, FAN('tudo bem?'), grok=g)
    ok = out['stop'] is True
    print(f"{'OK ' if ok else 'FAIL'} trava de saída ({why}): {out}")
    if not ok: fails.append('trava ' + why)

# safe_text direto
for t, should in [('oi, que saudade 😊', True), ('custa R$ 10', False), ('tenho 25 ideias', False), ('me manda no zap', False), ('oi!', True)]:
    text, blocked = plantao.safe_text(t)
    ok = (text is not None) == should
    print(f"{'OK ' if ok else 'FAIL'} safe_text({t!r}) -> {text!r} / {blocked!r}")
    if not ok: fails.append('safe_text ' + t)

print('\nRESULTADO:', 'TODOS OK' if not fails else f'{len(fails)} FALHAS: {fails}')
sys.exit(1 if fails else 0)
