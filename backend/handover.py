"""Lote 160 (Paulo): Passagem para humano + Avisos.

PASSAGEM: a IA conversa até o fã cumprir uma regra (gasto total, compra única, pediu personalizado/chamada, VIP, perguntou se é
robô). Aí a IA para para aquele fã/criadora, os chatters ATRIBUÍDOS à criadora recebem o aviso (popup no app, Telegram, e-mail),
quem assumir fica com o fã; ninguém em N min → o gestor é avisado; sem chatter de turno → regra escolhida (a IA segue sem oferta
cara, segue normal ou só espera); depois de N dias (ou no botão) o fã volta para a IA.

AVISOS: cada evento (passagem, pagamento, encontro, pagou e não recebeu, criadora divulgando, Privacy deslogou) liga/desliga,
escolhe quem recebe (chatter atribuído, gestor), por onde (popup no app, Telegram, e-mail) e a urgência. O aviso só vai para quem
tem a criadora atribuída (creator_ids do usuário); de turno primeiro; sem atribuído → gestor.

TELEGRAM: um bot da agência (TELEGRAM_BOT_TOKEN no .env do servidor). Cada pessoa conecta o próprio Telegram com um código em
Minha conta (/start CODIGO no bot). Nada de telefone. Botão "Assumir" no Telegram assume a passagem.
"""
import os, re, asyncio, logging, secrets, html
from datetime import timedelta
from typing import Optional, Literal
from pydantic import Field
from fastapi import APIRouter, Depends, HTTPException
import httpx
from core import db, now, iso, uid, current_user, manager, is_staff, audit, ORIGIN
from schemas import Strict
from extension_routes import extension_user

router = APIRouter()
log = logging.getLogger('handover')
TG_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '').strip()
TG_USER = os.environ.get('TELEGRAM_BOT_USERNAME', '').strip().lstrip('@')

EVENTS = {
    'passagem': {'label': 'Passagem para humano', 'hint': 'fã cumpriu uma regra', 'urgency': 'alta', 'chatter': True, 'manager': False, 'popup': True, 'telegram': True, 'email': False},
    'pagamento': {'label': 'Pagamento recebido', 'hint': 'entregar a mídia', 'urgency': 'alta', 'chatter': True, 'manager': True, 'popup': True, 'telegram': True, 'email': False},  # o e-mail da mídia paga (lote 110) já sai sempre
    'encontro': {'label': 'Fã pediu encontro', 'hint': 'IA travou', 'urgency': 'media', 'chatter': True, 'manager': True, 'popup': True, 'telegram': False, 'email': False},
    'reclamacao': {'label': 'Pagou e não recebeu', 'hint': 'risco de estorno', 'urgency': 'alta', 'chatter': True, 'manager': True, 'popup': True, 'telegram': True, 'email': True},
    'divulgacao': {'label': 'Criadora divulgando', 'hint': 'contato bloqueado', 'urgency': 'baixa', 'chatter': False, 'manager': True, 'popup': False, 'telegram': False, 'email': False},
    'login': {'label': 'Privacy deslogou', 'hint': 'pediu verificação', 'urgency': 'media', 'chatter': False, 'manager': True, 'popup': True, 'telegram': True, 'email': False},
}
RULES = {
    'total': {'label': 'Fã já gastou no total', 'value': True, 'default_on': True, 'default': 30000},
    'single': {'label': 'Uma compra única acima de', 'value': True, 'default_on': True, 'default': 15000},
    'custom': {'label': 'Pediu personalizado ou chamada', 'value': False, 'default_on': True},
    'vip': {'label': 'Fã marcado como VIP pela equipe', 'value': False, 'default_on': False},
    'bot': {'label': 'Perguntou se é robô / se é ela mesma', 'value': False, 'default_on': True},
}
NO_SHIFT = {'sem_caro': 'IA segue, sem oferta cara', 'normal': 'IA segue normal', 'esperar': 'Só avisa e espera'}

def default_handover():
    return {'enabled': False, 'rules': {k: {'on': r['default_on'], **({'cents': r['default']} if r['value'] else {})} for k, r in RULES.items()},
            'timeout_min': 10, 'no_shift': 'sem_caro', 'return_days': 7}
def default_notify():
    return {'events': {k: {'on': True, **{f: v for f, v in e.items() if f in ('urgency', 'chatter', 'manager', 'popup', 'telegram', 'email')}} for k, e in EVENTS.items()},
            'shift_first': True, 'group_min': 5, 'quiet': {'on': False, 'start': '03:00', 'end': '08:00'}, 'popup_sticky': True}

