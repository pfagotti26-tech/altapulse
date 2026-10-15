"""Lote 110 — mídia paga: depois que o fã PAGA a "Solicitação de mídia".

O app já informa cada oferta da conversa aberta (kind 'offer', offer_type 'request', offer_status 'sent'/'paid').
Quando uma solicitação passa para PAGA:
  1. abre um pedido em media_requests (aguardando entrega, prazo = ficha → "Prazo de entrega da mídia paga");
  2. manda e-mail para a equipe (MEDIA_EMAIL, padrão contato@altaagencydigital.com);
  3. cria a oportunidade quente "Entregar mídia" no app (o chatter toca em "Feito" quando entregar);
  4. a Alta Ajuda agradece uma vez ("já já te mando") e depois PAUSA aquele fã até alguém marcar entregue
     (Sugerir resposta avisa o chatter; a automação registra 'travado');
  5. passou do prazo sem entrega: novo e-mail "ATRASADA" e a oportunidade sobe de novo.
"""
import os, html, logging
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from schemas import Strict
from core import db, now, iso, uid, staff, is_staff, audit, settings, ORIGIN, WORKSPACE
import mailer

router = APIRouter()
log = logging.getLogger('media_requests')
MEDIA_EMAIL = os.environ.get('MEDIA_EMAIL', 'contato@altaagencydigital.com').strip()
FRESH = timedelta(hours=3)  # lote 111: solicitação paga mais antiga que isso (lida pela 1ª vez agora) não abre pedido: é histórico
money = lambda c: 'R$ ' + f"{(c or 0) / 100:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')


async def _profile_bits(creator_id, cents):
    prof = await db.assist_profiles.find_one({'creator_id': creator_id}, {'_id': 0, 'prices': 1, 'delivery': 1}) or {}
    item = next((p for p in (prof.get('prices') or []) if p.get('cents') == cents), None)
    hours = int(((prof.get('delivery') or {}).get('hours')) or 0) or 24
    return (item or {}).get('item') or '', (item or {}).get('category') or '', hours


async def _fan_info(creator_id, fan_ref):
    f = await db.fan_radar.find_one({'creator_id': creator_id, 'fan_ref': fan_ref}, {'_id': 0, 'fan_name': 1, 'cid': 1}) or {}
    cid = str(f.get('cid') or '')
    url = f'https://privacy.com.br/chat?cid={cid}' if cid and not cid.startswith(('n:', 'ff:')) else ''
    return f.get('fan_name') or '', cid, url


async def _email(req, late=False):
    agency = (await settings()).get('agency_name', 'Alta Pulse')
    e = html.escape
    what = f"{e(req.get('item') or 'Solicitação de mídia')} · <b>{e(money(req['amount_cents']))}</b>"
    task = 'ver a mídia que o fã mandou e responder (a IA não enxerga imagem)'
    due = datetime.fromisoformat(req['due_at']).astimezone().strftime('%d/%m %H:%M')
    intro = (f"<b>{e(req.get('fan_name') or 'Um assinante')}</b> pagou a solicitação de mídia de <b>{e(req['creator_name'])}</b> e mandou a mídia dele.<br>{what}<br><br>"
             f"Falta {task}. Prazo: <b>{e(due)}</b>. A Alta Ajuda pausou este fã até alguém marcar feito (app: oportunidade “Ver mídia paga do fã” → Feito; painel: Sombra → Mídias pagas).")
    if late: intro = '<b style="color:#c8102e">PASSOU DO PRAZO.</b> ' + intro
    link = req.get('chat_url') or (ORIGIN + '/sombra')
    subject = f"{'ATRASADA · ' if late else ''}Fã pagou e mandou mídia · {req['creator_name']} · {money(req['amount_cents'])}"
    body = mailer.layout(agency, ('Resposta atrasada' if late else 'Fã pagou e mandou mídia'), intro, 'Abrir conversa' if req.get('chat_url') else 'Abrir painel', link,
                         'Aviso automático do Alta Pulse quando uma Solicitação de mídia é paga.')
    ok = await mailer.send(MEDIA_EMAIL, subject, body)
    if not ok: log.warning('e-mail de mídia paga não saiu (Resend desligado ou erro)')
    return ok


