"""Lote 189 (Paulo): e-mail de TODA venda de chat (não só solicitação), com a origem da venda — automação, chatter (nome),
mensagem em massa ou não identificado — e resumo diário às 23h50 com o total por origem.

Como a origem é decidida (olhando o que o Alta Pulse registrou antes da venda):
- automação: a automação criou uma Solicitação com esse valor nas 72 h anteriores, ou a última mensagem nossa ao fã (48 h) saiu pela automação;
- chatter: a última mensagem nossa ao fã saiu por uma pessoa pelo app (registro da Sombra), ou um chatter mandou a Solicitação;
- mensagem em massa: o valor bate com uma mídia paga em massa das 24 h anteriores e não houve conversa individual nossa com o fã depois dela;
- não identificado: nenhum dos três (ex.: venda vista só no extrato, sem conversa registrada pelo app).
"""
import os, html, logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from core import db, now, iso, uid, ORIGIN, settings
from quality_ai import scrub
import mailer

log = logging.getLogger('chat_sales')
SALES_EMAIL = os.environ.get('SALES_EMAIL', os.environ.get('MEDIA_EMAIL', 'contato@altaagencydigital.com')).strip()
BR = ZoneInfo('America/Sao_Paulo')
LABEL = {'automacao': 'Automação', 'chatter': 'Chatter', 'massa': 'Mensagem em massa', 'nao_identificado': 'Não identificado'}


def money(c): return f"R$ {(c or 0) / 100:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')


def _dt(s):
    try: return datetime.fromisoformat(s) if s else None
    except Exception: return None


async def attribute(creator_id, fan_ref, amount_cents, sale_at):
    """Devolve (origem, detalhe). Nunca levanta exceção."""
    t = _dt(sale_at) or now()
    if t.tzinfo is None: t = t.replace(tzinfo=now().tzinfo)
    since72 = (t - timedelta(hours=72)).isoformat(); since48 = (t - timedelta(hours=48)).isoformat(); since24 = (t - timedelta(hours=24)).isoformat()
    until = (t + timedelta(minutes=5)).isoformat()
    amt = int(amount_cents or 0)
    try:
        if fan_ref:
            # 1) solicitação com esse valor criada pela automação
            q = {'creator_id': creator_id, 'fan_ref': fan_ref, 'decision': 'solicitação', 'reason': {'$in': ['criada', 'presente criado']}, 'essay': {'$ne': True},
                 'at': {'$gte': since72, '$lte': until}}
            if amt: q['cents'] = {'$gte': amt - 10, '$lte': amt + 10}
            if await db.auto_log.find_one(q, {'_id': 1}): return 'automacao', 'solicitação criada pela automação'
            # 2) última mensagem nossa ao fã: automação x pessoa (Sombra registra o que o chatter enviou)
            auto_last = await db.auto_log.find_one({'creator_id': creator_id, 'fan_ref': fan_ref, 'decision': 'enviado', 'at': {'$gte': since48, '$lte': until}},
                                                   {'_id': 0, 'at': 1, 'suggested_text': 1}, sort=[('at', -1)])
            human_last = await db.shadow_actions.find_one({'creator_id': creator_id, 'fan_ref': fan_ref, 'sent_at': {'$gte': since48, '$lte': until}, 'sent': {'$nin': [None, '']}},
                                                          {'_id': 0, 'sent_at': 1, 'user_name': 1, 'media_cents': 1, 'product': 1}, sort=[('sent_at', -1)])
            a_at = (auto_last or {}).get('at') or ''; h_at = (human_last or {}).get('sent_at') or ''
            if a_at or h_at:
                if a_at >= h_at: return 'automacao', 'última mensagem ao fã saiu pela automação'
                return 'chatter', (human_last or {}).get('user_name') or 'chatter'
        # 3) mídia paga em massa com esse valor nas 24 h anteriores (sem conversa individual depois, já tratada acima)
        if amt:
            mass = await db.content_items.find_one({'creator_id': creator_id, 'kind': 'mass', 'price_cents': {'$gte': amt - 10, '$lte': amt + 10},
                                                    'at': {'$gte': since24, '$lte': until}, 'status': {'$ne': 'canceled'}}, {'_id': 0, 'at': 1, 'author_name': 1})
            if mass: return 'massa', ('disparada por ' + mass['author_name']) if mass.get('author_name') else 'mídia paga em massa'
    except Exception as e:
        log.warning('origem da venda: %s', e)
    return 'nao_identificado', 'sem conversa registrada pelo app antes da venda'