async def get_handover_cfg(creator_id=None):
    base = (await db.handover_config.find_one({'id': 'global'}, {'_id': 0}) or {}).get('cfg') or default_handover()
    if creator_id:
        own = await db.handover_config.find_one({'id': f'creator:{creator_id}'}, {'_id': 0})
        if own and own.get('cfg'):
            c = dict(base); c.update({k: v for k, v in own['cfg'].items() if v is not None}); c['own'] = True
            return c
    return base
async def get_notify_cfg():
    d = default_notify(); saved = (await db.notify_config.find_one({'id': 'global'}, {'_id': 0}) or {}).get('cfg') or {}
    for k, v in (saved.get('events') or {}).items():
        if k in d['events']: d['events'][k].update(v)
    for k in ('shift_first', 'group_min', 'quiet', 'popup_sticky'):
        if k in saved: d[k] = saved[k]
    return d

# ---------- destinatários ----------
async def recipients(creator_id, ev_cfg, nc):
    """Chatters ATRIBUÍDOS à criadora (de turno primeiro, se ligado) e/ou gestores. Sem atribuído → gestores."""
    out = {}
    if ev_cfg.get('chatter'):
        assigned = await db.users.find({'active': True, 'creator_ids': creator_id}, {'_id': 0, 'id': 1, 'name': 1, 'email': 1, 'role': 1}).to_list(200)
        if nc.get('shift_first') and assigned:
            on_shift = await db.shifts.find({'creator_id': creator_id, 'active': True}, {'_id': 0, 'operator_id': 1}).to_list(10)
            ids = {s['operator_id'] for s in on_shift}
            if ids & {u['id'] for u in assigned}: assigned = [u for u in assigned if u['id'] in ids]
        for u in assigned: out[u['id']] = u
        if not assigned: ev_cfg = {**ev_cfg, 'manager': True}
    if ev_cfg.get('manager'):
        for u in await db.users.find({'active': True, 'role': 'manager'}, {'_id': 0, 'id': 1, 'name': 1, 'email': 1, 'role': 1}).to_list(50): out[u['id']] = u
    return list(out.values())

def _quiet(nc):
    q = nc.get('quiet') or {}
    if not q.get('on'): return False
    from datetime import timezone
    h = now().astimezone(timezone(timedelta(hours=-3))).strftime('%H:%M')
    s, e = q.get('start', '03:00'), q.get('end', '08:00')
    return (s <= h < e) if s < e else (h >= s or h < e)

# ---------- envio ----------
async def tg_send(chat_id, text, buttons=None):
    if not TG_TOKEN or not chat_id: return False
    body = {'chat_id': chat_id, 'text': text[:3900], 'parse_mode': 'HTML', 'disable_web_page_preview': True}
    if buttons: body['reply_markup'] = {'inline_keyboard': [buttons]}
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(f'https://api.telegram.org/bot{TG_TOKEN}/sendMessage', json=body)
        return r.status_code < 300
    except Exception as e:
        log.warning('telegram: %s', e); return False

async def notify(event, creator_id, title, body, fan_ref=None, fan_name=None, data=None):
    """Cria o aviso para cada destinatário (popup no app), manda Telegram/e-mail conforme a configuração. Junta repetidos."""
    try:
        nc = await get_notify_cfg(); ev = nc['events'].get(event)
        if not ev or not ev.get('on'): return []
        since = (now() - timedelta(minutes=int(nc.get('group_min') or 5))).isoformat()
        if fan_ref and await db.notifications.find_one({'event': event, 'creator_id': creator_id, 'fan_ref': fan_ref, 'created_at': {'$gte': since}}, {'_id': 1}): return []
        creator = await db.creators.find_one({'id': creator_id}, {'_id': 0, 'name': 1}) or {}
        cname = creator.get('name') or 'Criadora'
        users = await recipients(creator_id, ev, nc)
        quiet = _quiet(nc); sent = []
        for u in users:
            row = {'id': uid(), 'user_id': u['id'], 'event': event, 'urgency': ev.get('urgency', 'media'), 'creator_id': creator_id, 'creator_name': cname,
                   'fan_ref': fan_ref, 'fan_name': fan_name, 'title': title, 'body': body, 'data': data or {},
                   'popup': bool(ev.get('popup')), 'sticky': bool(nc.get('popup_sticky')) and ev.get('urgency') == 'alta',
                   'created_at': iso(), 'seen_at': None, 'acted_at': None, 'snooze_until': None, 'expires_at': now() + timedelta(days=60)}
            await db.notifications.insert_one(dict(row)); sent.append(row['id'])
            if ev.get('telegram') and not quiet:
                link = await db.telegram_links.find_one({'user_id': u['id']}, {'_id': 0, 'chat_id': 1})
                if link:
                    t = f"<b>{html.escape(title)}</b>\n{html.escape(cname)}" + (f" · fã <b>{html.escape(fan_name)}</b>" if fan_name else '') + f"\n{html.escape(body)}"
                    btns = [{'text': 'Abrir painel', 'url': ORIGIN}]
                    if event == 'passagem' and (data or {}).get('handover_id'): btns.append({'text': 'Assumir', 'callback_data': f"take:{data['handover_id']}"})
                    await tg_send(link['chat_id'], t, btns)
            if ev.get('email') and u.get('email'):
                try:
                    import mailer
                    body_html = mailer.layout('Alta Pulse', title, html.escape(f"{cname}: {body}"), 'Abrir painel', ORIGIN, 'Aviso automático do Alta Pulse.')
                    await mailer.send(u['email'], f"{title} · {cname}", body_html)
                except Exception: log.exception('email aviso')
        return sent
    except Exception:
        log.exception('notify'); return []