async def _opportunity(req, t, late=False):
    reason = (f"Pagou {money(req['amount_cents'])}" + (f" ({req['item']})" if req.get('item') else '') +
              ' e mandou a mídia dele · ver, responder e tocar em Feito.' + (' ATRASADA.' if late else ''))
    ref = f"entregar_midia:{req['id']}"
    await db.opportunities.update_one({'creator_id': req['creator_id'], 'fan_ref': req['fan_ref'], 'ref': ref},
        {'$set': {'status': 'open', 'hot': True, 'reason': reason, 'due_at': (t + timedelta(days=3)).isoformat()},
         '$setOnInsert': {'id': uid(), 'creator_name': req['creator_name'], 'fan_name': req.get('fan_name'), 'cid': req.get('cid'), 'platform': 'privacy', 'kind': 'entregar_midia',
                          'value_cents': int(req['amount_cents'] or 0), 'media_request_id': req['id'], 'created_at': t.isoformat(), 'workspace_id': WORKSPACE, 'expires_at': t + timedelta(days=120)}},
        upsert=True)


async def on_paid(ev, old):
    """Chamado pelo ingest quando chega uma oferta 'request' paga. ev = linha gravada em events."""
    if ev.get('kind') != 'offer' or ev.get('offer_type') != 'request' or ev.get('offer_status') != 'paid' or not ev.get('fan_ref'): return
    if old and old.get('offer_status') == 'paid': return
    t = now()
    try:
        if not old and ev.get('offered_at') and datetime.fromisoformat(ev['offered_at']) < t - FRESH: return  # histórico lido agora
    except Exception: pass
    if await db.media_requests.find_one({'creator_id': ev['creator_id'], 'event_ref': ev['event_ref']}, {'_id': 1}): return
    creator = await db.creators.find_one({'id': ev['creator_id']}, {'_id': 0, 'name': 1}) or {}
    item, category, hours = await _profile_bits(ev['creator_id'], ev.get('amount_cents'))
    fan_name, cid, url = await _fan_info(ev['creator_id'], ev['fan_ref'])
    req = {'id': uid(), 'creator_id': ev['creator_id'], 'creator_name': creator.get('name') or '?', 'fan_ref': ev['fan_ref'], 'fan_name': ev.get('fan_name') or fan_name,
           'cid': cid, 'chat_url': url, 'event_ref': ev['event_ref'], 'amount_cents': ev.get('amount_cents'), 'item': item, 'category': category, 'media_type': ev.get('media_type'),
           'offered_at': ev.get('offered_at'), 'paid_seen_at': iso(), 'due_at': (t + timedelta(hours=hours)).isoformat(), 'status': 'aguardando',
           'acked_at': None, 'late_mailed': False, 'workspace_id': WORKSPACE, 'expires_at': t + timedelta(days=120)}
    await db.media_requests.insert_one(dict(req))
    await _opportunity(req, t)
    req['mailed'] = await _email(req)
    await db.media_requests.update_one({'id': req['id']}, {'$set': {'mailed': req['mailed']}})


async def open_for(creator_id, fan_ref):
    """Pedido pago ainda sem entrega deste fã (ou None) — a Alta Ajuda usa para agradecer uma vez e depois pausar."""
    if not fan_ref: return None
    return await db.media_requests.find_one({'creator_id': creator_id, 'fan_ref': fan_ref, 'status': 'aguardando'}, {'_id': 0}, sort=[('paid_seen_at', -1)])


async def mark_acked(req_id):
    await db.media_requests.update_one({'id': req_id, 'acked_at': None}, {'$set': {'acked_at': iso()}})