async def on_chat_sale(creator_id, fan_ref, fan_name, amount_cents, sale_at, source, item='', event_ref=''):
    """Chamado quando o Alta Pulse vê uma venda de chat (lista, extrato ou solicitação paga). Manda um e-mail por venda, sem repetir."""
    try:
        amt = int(amount_cents or 0)
        t = _dt(sale_at) or now()
        if t.tzinfo is None: t = t.replace(tzinfo=now().tzinfo)
        # a mesma venda pode chegar pela lista, pelo extrato e pela solicitação paga: uma só vale
        key = {'creator_id': creator_id, 'amount_cents': amt, '$or': [{'fan_ref': fan_ref}] + ([{'fan_name': fan_name}] if fan_name else []),
               'sale_at': {'$gte': (t - timedelta(hours=3)).isoformat(), '$lte': (t + timedelta(hours=3)).isoformat()}}
        if fan_ref is None and not fan_name: key.pop('$or')
        if await db.chat_sale_mails.find_one(key, {'_id': 1}): return
        creator = await db.creators.find_one({'id': creator_id}, {'_id': 0, 'name': 1}) or {}
        origin, detail = await attribute(creator_id, fan_ref, amt, t.isoformat())
        row = {'id': uid(), 'creator_id': creator_id, 'creator_name': creator.get('name') or '?', 'fan_ref': fan_ref, 'fan_name': scrub(fan_name or '')[:80],
               'amount_cents': amt, 'item': item or '', 'sale_at': t.isoformat(), 'day': t.astimezone(BR).strftime('%Y-%m-%d'), 'source': source,
               'origin': origin, 'detail': detail, 'event_ref': event_ref, 'at': iso(), 'mailed': False, 'expires_at': now() + timedelta(days=120)}
        await db.chat_sale_mails.insert_one(dict(row))
        row['mailed'] = await _email(row)
        await db.chat_sale_mails.update_one({'id': row['id']}, {'$set': {'mailed': row['mailed']}})
    except Exception:
        log.exception('venda de chat')


async def _email(row):
    agency = (await settings()).get('agency_name', 'Alta Pulse')
    e = html.escape
    who = row.get('fan_name') or 'fã'
    lab = LABEL[row['origin']] + (f": {row['detail']}" if row['origin'] == 'chatter' else '')
    when = _dt(row['sale_at']).astimezone(BR).strftime('%d/%m %H:%M')
    intro = (f"<b>{e(row['creator_name'])}</b> vendeu no chat para <b>{e(who)}</b>: <b>{e(money(row['amount_cents']))}</b>"
             + (f" ({e(row['item'])})" if row.get('item') else '') + f" às {e(when)}.<br><br>"
             f"<b>Origem: {e(lab)}</b><br><span style=\"color:#7a7a86\">{e(row['detail'])}</span><br><br>"
             f"Lida pelo Alta Pulse via {e({'list': 'lista da Privacy', 'extrato': 'extrato', 'request': 'solicitação paga'}.get(row['source'], row['source']))}.")
    subject = f"💰 VENDA CHAT · {row['creator_name']} · {who} · {money(row['amount_cents'])} · {LABEL[row['origin']]}" + (f" {row['detail']}" if row['origin'] == 'chatter' else '')
    body = mailer.layout(agency, 'Venda no chat', intro, 'Abrir painel', ORIGIN + '/sombra', 'Aviso automático do Alta Pulse a cada venda de chat.')
    ok = await mailer.send(SALES_EMAIL, subject, body)
    if not ok: log.warning('e-mail de venda de chat não saiu (Resend desligado ou erro)')
    return ok


async def daily_digest(nb=None):
    """Chamado a cada minuto pela varredura: às 23h50 manda o resumo do dia (uma vez)."""
    nb = nb or datetime.now(BR)
    if not (nb.hour == 23 and nb.minute >= 50): return
    day = nb.strftime('%Y-%m-%d')
    if await db.chat_sale_digests.find_one({'day': day}, {'_id': 1}): return
    await db.chat_sale_digests.insert_one({'day': day, 'at': iso()})
    rows = await db.chat_sale_mails.find({'day': day}, {'_id': 0}).to_list(5000)
    agency = (await settings()).get('agency_name', 'Alta Pulse')
    e = html.escape
    tot = {k: [0, 0] for k in LABEL}; by_c = {}; chatters = {}
    for r in rows:
        tot[r['origin']][0] += 1; tot[r['origin']][1] += r['amount_cents']
        c = by_c.setdefault(r['creator_name'], {k: [0, 0] for k in LABEL}); c[r['origin']][0] += 1; c[r['origin']][1] += r['amount_cents']
        if r['origin'] == 'chatter': ch = chatters.setdefault(r['detail'], [0, 0]); ch[0] += 1; ch[1] += r['amount_cents']
    n = len(rows); total = sum(r['amount_cents'] for r in rows)
    lines = [f"<b>{n} venda{'s' if n != 1 else ''} de chat · {e(money(total))}</b><br><br>"]
    lines.append('<b>Por origem</b><br>' + '<br>'.join(f"{e(LABEL[k])}: {v[0]} · {e(money(v[1]))}" for k, v in tot.items()) + '<br><br>')
    if chatters: lines.append('<b>Por chatter</b><br>' + '<br>'.join(f"{e(k)}: {v[0]} · {e(money(v[1]))}" for k, v in sorted(chatters.items(), key=lambda x: -x[1][1])) + '<br><br>')
    if by_c:
        lines.append('<b>Por criadora</b><br>' + '<br>'.join(
            f"{e(cn)}: " + ' · '.join(f"{e(LABEL[k])} {v[0]} ({e(money(v[1]))})" for k, v in c.items() if v[0]) for cn, c in sorted(by_c.items(), key=lambda x: -sum(v[1] for v in x[1].values()))))
    body = mailer.layout(agency, f"Vendas de chat · {nb.strftime('%d/%m')}", ''.join(lines), 'Abrir painel', ORIGIN + '/sombra', 'Resumo automático diário das vendas de chat (23h50).')
    await mailer.send(SALES_EMAIL, f"📊 VENDAS DE CHAT · {nb.strftime('%d/%m')} · {n} vendas · {money(total)}", body)