# ---------- passagem ----------
BOT_Q = re.compile(r'\b(voc[eê]|vc|tu) [eé] (um )?(rob[oô]|bot|ia|intelig[eê]ncia artificial|m[aá]quina|real)\b|\b[eé] (voc[eê]|vc) mesma\b|\b[eé] a pr[oó]pria\b|\bquem (t[aá]|est[aá]) respondendo\b|\b(fala|falo) com (ela|a .+) mesma\b|\b[eé] (a )?ag[eê]ncia\b|\bchatter\b', re.I)
CUSTOM_Q = re.compile(r'\b(personalizad\w*|sob medida|exclusiv\w* pra mim|falando meu nome|chamada|videochamada|v[ií]deo chamada|ao vivo)\b', re.I)

async def open_handover(creator_id, fan_ref):
    return await db.handovers.find_one({'creator_id': creator_id, 'fan_ref': fan_ref, 'status': {'$in': ['aberta', 'assumida', 'escalada']}}, {'_id': 0})

async def _spent(creator_id, fan_ref):
    rows = await db.events.find({'creator_id': creator_id, 'fan_ref': fan_ref, 'kind': 'sale', 'sale_status': {'$nin': ['refunded', 'cancelled']}}, {'_id': 0, 'amount_cents': 1}).to_list(5000)
    total = sum(int(r.get('amount_cents') or 0) for r in rows); single = max([int(r.get('amount_cents') or 0) for r in rows] or [0])
    return total, single

async def gate(creator_id, fan_ref, fan_name, messages, create=True):
    """Chamada pela automação antes de decidir. Devolve {'block': motivo} (IA não responde), {'max_cents': N} (IA segue sem oferta cara) ou {}.
    create=False (ensaio): só respeita passagem já aberta, não abre nova."""
    if not fan_ref: return {}
    hv = await open_handover(creator_id, fan_ref)
    if hv:
        if hv['status'] == 'assumida' or hv.get('mode') == 'esperar': return {'block': 'passagem para humano' + (f" ({hv.get('taken_name')})" if hv.get('taken_name') else '')}
        if hv.get('mode') == 'sem_caro': return {'max_cents': hv.get('max_cents') or 15000}
        if hv.get('mode') == 'normal': return {}
        return {'block': 'passagem para humano (aguardando chatter)'}
    if not create: return {}
    cfg = await get_handover_cfg(creator_id)
    if not cfg.get('enabled'): return {}
    rules = cfg.get('rules') or {}
    fan_now = ' '.join((m.get('text') if isinstance(m, dict) else getattr(m, 'text', '')) or '' for m in (messages or [])[-3:] if not (m.get('ours') if isinstance(m, dict) else getattr(m, 'ours', False)))
    hit = None; detail = ''
    total, single = await _spent(creator_id, fan_ref)
    if (rules.get('total') or {}).get('on') and total >= int(rules['total'].get('cents') or 0) > 0: hit, detail = 'total', f'já gastou R$ {total / 100:.2f}'.replace('.', ',')
    elif (rules.get('single') or {}).get('on') and single >= int(rules['single'].get('cents') or 0) > 0: hit, detail = 'single', f'compra única de R$ {single / 100:.2f}'.replace('.', ',')
    elif (rules.get('custom') or {}).get('on') and CUSTOM_Q.search(fan_now): hit, detail = 'custom', 'pediu personalizado ou chamada'
    elif (rules.get('vip') or {}).get('on') and await db.fan_state.find_one({'creator_id': creator_id, 'fan_ref': fan_ref, 'vip': True}, {'_id': 1}): hit, detail = 'vip', 'fã VIP'
    elif (rules.get('bot') or {}).get('on') and BOT_Q.search(fan_now): hit, detail = 'bot', 'perguntou se é robô / se é ela mesma'
    if not hit: return {}
    on_shift = await db.shifts.find_one({'creator_id': creator_id, 'active': True}, {'_id': 1})
    mode = None if on_shift else cfg.get('no_shift', 'sem_caro')
    max_cents = int(((rules.get('single') or {}).get('cents')) or 15000)
    hv = {'id': uid(), 'creator_id': creator_id, 'fan_ref': fan_ref, 'fan_name': fan_name, 'rule': hit, 'detail': detail, 'total_cents': total,
          'last_fan': fan_now[-200:], 'status': 'aberta', 'mode': mode, 'max_cents': max_cents, 'created_at': iso(),
          'deadline_at': (now() + timedelta(minutes=int(cfg.get('timeout_min') or 10))).isoformat(),
          'return_at': (now() + timedelta(days=int(cfg.get('return_days') or 7))).isoformat(), 'taken_by': None, 'taken_name': None, 'taken_at': None,
          'returned_at': None, 'expires_at': now() + timedelta(days=180)}
    await db.handovers.insert_one(dict(hv))
    await notify('passagem', creator_id, 'Passagem para você', f"{detail}. Última: \"{fan_now[-120:]}\"", fan_ref, fan_name,
                 {'handover_id': hv['id'], 'rule': hit, 'total_cents': total, 'deadline_at': hv['deadline_at']})
    if mode == 'normal': return {}
    if mode == 'sem_caro': return {'max_cents': max_cents}
    return {'block': 'passagem para humano (aguardando chatter)'}

