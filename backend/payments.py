"""Meio de pagamento do WhatsApp de vendas (lote 161 manual; lote 164 Mercado Pago com split).

MERCADO PAGO (marketplace / split): cada criadora conecta a PRÓPRIA conta Mercado Pago ao aplicativo "Alta Pulse" da
agência (botão "Autorizar" → login dela no Mercado Pago → volta para /api/wa/mp/callback). Em cada pedido o sistema cria
um link de pagamento (Checkout Pro: Pix ou cartão) NA CONTA DELA, com a comissão da agência (marketplace_fee) separada
na hora para a conta da agência. O cliente vê o nome da criadora no Pix; na fatura do cartão, o nome configurado.
O Mercado Pago avisa o pagamento em /api/wa/mp/webhook; o sistema CONSULTA o pagamento na API (não confia no aviso)
e, aprovado, chama whatsapp.mark_paid.

.env do servidor: MP_CLIENT_ID (número do aplicativo), MP_CLIENT_SECRET (credencial de produção). Opcional: MP_REDIRECT_URI
(padrão: <APP_ORIGIN>/api/wa/mp/callback — cadastre o mesmo endereço em "URLs de redirecionamento" do aplicativo).
Os tokens de cada criadora ficam criptografados no banco (mesma chave do Cofre).
"""
import os, re, logging, secrets, html
from datetime import timedelta
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from core import db, now, iso, manager, audit, ORIGIN

router = APIRouter()
log = logging.getLogger('payments')
MP_API = 'https://api.mercadopago.com'
MP_AUTH = 'https://auth.mercadopago.com.br/authorization'

def mp_id(): return os.environ.get('MP_CLIENT_ID', '').strip()
def mp_secret(): return os.environ.get('MP_CLIENT_SECRET', '').strip()
def mp_ready(): return bool(mp_id() and mp_secret())
def redirect_uri(): return os.environ.get('MP_REDIRECT_URI', '').strip() or f"{ORIGIN.rstrip('/')}/api/wa/mp/callback"
def notify_url(): return f"{ORIGIN.rstrip('/')}/api/wa/mp/webhook"

async def _enc(v):
    from vault import fernet
    return (await fernet()).encrypt(v.encode()).decode()
async def _dec(v):
    from vault import fernet
    return (await fernet()).decrypt(v.encode()).decode()

async def _save_tokens(creator_id, data, by):
    row = {'creator_id': creator_id, 'mp_user_id': str(data.get('user_id') or ''), 'access': await _enc(data['access_token']),
           'refresh': await _enc(data.get('refresh_token') or ''), 'expires_at': (now() + timedelta(seconds=int(data.get('expires_in') or 15552000))).isoformat(),
           'connected_at': iso(), 'connected_by': by, 'public_key': data.get('public_key') or ''}
    await db.mp_accounts.update_one({'creator_id': creator_id}, {'$set': row}, upsert=True)

async def seller_token(creator_id):
    """Token da conta Mercado Pago da criadora; renova sozinho quando faltam menos de 15 dias."""
    row = await db.mp_accounts.find_one({'creator_id': creator_id}, {'_id': 0})
    if not row or not mp_ready(): return None
    if row.get('expires_at', '') < (now() + timedelta(days=15)).isoformat() and row.get('refresh'):
        try:
            async with httpx.AsyncClient(timeout=20) as c:
                r = await c.post(f'{MP_API}/oauth/token', json={'client_id': mp_id(), 'client_secret': mp_secret(), 'grant_type': 'refresh_token', 'refresh_token': await _dec(row['refresh'])})
            if r.status_code < 300: await _save_tokens(creator_id, r.json(), row.get('connected_by') or 'renovação'); row = await db.mp_accounts.find_one({'creator_id': creator_id}, {'_id': 0})
            else: log.warning('mp refresh %s %s', r.status_code, r.text[:200])
        except Exception as e: log.warning('mp refresh: %s', e)
    try: return await _dec(row['access'])
    except Exception: return None