async def deliver(req_id, user, how='painel'):
    r = await db.media_requests.find_one_and_update({'id': req_id, 'status': 'aguardando'},
        {'$set': {'status': 'entregue', 'delivered_at': iso(), 'delivered_by': user['id'], 'delivered_name': user['name'], 'delivered_how': how}}, projection={'_id': 0})
    if not r: return None
    await db.opportunities.update_many({'ref': f"entregar_midia:{req_id}", 'status': 'open'},
        {'$set': {'status': 'contacted', 'contacted_at': iso(), 'contacted_by': user['id'], 'contacted_name': user['name'], 'contacted_how': 'entrega'}})
    return r


async def tick():
    """A cada ~10 min (varredura): pedido vencido sem entrega → e-mail ATRASADA uma vez e a oportunidade volta ao topo."""
    t = now()
    async for r in db.media_requests.find({'status': 'aguardando', 'late_mailed': False, 'due_at': {'$lt': t.isoformat()}}, {'_id': 0}):
        await db.media_requests.update_one({'id': r['id']}, {'$set': {'late_mailed': True}})
        await _opportunity(r, t, late=True)
        await _email(r, late=True)


@router.get('/media-requests')
async def list_requests(status: str = 'aguardando', creator_id: str = '', user=Depends(staff)):
    q = {} if status == 'todos' else {'status': status}
    if creator_id: q['creator_id'] = creator_id
    rows = await db.media_requests.find(q, {'_id': 0, 'expires_at': 0}).sort('paid_seen_at', -1).to_list(500)
    t = iso()
    for r in rows: r['late'] = r['status'] == 'aguardando' and r['due_at'] < t
    return rows


@router.post('/media-requests/{req_id}/delivered')
async def delivered(req_id: str, user=Depends(staff)):
    r = await deliver(req_id, user)
    if not r: raise HTTPException(404, 'Pedido não encontrado ou já entregue.')
    await audit(user, 'Mídia paga marcada como entregue', 'media_request', {'creator': r['creator_name'], 'fan': r.get('fan_name'), 'valor': r.get('amount_cents')}, None)
    return {'ok': True}


# ---------- lote 115: automação ofereceu (provocação enviada) e falta a mídia paga — balão "Mandar PPV" para a equipe ----------
class PpvIn(Strict):
    creator_id: str = Field(min_length=1, max_length=80)
    fan_ref: str = Field(pattern=r'^[a-f0-9]{64}$')
    fan_name: str = Field(default='', max_length=80)
    item: str = Field(min_length=1, max_length=80)
    cents: int = Field(ge=100, le=10000000)
    caption: str = Field(default='', max_length=200)
    after: str = Field(default='', max_length=200)

def _ext_user():
    from extension_routes import extension_user
    return extension_user

@router.post('/assist/ppv-needed')
async def ppv_needed(body: PpvIn, user=Depends(_ext_user())):
    t = now()
    creator = await db.creators.find_one({'id': body.creator_id}, {'_id': 0, 'name': 1}) or {}
    fan_name, cid, _url = await _fan_info(body.creator_id, body.fan_ref)
    reason = f"Mandar {body.item} {money(body.cents)} como mídia paga" + (f' · legenda: "{body.caption}"' if body.caption else '') + (f' · depois: "{body.after}"' if body.after else '')
    ref = f"mandar_ppv:{t.strftime('%Y%m%d%H')}"
    await db.opportunities.update_one({'creator_id': body.creator_id, 'fan_ref': body.fan_ref, 'ref': ref},
        {'$set': {'status': 'open', 'hot': True, 'reason': reason[:400], 'value_cents': body.cents, 'due_at': (t + timedelta(hours=12)).isoformat()},
         '$setOnInsert': {'id': uid(), 'creator_name': creator.get('name') or '?', 'fan_name': body.fan_name or fan_name, 'cid': cid, 'platform': 'privacy', 'kind': 'mandar_ppv',
                          'created_at': t.isoformat(), 'workspace_id': WORKSPACE, 'expires_at': t + timedelta(days=120)}}, upsert=True)
    return {'ok': True}