async def take(hv_id, user):
    hv = await db.handovers.find_one({'id': hv_id}, {'_id': 0})
    if not hv: raise HTTPException(404, 'Passagem não encontrada.')
    if not is_staff(user) and hv['creator_id'] not in (user.get('creator_ids') or []): raise HTTPException(403, 'Esta criadora não está atribuída a você.')
    if hv['status'] == 'assumida': raise HTTPException(409, f"Já assumida por {hv.get('taken_name') or 'outra pessoa'}.")
    if hv['status'] not in ('aberta', 'escalada'): raise HTTPException(409, 'Esta passagem já foi encerrada.')
    r = await db.handovers.update_one({'id': hv_id, 'status': {'$in': ['aberta', 'escalada']}},
        {'$set': {'status': 'assumida', 'taken_by': user['id'], 'taken_name': user['name'], 'taken_at': iso(), 'mode': None}})
    if not r.modified_count: raise HTTPException(409, 'Outra pessoa assumiu agora.')
    await db.notifications.update_many({'event': 'passagem', 'data.handover_id': hv_id, 'acted_at': None}, {'$set': {'acted_at': iso(), 'acted_by': user['name']}})
    return await db.handovers.find_one({'id': hv_id}, {'_id': 0, 'expires_at': 0})

async def give_back(hv_id, user, reason='botao'):
    r = await db.handovers.update_one({'id': hv_id, 'status': {'$in': ['aberta', 'assumida', 'escalada']}},
        {'$set': {'status': 'devolvida', 'returned_at': iso(), 'returned_by': (user or {}).get('name') or 'Sistema', 'return_reason': reason}})
    return bool(r.modified_count)

async def tick():
    """A cada minuto: passagem sem ninguém assumir no prazo → avisa o gestor; passada a validade → volta para a IA."""
    t = iso()
    async for hv in db.handovers.find({'status': 'aberta', 'deadline_at': {'$lt': t}}, {'_id': 0}):
        await db.handovers.update_one({'id': hv['id'], 'status': 'aberta'}, {'$set': {'status': 'escalada', 'escalated_at': t}})
        nc = await get_notify_cfg()
        for u in await db.users.find({'active': True, 'role': 'manager'}, {'_id': 0, 'id': 1}).to_list(50):
            await db.notifications.insert_one({'id': uid(), 'user_id': u['id'], 'event': 'passagem', 'urgency': 'alta', 'creator_id': hv['creator_id'],
                'creator_name': (await db.creators.find_one({'id': hv['creator_id']}, {'_id': 0, 'name': 1}) or {}).get('name'), 'fan_ref': hv['fan_ref'], 'fan_name': hv.get('fan_name'),
                'title': 'Ninguém assumiu a passagem', 'body': hv.get('detail') or '', 'data': {'handover_id': hv['id']}, 'popup': True, 'sticky': bool(nc.get('popup_sticky')),
                'created_at': t, 'seen_at': None, 'acted_at': None, 'snooze_until': None, 'expires_at': now() + timedelta(days=60)})
    async for hv in db.handovers.find({'status': {'$in': ['aberta', 'assumida', 'escalada']}, 'return_at': {'$lt': t}}, {'_id': 0, 'id': 1}):
        await give_back(hv['id'], None, 'prazo')

