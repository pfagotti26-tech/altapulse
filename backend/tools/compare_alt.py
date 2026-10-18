"""Lote 136: compara a Grok com outro modelo (Venice) nas MESMAS conversas sintéticas.

Só conversas escritas à mão (compare_cases.json): nenhuma mensagem real de fã sai do servidor.
Com o flag _ALT a sugestão não usa exemplos aprovados nem frases de outros fãs e não grava nada no banco.

Uso (servidor de TESTE):
  docker exec altapulse-backend-1 python tools/compare_alt.py [creator_id] [modelo_venice]
Resultado: resumo na tela e /tmp/compare_alt.json dentro do container.
"""
import asyncio, json, os, sys, time
sys.path.insert(0, '/app')
from fastapi import HTTPException
from core import db
import assist as A
import profile_model as PM

CREATOR = sys.argv[1] if len(sys.argv) > 1 else '945c4c0feac54e7b42c21012'
VMODEL = sys.argv[2] if len(sys.argv) > 2 else 'olafangensan-glm-4.7-flash-heretic'
HERE = os.path.dirname(os.path.abspath(__file__))
CASES = json.load(open(os.path.join(HERE, 'compare_cases.json'), encoding='utf-8'))

def checks(res, case):
    """Travas do próprio sistema aplicadas na resposta final (depois da 2ª tentativa)."""
    if res.get('erro'): return ['erro']
    if res.get('alert'): return []
    t = res.get('text') or ''
    fan = [m[1] for m in case['msgs'] if not m[0]]
    extra = ' '.join(str(res.get(k) or '') for k in ('caption', 'after'))
    bad = []
    for name, hit in (('pagar', PM.pay_word(t + ' ' + extra)), ('negocia', PM.budget_talk(t)), ('feito-pra-ele', PM.made_for(t + ' ' + extra) if res.get('product') else ''),
                      ('familia', PM.family_word(t)), ('infantil', PM.plays_infant(t)), ('disse-que-viu', PM.claims_seen(t)),
                      ('aceitou-encontro', PM.accepts_meeting(t, fan)), ('chamada-promessa', PM.call_promise(t, fan)), ('papeis', PM.role_flip(t)),
                      ('valor-no-texto', 'r$' in t.lower())):
        if hit: bad.append(name)
    if len(PM._norm(t)) > 22: bad.append(f'longa({len(PM._norm(t))})')
    return bad

async def one(case, provider, user, sem):
    async with sem:
        A._ALT.set({'provider': provider, 'model': VMODEL if provider == 'venice' else ''})
        body = A.SuggestIn(creator_id=CREATOR, messages=[A.ChatMsg(ours=o, text=t) for o, t in case['msgs']], mode=case.get('modo', 'reply'))
        t0 = time.time()
        try: res = await A.suggest(body, user=user)
        except HTTPException as e: res = {'erro': f'{e.status_code} {e.detail}'}
        except Exception as e: res = {'erro': f'{e.__class__.__name__}: {e}'[:300]}
        alt = res.pop('_alt', None) or {}
        out = {'texto': res.get('text') or '', 'alerta': bool(res.get('alert')), 'motivo_alerta': res.get('reason') if res.get('alert') else '',
               'produto': (res.get('product') or {}).get('item', ''), 'legenda': res.get('caption', ''), 'depois': res.get('after', ''), 'aviso': res.get('warning', ''),
               'erro': res.get('erro', ''), 'refez': alt.get('retry') or [], 'primeira': (alt.get('first_try') or {}).get('texto', '') if alt.get('retry') else '',
               'custo_usd': alt.get('cost_usd') or 0, 'tokens_in': alt.get('prompt_tokens') or 0, 'tokens_cache': alt.get('cached_tokens') or 0,
               'tokens_out': alt.get('completion_tokens') or 0, 'segundos': round(time.time() - t0, 1), 'modelo': alt.get('model', '')}
        out['problemas'] = checks(res, case)
        return out

async def main():
    user = await db.users.find_one({'role': 'manager', 'active': True}, {'_id': 0, 'password_hash': 0})
    if not user: sys.exit('nenhum gestor ativo encontrado')
    if not os.environ.get('VENICE_API_KEY'): sys.exit('VENICE_API_KEY não está no .env do teste')
    sem = asyncio.Semaphore(3)
    rows = []
    for i, case in enumerate(CASES, 1):
        g, v = await asyncio.gather(one(case, 'xai', user, sem), one(case, 'venice', user, sem))
        rows.append({'id': case['id'], 'esperado': case['esperado'], 'modo': case.get('modo', 'reply'), 'conversa': case['msgs'], 'grok': g, 'venice': v})
        print(f"[{i:02d}/{len(CASES)}] {case['id']}")
        for tag, r in (('GROK ', g), ('GLM  ', v)):
            s = r['erro'] or (f"ALERTA: {r['motivo_alerta']}" if r['alerta'] else r['texto'])
            print(f"   {tag} {s[:160]}" + (f"  [produto: {r['produto']}]" if r['produto'] else '') + (f"  ⚠ {', '.join(r['problemas'])}" if r['problemas'] else '') + (f"  (refez)" if r['refez'] else ''))
    def tot(k):
        rs = [r[k] for r in rows]
        return {'custo_usd': round(sum(x['custo_usd'] for x in rs), 4), 'por_resposta_usd': round(sum(x['custo_usd'] for x in rs) / max(1, len(rs)), 5),
                'erros': sum(1 for x in rs if x['erro']), 'alertas': sum(1 for x in rs if x['alerta']), 'refez': sum(1 for x in rs if x['refez']),
                'com_problema': sum(1 for x in rs if x['problemas']), 'segundos_medio': round(sum(x['segundos'] for x in rs) / max(1, len(rs)), 1),
                'tokens_in_medio': int(sum(x['tokens_in'] for x in rs) / max(1, len(rs)))}
    summary = {'creator_id': CREATOR, 'modelo_venice': VMODEL, 'casos': len(rows), 'grok': tot('grok'), 'venice': tot('venice')}
    json.dump({'resumo': summary, 'casos': rows}, open(os.environ.get('CMP_OUT','/tmp/compare_alt.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\nRESUMO'); print(json.dumps(summary, ensure_ascii=False, indent=1)); print('\nArquivo: /tmp/compare_alt.json (dentro do container)')

if __name__ == '__main__':
    asyncio.run(main())