# ---------- cobrança ----------
async def create_charge(cfg, contact, order):
    pay = cfg.get('pay') or {}
    if pay.get('provider') == 'mercadopago':
        tok = await seller_token(cfg['creator_id'])
        if tok:
            cents = int(order['cents']); fee_cents = cents - cents * int(order.get('creator_pct') or 0) // 100
            desc = re.sub(r'[^A-Za-z0-9]', '', pay.get('descriptor') or 'CREATORALTA').upper()[:13] or 'CREATORALTA'
            body = {'items': [{'id': order['item_id'], 'title': order['item'][:60], 'quantity': 1, 'unit_price': round(cents / 100, 2), 'currency_id': 'BRL'}],
                    'external_reference': order['id'], 'notification_url': notify_url(), 'statement_descriptor': desc,
                    'marketplace_fee': round(fee_cents / 100, 2), 'binary_mode': True,
                    'expires': True, 'expiration_date_from': now().isoformat(timespec='milliseconds'),
                    'expiration_date_to': (now() + timedelta(minutes=int(pay.get('hold_min') or 15))).isoformat(timespec='milliseconds'),
                    'date_of_expiration': (now() + timedelta(minutes=int(pay.get('hold_min') or 15))).isoformat(timespec='milliseconds'),
                    'payment_methods': {'installments': 1, 'excluded_payment_types': [{'id': 'ticket'}]}}
            try:
                async with httpx.AsyncClient(timeout=20) as c:
                    r = await c.post(f'{MP_API}/checkout/preferences', headers={'Authorization': f'Bearer {tok}', 'X-Idempotency-Key': order['id']}, json=body)
                if r.status_code < 300:
                    d = r.json()
                    return {'provider': 'mercadopago', 'link': d.get('init_point'), 'preference_id': d.get('id'), 'fee_cents': fee_cents,
                            'text': 'é só tocar no link pra pagar no Pix ou no cartão:'}
                log.warning('mp preference %s %s', r.status_code, r.text[:300])
            except Exception as e: log.warning('mp preference: %s', e)
        log.info('mercado pago indisponível para %s: usando manual', cfg['creator_id'])
    text = (pay.get('pix_text') or '').strip() or 'já já te mando a chave Pix por aqui'
    return {'provider': 'manual', 'text': text, 'link': None}

# ---------- conectar a conta da criadora (gestor gera o link, a criadora autoriza) ----------
@router.get('/wa/mp/status/{creator_id}')
async def mp_status(creator_id: str, user=Depends(manager)):
    row = await db.mp_accounts.find_one({'creator_id': creator_id}, {'_id': 0, 'access': 0, 'refresh': 0})
    return {'ready': mp_ready(), 'connected': bool(row), 'mp_user_id': (row or {}).get('mp_user_id'), 'connected_at': (row or {}).get('connected_at'), 'redirect_uri': redirect_uri()}

@router.post('/wa/mp/link/{creator_id}')
async def mp_link(creator_id: str, user=Depends(manager)):
    if not mp_ready(): raise HTTPException(409, 'O Mercado Pago ainda não foi configurado no servidor (MP_CLIENT_ID e MP_CLIENT_SECRET).')
    if not await db.creators.find_one({'id': creator_id}, {'_id': 1}): raise HTTPException(404, 'Criadora não encontrada.')
    state = secrets.token_urlsafe(24)
    await db.mp_states.insert_one({'state': state, 'creator_id': creator_id, 'by': user['name'], 'expires_at': now() + timedelta(days=3)})
    from urllib.parse import urlencode
    url = MP_AUTH + '?' + urlencode({'client_id': mp_id(), 'response_type': 'code', 'platform_id': 'mp', 'state': state, 'redirect_uri': redirect_uri()})
    await audit(user, 'Mercado Pago: link de autorização gerado', creator_id)
    return {'url': url, 'valid_days': 3}

@router.post('/wa/mp/disconnect/{creator_id}')
async def mp_disconnect(creator_id: str, user=Depends(manager)):
    await db.mp_accounts.delete_many({'creator_id': creator_id}); await audit(user, 'Mercado Pago: conta da criadora desconectada', creator_id)
    return {'ok': True}