# ---------- rotas: configuração (gestor) ----------
class HandoverCfgIn(Strict):
    creator_id: Optional[str] = None
    cfg: Optional[dict] = None  # None com creator_id = volta a usar a regra geral
@router.get('/handover/config')
async def read_cfg(user=Depends(manager)):
    base = await get_handover_cfg()
    own = {r['id'][8:]: r['cfg'] for r in await db.handover_config.find({'id': {'$regex': '^creator:'}}, {'_id': 0}).to_list(500) if r.get('cfg')}
    creators = await db.creators.find({'deleted_at': None}, {'_id': 0, 'id': 1, 'name': 1}).sort('name', 1).to_list(500)
    users = await db.users.find({'active': True}, {'_id': 0, 'id': 1, 'name': 1, 'creator_ids': 1, 'role': 1}).to_list(500)
    since = (now() - timedelta(days=7)).isoformat()
    counts = {}
    async for h in db.handovers.find({'created_at': {'$gte': since}}, {'_id': 0, 'creator_id': 1}): counts[h['creator_id']] = counts.get(h['creator_id'], 0) + 1
    rows = [{'creator_id': c['id'], 'name': c['name'], 'own': own.get(c['id']), 'chatters': [u['name'] for u in users if c['id'] in (u.get('creator_ids') or [])], 'week': counts.get(c['id'], 0)} for c in creators]
    return {'cfg': base, 'rules': RULES, 'no_shift': NO_SHIFT, 'creators': rows}
@router.post('/handover/config')
async def save_cfg(body: HandoverCfgIn, user=Depends(manager)):
    def clean(c):
        if c is None: return None
        out = {}
        if 'enabled' in c: out['enabled'] = bool(c['enabled'])
        if 'rules' in c:
            rr = {}
            for k, r in (c['rules'] or {}).items():
                if k not in RULES: continue
                x = {'on': bool((r or {}).get('on'))}
                if RULES[k]['value']:
                    cents = int((r or {}).get('cents') or 0)
                    if cents < 0 or cents > 10_000_000: raise HTTPException(422, 'Valor fora do limite.')
                    x['cents'] = cents
                rr[k] = x
            out['rules'] = rr
        if 'timeout_min' in c: out['timeout_min'] = max(1, min(240, int(c['timeout_min'])))
        if 'no_shift' in c:
            if c['no_shift'] not in NO_SHIFT: raise HTTPException(422, 'Opção inválida.')
            out['no_shift'] = c['no_shift']
        if 'return_days' in c: out['return_days'] = max(1, min(90, int(c['return_days'])))
        return out
    key = f'creator:{body.creator_id}' if body.creator_id else 'global'
    cfg = clean(body.cfg)
    if body.creator_id is None: cfg = {**default_handover(), **(await get_handover_cfg()), **(cfg or {})}
    await db.handover_config.update_one({'id': key}, {'$set': {'id': key, 'cfg': cfg, 'updated_at': iso(), 'by': user['name']}}, upsert=True)
    await audit(user, 'Passagem para humano: regras salvas', body.creator_id or 'geral')
    return {'ok': True}

class NotifyCfgIn(Strict):
    cfg: dict
@router.get('/notify/config')
async def read_notify(user=Depends(manager)):
    users = await db.users.find({'active': True}, {'_id': 0, 'id': 1, 'name': 1, 'creator_ids': 1, 'role': 1}).to_list(500)
    creators = {c['id']: c['name'] for c in await db.creators.find({'deleted_at': None}, {'_id': 0, 'id': 1, 'name': 1}).to_list(500)}
    links = {l['user_id'] for l in await db.telegram_links.find({}, {'_id': 0, 'user_id': 1}).to_list(500)}
    people = [{'id': u['id'], 'name': u['name'], 'role': u['role'], 'creators': [creators[c] for c in (u.get('creator_ids') or []) if c in creators], 'telegram': u['id'] in links} for u in users]
    return {'cfg': await get_notify_cfg(), 'events': EVENTS, 'people': people, 'telegram_ready': bool(TG_TOKEN)}
@router.post('/notify/config')
async def save_notify(body: NotifyCfgIn, user=Depends(manager)):
    c = body.cfg or {}; d = default_notify(); out = {'events': {}}
    for k, v in (c.get('events') or {}).items():
        if k not in EVENTS: continue
        out['events'][k] = {f: (v.get(f) if f == 'urgency' else bool(v.get(f))) for f in ('on', 'chatter', 'manager', 'popup', 'telegram', 'email', 'urgency') if f in v}
        if out['events'][k].get('urgency') not in (None, 'alta', 'media', 'baixa'): raise HTTPException(422, 'Urgência inválida.')
    out['shift_first'] = bool(c.get('shift_first', d['shift_first'])); out['popup_sticky'] = bool(c.get('popup_sticky', d['popup_sticky']))
    out['group_min'] = max(0, min(60, int(c.get('group_min', d['group_min']))))
    q = c.get('quiet') or d['quiet']
    if not re.match(r'^\d{2}:\d{2}$', str(q.get('start', ''))) or not re.match(r'^\d{2}:\d{2}$', str(q.get('end', ''))): raise HTTPException(422, 'Horário inválido.')
    out['quiet'] = {'on': bool(q.get('on')), 'start': q['start'], 'end': q['end']}
    await db.notify_config.update_one({'id': 'global'}, {'$set': {'id': 'global', 'cfg': out, 'updated_at': iso(), 'by': user['name']}}, upsert=True)
    await audit(user, 'Avisos: configuração salva', 'avisos')
    return {'ok': True}

# ---------- rotas: passagens (painel e app) ----------
async def _list_for(user, status):
    q = {} if status == 'todas' else {'status': {'$in': ['aberta', 'escalada', 'assumida']}} if status == 'abertas' else {'status': status}
    if not is_staff(user): q['creator_id'] = {'$in': user.get('creator_ids') or []}
    rows = await db.handovers.find(q, {'_id': 0, 'expires_at': 0}).sort('created_at', -1).to_list(300)
    names = {c['id']: c['name'] for c in await db.creators.find({}, {'_id': 0, 'id': 1, 'name': 1}).to_list(500)}
    for r in rows: r['creator_name'] = names.get(r['creator_id'])
    return rows
@router.get('/handover/list')
async def list_panel(status: str = 'abertas', user=Depends(current_user)): return await _list_for(user, status)
@router.get('/extension/handover/list')
async def list_app(status: str = 'abertas', user=Depends(extension_user)): return await _list_for(user, status)
@router.post('/handover/{hv_id}/take')
async def take_panel(hv_id: str, user=Depends(current_user)): return await take(hv_id, user)
@router.post('/extension/handover/{hv_id}/take')
async def take_app(hv_id: str, user=Depends(extension_user)): return await take(hv_id, user)
@router.post('/handover/{hv_id}/return')
async def return_panel(hv_id: str, user=Depends(current_user)): return await _return(hv_id, user)
@router.post('/extension/handover/{hv_id}/return')
async def return_app(hv_id: str, user=Depends(extension_user)): return await _return(hv_id, user)
async def _return(hv_id, user):
    hv = await db.handovers.find_one({'id': hv_id}, {'_id': 0, 'creator_id': 1})
    if not hv or (not is_staff(user) and hv['creator_id'] not in (user.get('creator_ids') or [])): raise HTTPException(404, 'Passagem não encontrada.')
    return {'ok': await give_back(hv_id, user)}

class VipIn(Strict):
    creator_id: str
    fan_ref: str = Field(pattern=r'^[a-f0-9]{64}$')
    vip: bool = True
@router.post('/extension/fan/vip')
async def set_vip(body: VipIn, user=Depends(extension_user)):
    if not is_staff(user) and body.creator_id not in (user.get('creator_ids') or []): raise HTTPException(403, 'Criadora não atribuída.')
    await db.fan_state.update_one({'creator_id': body.creator_id, 'fan_ref': body.fan_ref}, {'$set': {'vip': body.vip}}, upsert=True)
    return {'ok': True}

# ---------- rotas: avisos do usuário (popup no app) ----------
async def _pending(user):
    t = iso()
    rows = await db.notifications.find({'user_id': user['id'], 'acted_at': None, '$or': [{'snooze_until': None}, {'snooze_until': {'$lt': t}}],
                                        'created_at': {'$gte': (now() - timedelta(hours=24)).isoformat()}}, {'_id': 0, 'expires_at': 0}).sort('created_at', -1).to_list(30)
    for r in rows:  # passagem já assumida por outra pessoa: some para os outros
        hid = (r.get('data') or {}).get('handover_id')
        if r['event'] == 'passagem' and hid:
            hv = await db.handovers.find_one({'id': hid}, {'_id': 0, 'status': 1, 'taken_name': 1})
            if hv and hv['status'] not in ('aberta', 'escalada'):
                await db.notifications.update_one({'id': r['id']}, {'$set': {'acted_at': iso(), 'acted_by': hv.get('taken_name') or 'encerrada'}}); r['_gone'] = True
    return [r for r in rows if not r.get('_gone')]