def _page(title, msg):
    return HTMLResponse(f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title>
<style>body{{margin:0;font-family:system-ui,sans-serif;background:#f7f7f8;color:#262629;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}}
.c{{background:#fff;border:1px solid #e7e7e9;border-radius:12px;padding:28px;max-width:420px;text-align:center}}h1{{font-size:22px;margin:0 0 10px;color:#C41E3A}}p{{margin:0;color:#53535b;line-height:1.5}}</style></head>
<body><div class="c"><h1>{html.escape(title)}</h1><p>{html.escape(msg)}</p></div></body></html>""")

@router.get('/wa/mp/callback')
async def mp_callback(request: Request):
    q = request.query_params; code, state = q.get('code'), q.get('state')
    row = await db.mp_states.find_one_and_delete({'state': state or '-', 'expires_at': {'$gt': now()}}) if state else None
    if not row or not code: return _page('Link vencido', 'Este link de autorização não vale mais. Peça um novo para a equipe da Alta.')
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(f'{MP_API}/oauth/token', json={'client_id': mp_id(), 'client_secret': mp_secret(), 'grant_type': 'authorization_code', 'code': code, 'redirect_uri': redirect_uri()})
        if r.status_code >= 300:
            log.warning('mp oauth %s %s', r.status_code, r.text[:300]); return _page('Não deu certo', 'O Mercado Pago não confirmou a autorização. Peça um novo link para a equipe da Alta.')
        await _save_tokens(row['creator_id'], r.json(), row.get('by') or 'criadora')
    except Exception:
        log.exception('mp oauth'); return _page('Não deu certo', 'Falhou a conexão com o Mercado Pago. Tente de novo em alguns minutos.')
    return _page('Conta conectada!', 'Pronto. As vendas pelo WhatsApp agora caem direto na sua conta Mercado Pago. Pode fechar esta página.')

# ---------- aviso de pagamento ----------
@router.post('/wa/mp/webhook')
async def mp_webhook(request: Request):
    try: body = await request.json()
    except Exception: body = {}
    q = request.query_params
    pid = str(((body.get('data') or {}).get('id')) or q.get('data.id') or q.get('id') or '')
    kind = body.get('type') or body.get('topic') or q.get('type') or q.get('topic')
    seller = str(body.get('user_id') or '')
    if kind != 'payment' or not re.fullmatch(r'\d{3,30}', pid): return {'ok': True}
    accts = await db.mp_accounts.find({'mp_user_id': seller} if seller else {}, {'_id': 0, 'creator_id': 1}).to_list(200)
    for a in accts:  # consulta o pagamento na conta da criadora; só confia no que a API devolver
        tok = await seller_token(a['creator_id'])
        if not tok: continue
        try:
            async with httpx.AsyncClient(timeout=20) as c:
                r = await c.get(f'{MP_API}/v1/payments/{pid}', headers={'Authorization': f'Bearer {tok}'})
        except Exception: continue
        if r.status_code != 200: continue
        p = r.json(); ref = str(p.get('external_reference') or '')
        o = await db.wa_orders.find_one({'id': ref, 'creator_id': a['creator_id']}, {'_id': 0}) if ref else None
        if not o: continue
        await db.wa_orders.update_one({'id': ref}, {'$set': {'mp_payment_id': pid, 'mp_status': p.get('status'), 'mp_method': p.get('payment_type_id')}})
        if p.get('status') == 'approved' and abs(round(float(p.get('transaction_amount') or 0) * 100) - int(o['cents'])) <= 1:
            import whatsapp as W
            try: await W.mark_paid(ref, 'Mercado Pago')
            except HTTPException: pass
        elif p.get('status') in ('refunded', 'charged_back') and o['status'] == 'pago':
            await db.wa_orders.update_one({'id': ref}, {'$set': {'status': 'devolvido', 'cancel_note': f"Mercado Pago: {p.get('status')}", 'cancel_at': iso()}})
        break
    return {'ok': True}