@router.get('/extension/notifications/pending')
async def pending_app(user=Depends(extension_user)): return await _pending(user)
@router.get('/notifications/pending')
async def pending_panel(user=Depends(current_user)): return await _pending(user)
class AckIn(Strict):
    action: Literal['seen', 'snooze', 'done'] = 'seen'
    minutes: int = Field(default=2, ge=1, le=60)
async def _ack(nid, body, user):
    n = await db.notifications.find_one({'id': nid, 'user_id': user['id']}, {'_id': 0})
    if not n: raise HTTPException(404, 'Aviso não encontrado.')
    upd = {'seen_at': n.get('seen_at') or iso()}
    if body.action == 'snooze': upd['snooze_until'] = (now() + timedelta(minutes=body.minutes)).isoformat()
    if body.action == 'done': upd['acted_at'] = iso(); upd['acted_by'] = user['name']
    await db.notifications.update_one({'id': nid}, {'$set': upd})
    return {'ok': True}
@router.post('/extension/notifications/{nid}/ack')
async def ack_app(nid: str, body: AckIn, user=Depends(extension_user)): return await _ack(nid, body, user)
@router.post('/notifications/{nid}/ack')
async def ack_panel(nid: str, body: AckIn, user=Depends(current_user)): return await _ack(nid, body, user)

# ---------- Telegram: conectar e receber botões ----------
@router.post('/me/telegram/code')
async def tg_code(user=Depends(current_user)):
    if not TG_TOKEN: raise HTTPException(409, 'O bot do Telegram ainda não foi configurado no servidor.')
    code = secrets.token_hex(4).upper()
    await db.telegram_codes.update_one({'user_id': user['id']}, {'$set': {'user_id': user['id'], 'code': code, 'expires_at': now() + timedelta(minutes=15)}}, upsert=True)
    return {'code': code, 'bot': TG_USER, 'link': f'https://t.me/{TG_USER}?start={code}' if TG_USER else None}
@router.get('/me/telegram')
async def tg_status(user=Depends(current_user)):
    return {'connected': bool(await db.telegram_links.find_one({'user_id': user['id']}, {'_id': 1})), 'ready': bool(TG_TOKEN), 'bot': TG_USER}
@router.post('/me/telegram/disconnect')
async def tg_off(user=Depends(current_user)):
    await db.telegram_links.delete_many({'user_id': user['id']}); return {'ok': True}

async def _tg_update(u):
    msg = u.get('message') or {}
    text = (msg.get('text') or '').strip(); chat = (msg.get('chat') or {}).get('id')
    if text.startswith('/start') and chat:
        code = text[6:].strip().upper()
        row = await db.telegram_codes.find_one({'code': code, 'expires_at': {'$gt': now()}}, {'_id': 0}) if code else None
        if not row: await tg_send(chat, 'Código inválido ou vencido. Gere outro em Minha conta → Telegram, no painel.'); return
        await db.telegram_links.delete_many({'$or': [{'user_id': row['user_id']}, {'chat_id': chat}]})
        await db.telegram_links.insert_one({'user_id': row['user_id'], 'chat_id': chat, 'linked_at': iso()})
        await db.telegram_codes.delete_many({'user_id': row['user_id']})
        user = await db.users.find_one({'id': row['user_id']}, {'_id': 0, 'name': 1}) or {}
        await tg_send(chat, f"Pronto, {html.escape((user.get('name') or '').split(' ')[0])}! Você vai receber aqui os avisos das criadoras atribuídas a você."); return
    cb = u.get('callback_query') or {}
    if cb.get('data', '').startswith('take:'):
        chat = ((cb.get('message') or {}).get('chat') or {}).get('id')
        link = await db.telegram_links.find_one({'chat_id': chat}, {'_id': 0})
        user = await db.users.find_one({'id': link['user_id'], 'active': True}, {'_id': 0}) if link else None
        answer = 'Telegram não conectado a um usuário ativo.'
        if user:
            try: await take(cb['data'][5:], user); answer = 'Assumida! Abra a conversa no app.'
            except HTTPException as e: answer = e.detail
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                await c.post(f'https://api.telegram.org/bot{TG_TOKEN}/answerCallbackQuery', json={'callback_query_id': cb.get('id'), 'text': answer[:180]})
        except Exception: pass

async def telegram_loop():
    """Escuta o bot (long polling): conecta contas pelo /start CODIGO e trata o botão Assumir."""
    if not TG_TOKEN: return
    offset = (await db.kv.find_one({'id': 'tg_offset'}, {'_id': 0}) or {}).get('v', 0)
    while True:
        try:
            async with httpx.AsyncClient(timeout=40) as c:
                r = await c.get(f'https://api.telegram.org/bot{TG_TOKEN}/getUpdates', params={'timeout': 30, 'offset': offset})
            for u in (r.json() or {}).get('result', []):
                offset = u['update_id'] + 1
                try: await _tg_update(u)
                except Exception: log.exception('telegram update')
            await db.kv.update_one({'id': 'tg_offset'}, {'$set': {'v': offset}}, upsert=True)
        except asyncio.CancelledError: raise
        except Exception:
            log.warning('telegram: sem conexão, tento de novo'); await asyncio.sleep(15)

# ---------- relatório ----------
@router.get('/handover/report')
async def report(days: int = 7, creator_id: str = '', user=Depends(manager)):
    since = (now() - timedelta(days=max(1, min(90, days)))).isoformat()
    q = {'created_at': {'$gte': since}}
    if creator_id: q['creator_id'] = creator_id
    hvs = await db.handovers.find(q, {'_id': 0, 'expires_at': 0}).sort('created_at', -1).to_list(2000)
    names = {c['id']: c['name'] for c in await db.creators.find({}, {'_id': 0, 'id': 1, 'name': 1}).to_list(500)}
    from datetime import datetime
    def mins(h):
        if not h.get('taken_at'): return None
        return round((datetime.fromisoformat(h['taken_at']) - datetime.fromisoformat(h['created_at'])).total_seconds() / 60, 1)
    async def sold_after(h):
        t0 = h.get('taken_at') or h['created_at']; t1 = (datetime.fromisoformat(t0) + timedelta(hours=48)).isoformat()
        rows = await db.events.find({'creator_id': h['creator_id'], 'fan_ref': h['fan_ref'], 'kind': 'sale', 'confirmed_at': {'$gte': t0, '$lte': t1}}, {'_id': 0, 'amount_cents': 1}).to_list(200)
        return sum(int(r.get('amount_cents') or 0) for r in rows)
    out_rows, per = [], {}
    for h in hvs:
        s = await sold_after(h); m = mins(h)
        out_rows.append({**h, 'creator_name': names.get(h['creator_id']), 'minutes': m, 'sold_cents': s})
        if h.get('taken_by'):
            p = per.setdefault(h['taken_by'], {'name': h.get('taken_name'), 'taken': 0, 'mins': [], 'sold_cents': 0})
            p['taken'] += 1; p['sold_cents'] += s
            if m is not None: p['mins'].append(m)
    notes = await db.notifications.find({'created_at': {'$gte': since}, 'event': 'passagem'}, {'_id': 0, 'user_id': 1, 'seen_at': 1}).to_list(20000)
    recv = {}
    for n in notes:
        r = recv.setdefault(n['user_id'], [0, 0]); r[0] += 1; r[1] += 1 if n.get('seen_at') else 0
    users = {u['id']: u for u in await db.users.find({}, {'_id': 0, 'id': 1, 'name': 1, 'creator_ids': 1}).to_list(500)}
    people = []
    for uid_, (got, seen) in recv.items():
        p = per.get(uid_, {'taken': 0, 'mins': [], 'sold_cents': 0}); u = users.get(uid_, {})
        ms = sorted(p['mins']); med = ms[len(ms) // 2] if ms else None
        people.append({'name': u.get('name'), 'creators': [names.get(c) for c in (u.get('creator_ids') or []) if names.get(c)], 'received': got, 'taken': p['taken'],
                       'median_min': med, 'sold_cents': p['sold_cents'], 'seen_pct': round(100 * seen / got) if got else None})
    allm = sorted([r['minutes'] for r in out_rows if r['minutes'] is not None])
    return {'kpis': {'total': len(hvs), 'median_min': allm[len(allm) // 2] if allm else None, 'sold_cents': sum(r['sold_cents'] for r in out_rows),
                     'no_one': sum(1 for h in hvs if h.get('escalated_at') and not h.get('taken_by'))},
            'people': sorted(people, key=lambda x: -(x['received'] or 0)), 'rows': out_rows[:100]}
