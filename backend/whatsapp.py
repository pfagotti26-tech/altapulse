"""Lote 161 (Paulo): WhatsApp de vendas da criadora (canal separado da Privacy, número divulgado no Instagram/TikTok).

- Um número digital por criadora, pela API oficial da Meta (WhatsApp Cloud API). Nada de WhatsApp Web automatizado.
- Vende só o que estiver ligado na criadora: chamada ao vivo, vídeo personalizado, fotos, vídeos. NADA de conteúdo adulto.
- A IA fala como a criadora, mas: confirma 18+ antes de tudo (sinal de menor bloqueia); pedido sexual, encontro, contato
  pessoal, pagamento por fora ou "é você mesma? é robô?" → a IA para e chama o chatter atribuído (ela nunca mente sobre isso).
- Chamada ao vivo é sempre com a criadora de verdade, no horário da agenda, depois do pagamento.
- Gestão só do admin e dos chatters com a criadora atribuída (painel e app desktop). A criadora não entra no Alta Pulse.
- Pagamento: provedor plugável (payments.py). Hoje "manual": a IA manda as instruções de Pix e o chatter marca pago.

Variáveis do servidor (.env): WA_TOKEN (token de usuário do sistema da Meta), WA_APP_SECRET (assinatura do webhook),
WA_VERIFY_TOKEN (texto que você escolhe para validar o webhook), WA_API_VERSION (opcional, padrão v21.0).
"""
import os, re, json, hmac, hashlib, logging, secrets, asyncio, random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Optional, Literal
import httpx
from pydantic import Field
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import PlainTextResponse
from core import db, now, iso, uid, current_user, manager, is_staff, audit
from schemas import Strict
from extension_routes import extension_user

router = APIRouter()
log = logging.getLogger('whatsapp')
BR = ZoneInfo('America/Sao_Paulo')
GRAPH = f"https://graph.facebook.com/{os.environ.get('WA_API_VERSION', 'v21.0')}"
KINDS = {'call': 'Chamada ao vivo', 'custom': 'Vídeo personalizado', 'photos': 'Fotos', 'videos': 'Vídeos'}
STAGES = ['novo', 'idade', 'conversando', 'escolhendo', 'pedido', 'aguardando_pix', 'cliente', 'bloqueado']
_locks = {}
_tasks = set()

def wa_token(): return os.environ.get('WA_TOKEN', '').strip()

def default_cfg(creator_id):
    return {'creator_id': creator_id, 'enabled': False, 'phone_number_id': '', 'display_phone': '',
            'sells': {'call': True, 'custom': False, 'photos': False, 'videos': False}, 'items': [],
            'agenda': {'week': {'0': [['19:00', '22:00']], '1': [['19:00', '22:00']], '2': [['19:00', '22:00']], '3': [['19:00', '22:00']],
                                '4': [['20:00', '23:00']], '5': [['15:00', '18:00']], '6': []},
                       'gap_min': 10, 'lead_h': 2, 'max_day': 4, 'blocked': []},
            'pay': {'provider': 'manual', 'hold_min': 15, 'creator_pct': 60, 'pix_text': '', 'descriptor': 'CREATORALTA'},
            'room_link': '', 'welcome': 'oi, amor! que bom que você veio. antes de tudo: você tem mais de 18 anos?',
            'reminders': True, 'after_call': True, 'templates': {'reminder': '', 'lang': 'pt_BR'}, 'max_ai_day': 400}

async def get_cfg(creator_id):
    row = await db.wa_config.find_one({'creator_id': creator_id}, {'_id': 0}) or {}
    d = default_cfg(creator_id)
    for k, v in row.items():
        if isinstance(v, dict) and isinstance(d.get(k), dict): d[k] = {**d[k], **v}
        else: d[k] = v
    return d

# ---------- acesso: gestor ou chatter com a criadora atribuída; painel (cookie) ou app (Bearer) ----------
async def wa_user(request: Request):
    if request.headers.get('authorization', '').startswith('Bearer '): return await extension_user(request)
    return await current_user(request)
def can(user, creator_id): return is_staff(user) or creator_id in (user.get('creator_ids') or [])
def check(user, creator_id):
    if not can(user, creator_id): raise HTTPException(403, 'Esta criadora não está atribuída a você.')

# ---------- envio pela Cloud API ----------
async def _post(cfg, payload):
    if str(payload.get('to') or '').startswith('sim'): return 'sim.' + uid()  # lote 165: simulador do painel, nada sai para o WhatsApp
    if not wa_token() or not cfg.get('phone_number_id'): return None
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(f"{GRAPH}/{cfg['phone_number_id']}/messages", headers={'Authorization': f'Bearer {wa_token()}'},
                             json={'messaging_product': 'whatsapp', **payload})
        if r.status_code >= 300: log.warning('wa send %s: %s', r.status_code, r.text[:300]); return None
        return ((r.json().get('messages') or [{}])[0]).get('id')
    except Exception as e:
        log.warning('wa send: %s', e); return None

def _in_window(contact):
    t = contact.get('last_in_at')
    return bool(t) and datetime.fromisoformat(t) > now() - timedelta(hours=23, minutes=50)

async def _log_out(contact, text, by, kind='text', wa_id=None, extra=None):
    row = {'id': uid(), 'contact_id': contact['id'], 'creator_id': contact['creator_id'], 'dir': 'out', 'by': by, 'text': text[:4000], 'kind': kind,
           'wa_msg_id': wa_id, 'ok': bool(wa_id), 'at': iso(), 'expires_at': now() + timedelta(days=400), **(extra or {})}
    await db.wa_messages.insert_one(dict(row))
    await db.wa_contacts.update_one({'id': contact['id']}, {'$set': {'last_out_at': row['at'], 'last_text': text[:160]}})
    return row

async def send_text(cfg, contact, text, by='ia'):
    if not _in_window(contact): raise HTTPException(409, 'Passou de 24 h da última mensagem do contato: o WhatsApp só deixa mandar modelo aprovado.')
    wid = await _post(cfg, {'to': contact['wa_id'], 'type': 'text', 'text': {'body': text[:4000], 'preview_url': True}})
    return await _log_out(contact, text, by, wa_id=wid)

async def send_buttons(cfg, contact, text, buttons, by='ia'):
    """Até 3 botões (título até 20 letras); mais que isso vira lista (até 10 linhas)."""
    if not _in_window(contact): return None
    if len(buttons) <= 3:
        inter = {'type': 'button', 'body': {'text': text[:1024]}, 'action': {'buttons': [{'type': 'reply', 'reply': {'id': b[0], 'title': b[1][:20]}} for b in buttons]}}
    else:
        inter = {'type': 'list', 'body': {'text': text[:1024]}, 'action': {'button': 'Ver opções', 'sections': [{'title': 'Opções', 'rows': [
            {'id': b[0], 'title': b[1][:24], **({'description': b[2][:72]} if len(b) > 2 and b[2] else {})} for b in buttons[:10]]}]}}
    wid = await _post(cfg, {'to': contact['wa_id'], 'type': 'interactive', 'interactive': inter})
    return await _log_out(contact, text + '\n' + ' | '.join(b[1] for b in buttons), by, 'botoes', wid, {'buttons': [[b[0], b[1]] for b in buttons[:10]], 'body': text[:1024]})

async def send_template(cfg, contact, name, params, by='sistema'):
    wid = await _post(cfg, {'to': contact['wa_id'], 'type': 'template', 'template': {'name': name, 'language': {'code': (cfg.get('templates') or {}).get('lang') or 'pt_BR'},
                            'components': [{'type': 'body', 'parameters': [{'type': 'text', 'text': str(p)[:200]} for p in params]}]}})
    return await _log_out(contact, f'[modelo {name}] ' + ' · '.join(map(str, params)), by, 'modelo', wid)

async def say(cfg, contact, text, by='ia'):
    """Mensagem livre se ainda está na janela de 24 h; senão usa o modelo de lembrete, se houver."""
    if _in_window(contact): return await send_text(cfg, contact, text, by)
    tpl = (cfg.get('templates') or {}).get('reminder')
    if tpl: return await send_template(cfg, contact, tpl, [text], by)
    return None

# ---------- regras fixas ----------
def _n(t): return re.sub(r'\s+', ' ', (t or '').lower())
MINOR = re.compile(r'\b(tenho|fiz|vou fazer) (1[0-7]|[1-9])( anos)?\b|\bsou (de )?menor\b|\bde menor\b|\b(ensino m[eé]dio|oitavo ano|nono ano|1º ano|2º ano|3º ano)\b|\bmeus pais (deixam|n[aã]o deixam)\b|\bminha m[aã]e (deixa|n[aã]o deixa|vai ver)\b', re.I)
SEXUAL = re.compile(r'\b(nudes?|pelad[ao]|sem roupa|nua\b|nu\b|transar|sexo|gozar|punheta|siririca|buceta|xoxota|pau\b|pica\b|rola\b|peitos?\b|mamilos?|calcinha|bunda|rab[oa]\b|safad[ao]|tesão|tesuda|excitad[ao]|chupar|mamar|foder|meter|vídeo (íntimo|quente|picante)|foto (íntima|quente|picante)|privacy|onlyfans|conteúdo adulto|\+18)', re.I)
MEET = re.compile(r'\b(encontr(o|ar|ar você|ar vc)|pessoalmente|ao vivo e a cores|sair (comigo|com você|com vc)|onde (você|vc) mora|seu endereço|te (ver|buscar) (aí|ai)|motel|hotel|programa\b|acompanhante|cach[eê]\b)', re.I)
CONTACT = re.compile(r'\b(seu (número|numero|whats|zap|insta|instagram|telegram) (pessoal|particular|de verdade)|me passa (seu|teu) (número|numero|zap|whats|insta)|telegram|seu cpf)\b', re.I)
OUTSIDE = re.compile(r'\b(te pago (por fora|direto)|pix (direto|pra você|pra vc)|sua chave( pix)?|transfiro (direto|pra você)|pago em (dinheiro|espécie))\b', re.I)
BOTQ = re.compile(r'\b(rob[oô]|bot\b|intelig[eê]ncia artificial|chat ?gpt|[eé] uma? ia\b|voc[eê] [eé] (ia|real|de verdade)|vc [eé] (ia|real)|[eé] (voc[eê]|vc|tu) mesma|[eé] a pr[oó]pria|quem (t[aá]|est[aá]) (respondendo|falando)|[eé] (alguma )?assistente|[eé] (a )?equipe)\b', re.I)
RECORDED = re.compile(r'chamada[^.!?]{0,40}(gravad[ao]|grava[cç][aã]o)|n[aã]o [eé] ao vivo', re.I)
YES18 = re.compile(r'^(sim|s|tenho|claro|com certeza|maior|sou maior|tenho sim|sim tenho|\+ ?de 18|mais de 18|maior de idade)\b', re.I)

def age_of(text):
    m = re.search(r'\b(\d{2})\s*(anos|a)?\b', text or '')
    if m and 10 <= int(m.group(1)) <= 99: return int(m.group(1))
    return None

async def to_human(cfg, contact, reason, notify_text=None):
    await db.wa_contacts.update_one({'id': contact['id']}, {'$set': {'human': True, 'human_reason': reason, 'human_at': iso()}})
    if contact.get('sim'): return  # simulação: não avisa a equipe
    try:
        import handover as H
        await H.notify('whatsapp', contact['creator_id'], 'WhatsApp: precisa de você', notify_text or reason, contact['id'], contact.get('name'), {'contact_id': contact['id']})
    except Exception: log.exception('wa notify')

async def block(contact, reason, by='Sistema'):
    await db.wa_contacts.update_one({'id': contact['id']}, {'$set': {'blocked': reason, 'blocked_by': by, 'blocked_at': iso(), 'stage': 'bloqueado', 'human': False}})
    await db.wa_orders.update_many({'contact_id': contact['id'], 'status': 'aguardando_pix'}, {'$set': {'status': 'cancelado', 'cancel_reason': reason}})

# ---------- catálogo e agenda ----------
def on_items(cfg, kind=None):
    sells = cfg.get('sells') or {}
    return [i for i in (cfg.get('items') or []) if i.get('on') and sells.get(i.get('kind')) and (kind is None or i['kind'] == kind)]
def kinds_on(cfg): return [k for k in KINDS if (cfg.get('sells') or {}).get(k) and on_items(cfg, k)]
def money(c): return f"R$ {c / 100:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')

async def free_slots(cfg, minutes, days=7, limit=10):
    ag = cfg.get('agenda') or {}; gap = int(ag.get('gap_min') or 0); lead = now() + timedelta(hours=float(ag.get('lead_h') or 0))
    taken = await db.wa_orders.find({'creator_id': cfg['creator_id'], 'kind': 'call', '$or': [{'status': 'pago', 'call_status': 'agendada'},
                                     {'status': 'aguardando_pix', 'hold_until': {'$gt': iso()}}]}, {'_id': 0, 'slot_start': 1, 'minutes': 1}).to_list(500)
    busy = [(datetime.fromisoformat(t['slot_start']), datetime.fromisoformat(t['slot_start']) + timedelta(minutes=int(t.get('minutes') or 10) + gap)) for t in taken if t.get('slot_start')]
    out, base = [], now().astimezone(BR).replace(hour=0, minute=0, second=0, microsecond=0)
    for d in range(days + 1):
        day = base + timedelta(days=d)
        if day.strftime('%Y-%m-%d') in (ag.get('blocked') or []): continue
        per_day = sum(1 for b, _ in busy if b.astimezone(BR).date() == day.date())
        for rng in (ag.get('week') or {}).get(str(day.weekday())) or []:
            try:
                h1, m1 = map(int, rng[0].split(':')); h2, m2 = map(int, rng[1].split(':'))
            except Exception: continue
            t = day.replace(hour=h1, minute=m1); end = day.replace(hour=h2, minute=m2)
            while t + timedelta(minutes=minutes) <= end:
                if per_day >= int(ag.get('max_day') or 99): break
                e = t + timedelta(minutes=minutes + gap)
                if t >= lead and not any(t < be and e > bs for bs, be in busy): out.append(t); per_day += 1
                if len(out) >= limit: return out
                t += timedelta(minutes=minutes + gap)
    return out
def slot_label(t):
    t = t.astimezone(BR); dias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
    hoje = now().astimezone(BR).date()
    d = 'Hoje' if t.date() == hoje else 'Amanhã' if t.date() == hoje + timedelta(days=1) else f"{dias[t.weekday()]} {t.strftime('%d/%m')}"
    return f"{d} {t.strftime('%H:%M')}"

# ---------- pedidos ----------
async def open_order(contact, item_id):
    """Pedido do mesmo item nas últimas 24 h ainda esperando Pix, ou pago e não entregue (chamada: ainda não feita)."""
    return await db.wa_orders.find_one({'contact_id': contact['id'], 'item_id': item_id, 'created_at': {'$gte': (now() - timedelta(hours=24)).isoformat()},
                                        '$or': [{'status': 'aguardando_pix'}, {'status': 'pago', 'delivered_at': None, 'call_status': {'$in': [None, 'agendada']}}]}, {'_id': 0})

async def create_order(cfg, contact, item, slot=None, custom=None, by='ia'):
    import payments
    if not _in_window(contact): raise HTTPException(409, 'Passou de 24 h da última mensagem do contato: peça para ele mandar um oi antes de vender.')
    # trocou de horário/item antes de pagar: o pedido anterior do mesmo item que ainda espera Pix é cancelado (nunca duas cobranças abertas)
    await db.wa_orders.update_many({'contact_id': contact['id'], 'item_id': item['id'], 'status': 'aguardando_pix'}, {'$set': {'status': 'cancelado', 'cancel_reason': 'substituído por novo pedido'}})
    hold = int((cfg.get('pay') or {}).get('hold_min') or 15)
    o = {'id': uid(), 'creator_id': cfg['creator_id'], 'contact_id': contact['id'], 'contact_name': contact.get('name'), 'item_id': item['id'], 'item': item['name'],
         'kind': item['kind'], 'cents': int(item['cents']), 'minutes': int(item.get('minutes') or 0), 'days': int(item.get('days') or 0),
         'slot_start': slot.isoformat() if slot else None, 'call_status': 'agendada' if slot else None, 'custom': custom or None,
         'status': 'aguardando_pix', 'hold_until': (now() + timedelta(minutes=hold)).isoformat(), 'created_at': iso(), 'created_by': by,
         'creator_pct': int((cfg.get('pay') or {}).get('creator_pct') or 0), 'provider': (cfg.get('pay') or {}).get('provider') or 'manual',
         'reminders': [], 'sim': bool(contact.get('sim')), 'expires_at': now() + timedelta(days=730)}
    charge = await payments.create_charge(cfg, contact, o)
    o.update({'charge': charge, 'provider': charge.get('provider') or o['provider']})
    await db.wa_orders.insert_one(dict(o))
    await db.wa_contacts.update_one({'id': contact['id']}, {'$set': {'stage': 'aguardando_pix', 'order_id': o['id']}})
    what = f"{item['name']} · {money(o['cents'])}" + (f" · {slot_label(slot)}" if slot else '')
    msg = (f"separei {slot_label(slot)} pra você! " if slot else 'perfeito! ') + (f"pra confirmar é só pagar ({what}), no Pix ou no cartão. o link vale {hold} min:" if charge.get('link') else f"pra confirmar é só pagar o Pix ({what}). seguro por {hold} min:\n\n{charge.get('text') or ''}".rstrip())
    if charge.get('link'): msg += f"\n{charge['link']}"
    await send_text(cfg, contact, msg, by)
    if o['provider'] == 'manual' and not o.get('sim'):
        try:
            import handover as H
            await H.notify('whatsapp', cfg['creator_id'], 'WhatsApp: confira o Pix', f"{contact.get('name') or 'Contato'} vai pagar {what}. Confira e marque pago.", contact['id'], contact.get('name'), {'order_id': o['id']})
        except Exception: pass
    return o

def room_for(cfg):
    if (cfg.get('room_link') or '').strip(): return cfg['room_link'].strip()
    return f"https://meet.jit.si/alta-{secrets.token_urlsafe(12).replace('_', '').replace('-', '')}"

async def mark_paid(order_id, by_name='Sistema'):
    o = await db.wa_orders.find_one({'id': order_id}, {'_id': 0})
    if not o: raise HTTPException(404, 'Pedido não encontrado.')
    if o['status'] == 'pago': return o
    if o['status'] not in ('aguardando_pix', 'expirado'): raise HTTPException(409, 'Este pedido não está esperando pagamento.')
    cfg = await get_cfg(o['creator_id']); contact = await db.wa_contacts.find_one({'id': o['contact_id']}, {'_id': 0})
    upd = {'status': 'pago', 'paid_at': iso(), 'paid_by': by_name}
    if o['kind'] == 'call': upd['room'] = room_for(cfg)
    await db.wa_orders.update_one({'id': order_id}, {'$set': upd}); o.update(upd)
    await db.wa_contacts.update_one({'id': o['contact_id']}, {'$set': {'stage': 'cliente', 'buyer': True}, '$inc': {'spent_cents': o['cents']}})
    if contact:
        if o['kind'] == 'call': t = f"pronto, amor, tá confirmado! {slot_label(datetime.fromisoformat(o['slot_start']))} a gente se fala. te mando o link um pouquinho antes"
        elif o['kind'] == 'custom': t = f"recebi! já anotei tudo, te mando o vídeo aqui em até {o.get('days') or 3} dias"
        else: t = 'recebi, amor! já já te mando aqui'
        try: await say(cfg, contact, t, 'sistema')
        except HTTPException: pass
    if o.get('sim'): return o
    try:
        import handover as H
        await H.notify('pagamento', o['creator_id'], 'WhatsApp: pagamento recebido', f"{o['item']} · {money(o['cents'])}" + (f" · {slot_label(datetime.fromisoformat(o['slot_start']))}" if o.get('slot_start') else ' · entregar'),
                       o['contact_id'], o.get('contact_name'), {'order_id': o['id']})
    except Exception: pass
    return o

# ---------- IA (texto livre) ----------
SAFE_PERSONA = ['nome_artistico', 'como_ser_chamada', 'personalidade', 'como_fala', 'assuntos_conversa', 'nao_gosta', 'bordoes', 'como_chama_assinantes']
async def ai_reply(cfg, contact, history, variant=0, probe=False):
    import assist as A
    key = await A.xai_key(); c = await A.config()
    if not key: print('wa ia: sem chave da xAI (Configurações › Alta Ajuda)', flush=True); return None
    creator = await db.creators.find_one({'id': cfg['creator_id']}, {'_id': 0, 'name': 1}) or {}
    prof = await db.assist_profiles.find_one({'creator_id': cfg['creator_id']}, {'_id': 0, 'persona': 1, 'voice': 1, 'gender': 1}) or {}
    pers = '\n'.join(f"- {k}: {str((prof.get('persona') or {}).get(k))[:400]}" for k in SAFE_PERSONA if (prof.get('persona') or {}).get(k))
    v = prof.get('voice') or {}
    per = prof.get('persona') or {}
    ex = [l.strip() for l in str(per.get('exemplos_mensagens') or '').split('\n') if l.strip() and not SEXUAL.search(l) and not MEET.search(l)][:8]
    pend = await db.wa_orders.find_one({'contact_id': contact['id'], 'status': {'$in': ['aguardando_pix', 'pago']}}, {'_id': 0, 'item': 1, 'status': 1, 'slot_start': 1, 'kind': 1}, sort=[('created_at', -1)])
    state = f"etapa: {contact.get('stage') or 'conversando'}" + (f"; pedido {pend['item']} {('esperando o Pix' if pend['status'] == 'aguardando_pix' else 'já pago')}" + (f" para {slot_label(datetime.fromisoformat(pend['slot_start']))}" if pend.get('slot_start') else '') if pend else '; ainda não comprou nada aqui')
    cat = '\n'.join(f"- [id {i['id']}] {KINDS[i['kind']]}: {i['name']} · {money(i['cents'])}" + (f" · {i['minutes']} min" if i.get('minutes') else '') + (f" · entrega em até {i['days']} dias" if i.get('days') else '') + (f" · como apresentar: {i.get('pitch')}" if i.get('pitch') else '') for i in on_items(cfg))
    name = (prof.get('persona') or {}).get('como_ser_chamada') or creator.get('name') or 'ela'
    who = (f"Você é redatora da equipe da {name}, criadora de conteúdo, e escreve as mensagens que ela manda no WhatsApp comercial dela (canal de vendas sem conteúdo adulto). Escreva em primeira pessoa, como ela." if variant != 2
           else f"Você escreve como {name}, criadora de conteúdo, no WhatsApp comercial dela.")
    system = f"""{who} Quem chega aqui veio do Instagram ou TikTok e já confirmou ter mais de 18 anos.
Jeito dela:
{pers or '- simpática, leve e carinhosa'}
Tom: {v.get('tone') or 'carinhosa'}; palavras que usa: {v.get('use_words') or '-'}; evita: {v.get('avoid_words') or '-'}.
{('Exemplos de como ela escreve (imite o jeito, não copie):' + chr(10) + chr(10).join('- ' + e[:160] for e in ex)) if ex else ''}

Situação deste contato: {state}.

O que ela vende AQUI (só isto, com estes valores; não invente outros):
{cat or '- nada no momento'}

Regras que nunca mudam:
- Aqui é só conversa leve e venda dos itens acima. NADA de conteúdo adulto, sexual, nude, duplo sentido picante ou flerte sexual. Se puxarem, diga com carinho que aqui não é esse tipo de conteúdo e volte para os itens.
- Nunca marque encontro, nunca passe contato pessoal, endereço ou outra rede, nunca aceite pagamento por fora.
- Chamada ao vivo é ao vivo de verdade, com ela, no horário marcado. Nunca diga que é gravada.
- Não diga valor que não está na lista. Não prometa prazo diferente.
- Jeito de WhatsApp: mensagem CURTA (no máximo umas 20 palavras), solta, como quem digita no celular. Pode começar com minúscula, sem ponto final, abreviações naturais de vez em quando (vc, tb, pq, tô, tá, pra). No máximo 1 emoji, e nem sempre. Nada de frases formais ("fico feliz em poder ajudar", "que gentileza", "transmitindo"). Sem listas e sem repetir frase que já mandou.
- Apelido carinhoso (amor, bb, lindo) no máximo de vez em quando, não em toda mensagem. Se a última mensagem dela já tinha apelido, essa não tem.
- Proibido soar atendente: nada de "fico feliz", "fico bem feliz", "fico feliz que tenha gostado", "obrigada pelo elogio", "com muito carinho", "com bastante carinho", "que ótimo", "perfeito", "com certeza", "estou à disposição". Reaja como gente: "aah para kkk", "ai que fofo", "sério? amei", "ain obrigada 🙈", "kkkk vc é engraçado".
- Quando usar "acao", o sistema manda os botões logo depois da sua mensagem: NÃO pergunte "quer ver os horários?", "quer ver as opções?" nem liste o que vende. Escreva só a reação/explicação curta (ex.: "é só eu e vc, ao vivo, 10 min de papo"), sem pergunta no fim.
- Primeiro responda de verdade ao que ele disse (pergunta, elogio, piada), com personalidade; só depois, se fizer sentido, puxe para o que ela vende. Não seja robótica nem vendedora o tempo todo.
- Nunca deixe a conversa morrer: sem "acao", termine com uma pergunta leve ou um convite.
- Se ele escrever a escolha em vez de tocar no botão (ex.: "quero a chamada", "quinta pode?"), use a ação certa para o sistema mostrar as opções de novo.
- Se ele já pagou, agradeça e converse; não ofereça o mesmo item de novo e não use "acao" para ele (só se ele pedir OUTRA coisa).
- Varie o começo das frases: não comece toda mensagem com "obrigada" nem repita o apelido em todas.
- Elogio: agradeça com charme e leveza (sem flerte sexual) e siga a conversa. Pergunta pessoal (de onde é, idade, namoro, onde mora): responda de forma simpática e vaga, sem dados reais (ex.: "sou do Brasil inteiro agora 😄"), e volte para ele.
- Sempre escreva uma resposta: nunca devolva vazio, null ou false.
- Quando a pessoa mostrar interesse em comprar, use "acao" para o sistema mandar os botões: "menu" (mostrar o que vende), "horarios" (chamada ao vivo), "pedido_video" (vídeo personalizado: preencha "pedido" com para quem, ocasião e recado quando ele contar) ou "item" com "item_id" para fotos/vídeos.
Responda SÓ em JSON: {{"texto": "...", "acao": null|"menu"|"horarios"|"pedido_video"|"item", "item_id": null, "pedido": {{"para": "", "ocasiao": "", "recado": ""}}}}"""
    # lote 170: conversa vai como transcrição numa mensagem só (igual à Alta Ajuda); em turnos separados a xAI às vezes devolvia só "false"/"null"
    tr = '\n'.join(('Fã: ' if m['dir'] == 'in' else 'Ela: ') + m['text'][:500].replace('\n', ' / ') for m in history[-14:])
    msgs = [{'role': 'system', 'content': system},
            {'role': 'user', 'content': f"Conversa até agora no WhatsApp:\n{tr}\n\nEscreva a PRÓXIMA mensagem dela respondendo à última mensagem do fã, no jeito dela. Responda só com o objeto JSON pedido, com \"texto\" sempre preenchido."}]
    body = {'model': c.get('suggest_model') or c['model'], 'messages': msgs, 'temperature': 0.8, 'max_tokens': 500}
    if variant != 1: body['response_format'] = {'type': 'json_object'}  # variante 1 = sem JSON forçado (2ª tentativa)
    try:
        async with httpx.AsyncClient(timeout=30) as cl:
            r = await cl.post(f'{A.XAI}/chat/completions', headers={'Authorization': f'Bearer {key}'}, json=body)
        if r.status_code == 400 and 'response_format' in (r.text or ''):  # modelo sem suporte a JSON forçado: tenta sem
            async with httpx.AsyncClient(timeout=30) as cl:
                r = await cl.post(f'{A.XAI}/chat/completions', headers={'Authorization': f'Bearer {key}'},
                                  json={'model': c.get('suggest_model') or c['model'], 'messages': msgs, 'temperature': 0.8, 'max_tokens': 500})
        if r.status_code >= 300: print('wa ia: xAI respondeu', r.status_code, (r.text or '')[:300], flush=True); return None
        data = r.json(); ch = (data.get('choices') or [{}])[0]; raw = (ch.get('message') or {}).get('content', '') or ''
        if probe: return {'variant': variant, 'raw': raw[:800], 'finish': ch.get('finish_reason'), 'refusal': (ch.get('message') or {}).get('refusal')}
        if contact.get('sim'): await db.wa_contacts.update_one({'id': contact['id']}, {'$push': {'ai_raw': {'$each': [raw[:1500]], '$slice': -6}}})  # simulador: guarda a resposta crua para diagnóstico
        out = A.parse_json(raw) or None
        if not out and raw.strip() and '{' not in raw and raw.strip().lower() not in ('null', 'none'): out = {'texto': raw.strip()[:600], 'acao': None}  # respondeu em texto puro
        if not out: print('wa ia: resposta fora do formato:', raw[:300].replace('\n', ' '), flush=True)
        elif not isinstance(out.get('texto'), str) or out.get('texto').strip().lower() in ('', 'null', 'none', 'false', 'true'): print('wa ia: veio sem texto:', raw[:300].replace('\n', ' '), flush=True)
        try:
            cost, *_ = A.cost_of(c.get('suggest_model') or c['model'], data.get('usage') or {})
            await db.assist_usage.insert_one({'id': uid(), 'user_id': 'whatsapp', 'user_name': 'WhatsApp', 'creator_id': cfg['creator_id'], 'mode': 'whatsapp', 'day': A.today(), 'at': iso(),
                                              'tokens': (data.get('usage') or {}).get('total_tokens'), 'cost_usd': cost, 'expires_at': now() + timedelta(days=120)})
        except Exception: pass
        return out
    except Exception as e:
        print('wa ia: falhou', repr(e)[:300], flush=True); return None

def zap_parts(t):
    """Deixa com cara de WhatsApp: tira ponto final, minúscula no começo e quebra mensagem longa em até 2 balões."""
    t = re.sub(r'\s+', ' ', t).strip()
    parts = [t]
    if len(t) > 120:
        cut = [m.end() for m in re.finditer(r'[.!?](\s|$)', t) if 30 <= m.end() <= len(t) - 20]
        if cut:
            k = min(cut, key=lambda x: abs(x - len(t) / 2)); parts = [t[:k].strip(), t[k:].strip()]
    out = []
    for p in parts:
        p = re.sub(r'(?<![.])\.$', '', p).strip()  # sem ponto final (mantém reticências)
        if p and p[0].isupper() and not (len(p) > 1 and p[1].isupper()): p = p[0].lower() + p[1:]
        if p: out.append(p)
    return out or [t]

PET = r'(?:amor|bb|bebê|bebe|lind[oa]|gat[oa]|querid[oa]|meu bem|vida|anjo|fofo)'
def has_pet(t): return bool(re.search(rf'\b{PET}\b', t or '', re.I))
def drop_pet(t):
    """Tira o apelido quando a mensagem anterior já tinha um (evita "bb" em toda mensagem)."""
    t = re.sub(rf'^((?:oi|oii+|ei|ai|aii+|ah|aah+|ui|ain|nossa|hmm+|obrigad[ao]|brigad[ao]|valeu)\b),?\s+{PET}\b', r'\1', t, flags=re.I)
    t = re.sub(rf'^{PET}\b[,!]?\s*', '', t, flags=re.I)
    t = re.sub(rf',\s*{PET}\b(?=\s*([.!?,]|$|[\U0001F300-\U0001FAFF]))', '', t, flags=re.I)
    return re.sub(r'\s+', ' ', t).strip(' ,') or t

FORMAL = ((r',?\s*(eu )?fico (muito |bem |super |tão )?feliz( que (vc |você )?(tenha )?(gostado|curtido)| em (poder )?ajudar| com (isso|seu elogio))?', ''),
          (r'obrigada pelo elogio', 'obrigada'), (r'\s+com (muito|bastante|todo o?|todo) carinho', ''), (r',?\s*estou à disposição', ''))
def unformal(t):
    for a, b in FORMAL: t = re.sub(a, b, t, flags=re.I)
    t = re.sub(r'\s+([,.!?])', r'\1', re.sub(r'\s+', ' ', t)).strip(' ,')
    return re.sub(r'^[,.]\s*', '', t)

def _fix_one(m):
    for enc in ('latin-1', 'cp1252'):
        try: return m.group(0).encode(enc).decode('utf-8')
        except (UnicodeEncodeError, UnicodeDecodeError): pass
    return m.group(0)
def fix_accents(t):
    """Conserta acento quebrado que às vezes vem da xAI (ex.: "ocasiÃ£o" -> "ocasião")."""
    return re.sub(r'[ÃÂ][\x80-\xbf‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]', _fix_one, t or '')

def _clean_ai(text):
    if not isinstance(text, str): return ''
    t = fix_accents(text.strip())
    if t.lower().strip('"\' .') in ('', 'null', 'none', 'undefined', 'false', 'true'): return ''
    chk = re.sub(r'conte[uú]do adulto|\+18', '', t, flags=re.I)
    if SEXUAL.search(chk) or MEET.search(t) or CONTACT.search(t) or RECORDED.search(t): return ''
    return t[:600]

# ---------- passos do funil ----------
QUIET = ['olha 👇', 'tenho esses:', 'escolhe aqui:']
async def show_menu(cfg, contact, text=None, quiet=False):
    text = text or (random.choice(QUIET) if quiet else random.choice(['o que você quer?', 'o que te deixou curioso?', 'qual desses combina com você?']))
    ks = kinds_on(cfg)
    if not ks: return await send_text(cfg, contact, 'no momento não tô com horários nem pedidos abertos, mas logo volto, tá?')
    if len(ks) == 1: return await pick_kind(cfg, contact, ks[0], quiet)
    await db.wa_contacts.update_one({'id': contact['id']}, {'$set': {'stage': 'escolhendo'}})
    return await send_buttons(cfg, contact, text, [(f'k:{k}', KINDS[k]) for k in ks])

async def pick_kind(cfg, contact, kind, quiet=False):
    items = on_items(cfg, kind)
    if not items: return await show_menu(cfg, contact, 'esse agora não tenho, mas olha o que tenho:')
    if len(items) > 1: return await send_buttons(cfg, contact, random.choice(QUIET) if quiet else 'qual você prefere?', [(f'i:{i["id"]}', i['name'], money(i['cents'])) for i in items] if len(items) > 3 else [(f'i:{i["id"]}', f"{i['name'][:12]} {money(i['cents'])}") for i in items])
    return await pick_item(cfg, contact, items[0], quiet)

async def pick_item(cfg, contact, item, quiet=False):
    if item['kind'] == 'call':
        slots = await free_slots(cfg, int(item.get('minutes') or 10))
        if not slots: return await send_text(cfg, contact, 'essa semana minha agenda tá cheia, amor. me chama de novo em uns dias que eu abro horário pra você')
        await db.wa_contacts.update_one({'id': contact['id']}, {'$set': {'stage': 'escolhendo', 'pending_item': item['id']}})
        lead = random.choice(['meus horários 👇', 'tenho esses horários:', 'escolhe um horário:']) if quiet else random.choice([f"é ao vivo, só eu e você, {item.get('minutes') or 10} minutinhos. tenho esses horários:", f"{item.get('minutes') or 10} minutinhos ao vivo comigo! olha os horários que eu tenho:", f"vai ser só nosso, {item.get('minutes') or 10} minutos ao vivo. qual horário fica bom pra você?"])
        return await send_buttons(cfg, contact, lead, [(f's:{item["id"]}:{int(s.timestamp())}', slot_label(s)) for s in slots[:10]])
    if item['kind'] == 'custom':
        await db.wa_contacts.update_one({'id': contact['id']}, {'$set': {'stage': 'pedido', 'pending_item': item['id']}})
        return await send_text(cfg, contact, random.choice(['amo gravar vídeo personalizado! me conta: é pra você ou pra presentear alguém? qual o nome e o que você quer que eu fale?', 'que delícia! é pra você ou é presente? me fala o nome e o recadinho que eu gravo do meu jeito', 'bora! me conta pra quem é, se é alguma ocasião especial e o que você quer que eu diga']))
    return await create_order(cfg, contact, item)

def item_by_id(cfg, iid): return next((i for i in on_items(cfg) if i['id'] == iid), None)

# ---------- entrada: webhook ----------
async def handle_in(cfg, contact, text, button_id=None):
    if contact.get('blocked'): return
    if contact.get('human'):
        if contact.get('sim'): return
        try:
            import handover as H
            await H.notify('whatsapp', contact['creator_id'], 'WhatsApp: mensagem nova', (text or '')[:200], contact['id'], contact.get('name'), {'contact_id': contact['id']})
        except Exception: pass
        return
    t = _n(text)
    if MINOR.search(t) or (age_of(t) is not None and age_of(t) < 18 and contact.get('stage') in ('novo', 'idade')):
        await block(contact, 'menor de idade')
        try: await send_text(cfg, contact, 'obrigada pela mensagem! aqui é só para maiores de 18, então não vou poder seguir com você. se cuida!', 'sistema')
        except HTTPException: pass
        await to_human(cfg, {**contact}, 'menor de idade: contato bloqueado')
        await db.wa_contacts.update_one({'id': contact['id']}, {'$set': {'human': False}})
        return
    # idade antes de tudo
    if not contact.get('age_ok'):
        if contact.get('stage') == 'idade' and not re.search(r'\bn[aã]o\b', t) and (YES18.search(t) or (age_of(t) or 0) >= 18):
            await db.wa_contacts.update_one({'id': contact['id']}, {'$set': {'age_ok': True, 'age_at': iso(), 'stage': 'conversando'}})
            contact['age_ok'] = True
            ks = kinds_on(cfg)
            lst = ', '.join(KINDS[k].lower() for k in ks)
            intro = random.choice([f'aah que bom! aqui eu tenho {lst}.', f'que bom! por aqui eu faço {lst}.', f'ebaa, então vamos lá: aqui tem {lst}.']) if ks else 'que bom te ter aqui!'
            await send_text(cfg, contact, intro)
            return await show_menu(cfg, contact)
        tries = int(contact.get('age_tries') or 0)
        if tries >= 2: return await to_human(cfg, contact, 'não confirmou a idade depois de 2 perguntas')
        await db.wa_contacts.update_one({'id': contact['id']}, {'$set': {'stage': 'idade'}, '$inc': {'age_tries': 1}})
        return await send_text(cfg, contact, cfg.get('welcome') if tries == 0 else 'antes de seguir preciso só confirmar: você tem mais de 18 anos?')
    # travas que chamam humano
    for rx, why, reply in ((BOTQ, 'perguntou se é ela mesma / robô', None), (MEET, 'pediu encontro presencial', 'encontro não rola, amor. aqui é só por aqui mesmo'),
                           (CONTACT, 'pediu contato pessoal', 'meu contato é só esse aqui, tá?'), (OUTSIDE, 'quer pagar por fora', None),
                           (SEXUAL, 'puxou conteúdo adulto', 'aqui não é esse tipo de conteúdo, amor. mas posso te mostrar o que tenho por aqui')):
        if rx.search(t):
            if reply:
                try: await send_text(cfg, contact, reply)
                except HTTPException: pass
            return await to_human(cfg, contact, why, f"{why}: \"{(text or '')[:120]}\"")
    # botões
    if button_id:
        if button_id.startswith('k:') and button_id[2:] in KINDS: return await pick_kind(cfg, contact, button_id[2:])
        if button_id.startswith('i:'):
            it = item_by_id(cfg, button_id[2:])
            return await (pick_item(cfg, contact, it) if it else show_menu(cfg, contact, 'esse acabou, olha o que tenho:'))
        if button_id.startswith('s:'):
            _, iid, ts = button_id.split(':', 2)
            it = item_by_id(cfg, iid)
            if not it: return await show_menu(cfg, contact)
            slot = datetime.fromtimestamp(int(ts), BR)
            if slot not in [s for s in await free_slots(cfg, int(it.get('minutes') or 10), limit=60)]:
                await send_text(cfg, contact, 'ih, esse horário acabou de ser pego. olha os que sobraram:')
                return await pick_item(cfg, contact, it)
            return await create_order(cfg, contact, it, slot=slot)
    # texto livre: IA
    hist = await db.wa_messages.find({'contact_id': contact['id']}, {'_id': 0, 'dir': 1, 'text': 1}).sort('at', -1).to_list(14)
    hist.reverse()
    if await db.wa_messages.count_documents({'creator_id': cfg['creator_id'], 'by': 'ia', 'at': {'$gte': (now() - timedelta(days=1)).isoformat()}}) >= int(cfg.get('max_ai_day') or 400):
        return await to_human(cfg, contact, 'teto diário de respostas da IA')
    def _empty(o): return not o or (not o.get('acao') and (not isinstance(o.get('texto'), str) or o.get('texto').strip().lower() in ('', 'null', 'none', 'false', 'true')))
    out = await ai_reply(cfg, contact, hist)
    if _empty(out): out = await ai_reply(cfg, contact, hist, variant=1)  # veio vazia: tenta mais uma vez, sem JSON forçado
    if _empty(out): out = None
    if not out:  # falhou uma vez: responde com o menu; duas seguidas: chama a equipe
        if int(contact.get('ai_fail') or 0) >= 1: return await to_human(cfg, contact, 'a IA não respondeu duas vezes seguidas')
        await db.wa_contacts.update_one({'id': contact['id']}, {'$inc': {'ai_fail': 1}})
        return await show_menu(cfg, contact, 'deixa eu te mostrar o que tenho por aqui:')
    if contact.get('ai_fail'): await db.wa_contacts.update_one({'id': contact['id']}, {'$set': {'ai_fail': 0}})
    txt = _clean_ai(out.get('texto'))
    if txt:
        txt = unformal(txt)
        last = [m.get('text') or '' for m in hist if m.get('dir') == 'out'][-2:]
        if any(has_pet(x) for x in last): txt = drop_pet(txt)
    if not txt and not out.get('acao'): return await to_human(cfg, contact, 'resposta da IA barrada pelas regras', f"Fã: \"{(text or '')[:120]}\"")
    if txt:
        for part in zap_parts(txt): await send_text(cfg, contact, part)
    ac = out.get('acao')
    q = bool(txt)  # a IA já falou: os botões vêm só com um rótulo curto, sem repetir pergunta
    if ac == 'menu': return await show_menu(cfg, contact, quiet=q)
    if ac == 'horarios':
        it = (on_items(cfg, 'call') or [None])[0]
        if it: return await pick_item(cfg, contact, it, q)
    if ac == 'item' and out.get('item_id'):
        it = item_by_id(cfg, str(out['item_id']))
        if it and it['kind'] in ('photos', 'videos') and not await open_order(contact, it['id']): return await pick_item(cfg, contact, it, q)
    if ac == 'pedido_video':
        p = out.get('pedido') or {}
        it = next((i for i in on_items(cfg, 'custom') if i['id'] == contact.get('pending_item')), None) or (on_items(cfg, 'custom') or [None])[0]
        if it and (p.get('para') or '').strip() and (p.get('recado') or '').strip():
            custom = {k: fix_accents(str(p.get(k) or ''))[:300] for k in ('para', 'ocasiao', 'recado')}
            if SEXUAL.search(_n(' '.join(custom.values()))): return await to_human(cfg, contact, 'pedido de vídeo com tema adulto')
            if await open_order(contact, it['id']): return  # já tem esse vídeo pedido (pago ou esperando Pix): não cobra de novo
            return await create_order(cfg, contact, it, custom=custom)
        if it and contact.get('stage') != 'pedido':
            if txt:  # a IA já pediu os detalhes do vídeo com as palavras dela: só marca a etapa, sem repetir a pergunta fixa
                return await db.wa_contacts.update_one({'id': contact['id']}, {'$set': {'stage': 'pedido', 'pending_item': it['id']}})
            return await pick_item(cfg, contact, it)

@router.get('/wa/webhook', response_class=PlainTextResponse)
async def verify(request: Request):
    q = request.query_params
    if q.get('hub.mode') == 'subscribe' and os.environ.get('WA_VERIFY_TOKEN') and hmac.compare_digest(q.get('hub.verify_token') or '', os.environ['WA_VERIFY_TOKEN']):
        return q.get('hub.challenge') or ''
    raise HTTPException(403, 'Token inválido.')

@router.post('/wa/webhook')
async def webhook(request: Request):
    raw = await request.body(); secret = os.environ.get('WA_APP_SECRET', '')
    sig = request.headers.get('x-hub-signature-256', '')
    if not secret or not hmac.compare_digest(sig, 'sha256=' + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()): raise HTTPException(403, 'Assinatura inválida.')
    try: body = json.loads(raw or b'{}')
    except Exception: return {'ok': True}
    for entry in body.get('entry') or []:
        for ch in entry.get('changes') or []:
            v = ch.get('value') or {}
            pid = (v.get('metadata') or {}).get('phone_number_id')
            cfg_row = await db.wa_config.find_one({'phone_number_id': pid}, {'_id': 0, 'creator_id': 1}) if pid else None
            if not cfg_row: continue
            cfg = await get_cfg(cfg_row['creator_id'])
            names = {c.get('wa_id'): ((c.get('profile') or {}).get('name')) for c in v.get('contacts') or []}
            for st in v.get('statuses') or []:
                await db.wa_messages.update_one({'wa_msg_id': st.get('id')}, {'$set': {'status': st.get('status')}})
            for m in v.get('messages') or []:
                tk = asyncio.create_task(_process(cfg, m, names.get(m.get('from')))); _tasks.add(tk); tk.add_done_callback(_tasks.discard)
    return {'ok': True}

async def _process(cfg, m, profile_name):
    wa = str(m.get('from') or '')
    if not re.fullmatch(r'\d{8,16}', wa): return
    lock = _locks.setdefault(f"{cfg['creator_id']}:{wa}", asyncio.Lock())
    async with lock:
        try:
            if m.get('id') and await db.wa_messages.find_one({'wa_msg_id': m['id']}, {'_id': 1}): return  # a Meta reenvia
            text, button = '', None
            tp = m.get('type')
            if tp == 'text': text = (m.get('text') or {}).get('body') or ''
            elif tp == 'interactive':
                it = m.get('interactive') or {}; r = it.get('button_reply') or it.get('list_reply') or {}
                button, text = r.get('id'), r.get('title') or ''
            elif tp == 'button': text = (m.get('button') or {}).get('text') or ''
            else: text = f'[{tp}]'
            contact = await db.wa_contacts.find_one({'creator_id': cfg['creator_id'], 'wa_id': wa}, {'_id': 0})
            if not contact:
                src = 'tiktok' if re.search(r'tik ?tok', text, re.I) else 'instagram' if re.search(r'insta', text, re.I) else None
                contact = {'id': uid(), 'creator_id': cfg['creator_id'], 'wa_id': wa, 'name': (profile_name or '')[:60], 'source': src, 'stage': 'novo',
                           'age_ok': False, 'human': False, 'blocked': None, 'created_at': iso(), 'spent_cents': 0, 'expires_at': now() + timedelta(days=730)}
                await db.wa_contacts.insert_one(dict(contact))
            t = iso()
            await db.wa_contacts.update_one({'id': contact['id']}, {'$set': {'last_in_at': t, 'last_text': text[:160], 'name': contact.get('name') or (profile_name or '')[:60]}})
            contact['last_in_at'] = t
            await db.wa_messages.insert_one({'id': uid(), 'contact_id': contact['id'], 'creator_id': cfg['creator_id'], 'dir': 'in', 'by': 'fã', 'text': text[:4000], 'kind': tp,
                                             'button': button, 'wa_msg_id': m.get('id'), 'at': t, 'expires_at': now() + timedelta(days=400)})
            if not cfg.get('enabled'): return
            if tp not in ('text', 'interactive', 'button'):
                if not contact.get('human') and not contact.get('blocked'): await to_human(cfg, contact, f'mandou {tp} (a IA só lê texto)')
                return
            await handle_in(cfg, contact, text, button)
        except HTTPException: pass
        except Exception: log.exception('wa process')

# ---------- relógio: segurar horário, lembretes, link da chamada ----------
async def tick():
    t = now()
    async for o in db.wa_orders.find({'status': 'aguardando_pix', 'hold_until': {'$lt': t.isoformat()}, 'provider': {'$ne': 'manual'}}, {'_id': 0}):
        await db.wa_orders.update_one({'id': o['id'], 'status': 'aguardando_pix'}, {'$set': {'status': 'expirado'}})
    # manual: o chatter confere; só expira depois de 12 h sem marcar
    await db.wa_orders.update_many({'status': 'aguardando_pix', 'provider': 'manual', 'created_at': {'$lt': (t - timedelta(hours=12)).isoformat()}}, {'$set': {'status': 'expirado'}})
    soon = (t + timedelta(minutes=31)).isoformat()
    async for o in db.wa_orders.find({'kind': 'call', 'status': 'pago', 'call_status': 'agendada', 'slot_start': {'$lte': soon}}, {'_id': 0}):
        start = datetime.fromisoformat(o['slot_start']); mins = (start - t).total_seconds() / 60
        cfg = await get_cfg(o['creator_id']); contact = await db.wa_contacts.find_one({'id': o['contact_id']}, {'_id': 0})
        if not contact or contact.get('blocked'): continue
        sent = set(o.get('reminders') or [])
        async def mark(k): await db.wa_orders.update_one({'id': o['id']}, {'$addToSet': {'reminders': k}})
        try:
            if cfg.get('reminders') and 6 < mins <= 31 and '30' not in sent:
                await mark('30'); await say(cfg, contact, 'falta meia hora pra nossa chamada! daqui a pouco te mando o link', 'sistema')
                if o.get('sim'): continue
                import handover as H
                await H.notify('whatsapp', o['creator_id'], 'Chamada ao vivo em 30 min', f"{o.get('contact_name') or 'Contato'} · {slot_label(start)} · confirme com a criadora", o['contact_id'], o.get('contact_name'), {'order_id': o['id']})
            if -int(o.get('minutes') or 10) < mins <= 6 and 'link' not in sent:
                await mark('link'); await say(cfg, contact, f"tô entrando! é só tocar aqui no horário: {o.get('room')}\nabre pelo navegador, não precisa instalar nada", 'sistema')
            if cfg.get('after_call') and mins < -(int(o.get('minutes') or 10) + 5) and 'depois' not in sent:
                await mark('depois')
                if _in_window(contact): await send_text(cfg, contact, 'adorei te conhecer! quando quiser repetir é só me chamar aqui', 'sistema')
        except HTTPException: pass
        except Exception: log.exception('wa tick')

# ---------- rotas: configuração (gestor) ----------
class ItemIn(Strict):
    id: str = Field(default='', max_length=24)
    kind: Literal['call', 'custom', 'photos', 'videos']
    name: str = Field(min_length=1, max_length=40)
    cents: int = Field(ge=100, le=10_000_000)
    minutes: int = Field(default=0, ge=0, le=180)
    days: int = Field(default=0, ge=0, le=30)
    pitch: str = Field(default='', max_length=200)
    on: bool = True
class CfgIn(Strict):
    enabled: bool = False
    phone_number_id: str = Field(default='', max_length=40, pattern=r'^\d*$')
    display_phone: str = Field(default='', max_length=30)
    sells: dict[str, bool] = Field(default_factory=dict)
    items: list[ItemIn] = Field(default_factory=list, max_length=40)
    agenda: dict = Field(default_factory=dict)
    pay: dict = Field(default_factory=dict)
    room_link: str = Field(default='', max_length=300)
    welcome: str = Field(default='', max_length=600)
    reminders: bool = True
    after_call: bool = True
    templates: dict = Field(default_factory=dict)
    max_ai_day: int = Field(default=400, ge=10, le=5000)

@router.get('/wa/creators')
async def creators_list(user=Depends(wa_user)):
    q = {'deleted_at': None} if is_staff(user) else {'deleted_at': None, 'id': {'$in': user.get('creator_ids') or []}}
    cs = await db.creators.find(q, {'_id': 0, 'id': 1, 'name': 1}).sort('name', 1).to_list(500)
    cfgs = {c['creator_id']: c for c in await db.wa_config.find({}, {'_id': 0}).to_list(500)}
    since = (now() - timedelta(days=7)).isoformat(); out = []
    for c in cs:
        g = cfgs.get(c['id']) or {}
        out.append({'creator_id': c['id'], 'name': c['name'], 'enabled': bool(g.get('enabled')), 'display_phone': g.get('display_phone') or '', 'connected': bool(g.get('phone_number_id')),
                    'sells': [k for k in KINDS if (g.get('sells') or {}).get(k)],
                    'open_human': await db.wa_contacts.count_documents({'creator_id': c['id'], 'human': True, 'blocked': None, 'sim': {'$ne': True}}),
                    'week_cents': sum(o['cents'] for o in await db.wa_orders.find({'creator_id': c['id'], 'status': 'pago', 'paid_at': {'$gte': since}, 'sim': {'$ne': True}}, {'_id': 0, 'cents': 1}).to_list(5000))})
    return {'creators': out, 'kinds': KINDS, 'ready': bool(wa_token() and os.environ.get('WA_APP_SECRET') and os.environ.get('WA_VERIFY_TOKEN'))}

@router.get('/wa/config/{creator_id}')
async def cfg_read(creator_id: str, user=Depends(manager)):
    cfg = await get_cfg(creator_id)
    people = [u['name'] for u in await db.users.find({'active': True, 'creator_ids': creator_id}, {'_id': 0, 'name': 1}).to_list(100)]
    return {'cfg': cfg, 'kinds': KINDS, 'chatters': people}

@router.post('/wa/config/{creator_id}')
async def cfg_save(creator_id: str, body: CfgIn, user=Depends(manager)):
    if not await db.creators.find_one({'id': creator_id}, {'_id': 1}): raise HTTPException(404, 'Criadora não encontrada.')
    if body.phone_number_id and await db.wa_config.find_one({'phone_number_id': body.phone_number_id, 'creator_id': {'$ne': creator_id}}, {'_id': 1}):
        raise HTTPException(409, 'Este número já está em outra criadora.')
    d = default_cfg(creator_id); c = body.model_dump()
    items = []
    for it in c['items']:
        it['id'] = it['id'] or secrets.token_hex(4)
        if it['kind'] == 'call' and not it['minutes']: raise HTTPException(422, f"Diga a duração da chamada \"{it['name']}\".")
        items.append(it)
    ag = {**d['agenda'], **(c['agenda'] or {})}
    for k, rngs in (ag.get('week') or {}).items():
        if k not in [str(i) for i in range(7)] or not isinstance(rngs, list): raise HTTPException(422, 'Agenda inválida.')
        for r in rngs:
            if not (isinstance(r, list) and len(r) == 2 and all(re.fullmatch(r'\d{2}:\d{2}', str(x)) for x in r) and r[0] < r[1]): raise HTTPException(422, 'Horário da agenda inválido.')
    ag['gap_min'] = max(0, min(120, int(ag.get('gap_min') or 0))); ag['lead_h'] = max(0, min(72, float(ag.get('lead_h') or 0))); ag['max_day'] = max(1, min(50, int(ag.get('max_day') or 4)))
    ag['blocked'] = [x for x in (ag.get('blocked') or []) if re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(x))][:200]
    pay = {**d['pay'], **(c['pay'] or {})}
    if pay.get('provider') not in ('manual', 'asaas', 'mercadopago'): raise HTTPException(422, 'Meio de pagamento inválido.')
    pay['creator_pct'] = max(0, min(100, int(pay.get('creator_pct') or 0))); pay['hold_min'] = max(5, min(120, int(pay.get('hold_min') or 15))); pay['pix_text'] = str(pay.get('pix_text') or '')[:600]; pay['descriptor'] = re.sub(r'[^A-Za-z0-9]', '', str(pay.get('descriptor') or 'CREATORALTA')).upper()[:13] or 'CREATORALTA'
    if c['room_link'] and not re.match(r'^https://', c['room_link']): raise HTTPException(422, 'O link da sala precisa começar com https://')
    row = {**c, 'creator_id': creator_id, 'items': items, 'agenda': ag, 'pay': pay, 'sells': {k: bool((c['sells'] or {}).get(k)) for k in KINDS},
           'templates': {'reminder': str((c['templates'] or {}).get('reminder') or '')[:60], 'lang': str((c['templates'] or {}).get('lang') or 'pt_BR')[:10]},
           'updated_at': iso(), 'updated_by': user['name']}
    await db.wa_config.update_one({'creator_id': creator_id}, {'$set': row}, upsert=True)
    await audit(user, 'WhatsApp: configuração salva', creator_id)
    return {'ok': True}

# ---------- rotas: conversas (gestor e chatter atribuído; painel e app) ----------
def _contact_out(c):
    c = dict(c); w = c.pop('wa_id', '') or ''
    c['phone_end'] = w[-4:]; c.pop('expires_at', None); return c

@router.get('/wa/contacts')
async def contacts(creator_id: str = '', status: str = 'todas', user=Depends(wa_user)):
    ids = [creator_id] if creator_id else None
    if creator_id: check(user, creator_id)
    q = {}
    if ids: q['creator_id'] = creator_id
    elif not is_staff(user): q['creator_id'] = {'$in': user.get('creator_ids') or []}
    q['sim'] = {'$ne': True}
    if status == 'humano': q.update({'human': True, 'blocked': None})
    elif status == 'pix': q['stage'] = 'aguardando_pix'
    elif status == 'bloqueados': q['blocked'] = {'$ne': None}
    elif status == 'clientes': q['buyer'] = True
    rows = await db.wa_contacts.find(q, {'_id': 0}).sort('last_in_at', -1).to_list(300)
    names = {c['id']: c['name'] for c in await db.creators.find({}, {'_id': 0, 'id': 1, 'name': 1}).to_list(500)}
    return [{**_contact_out(r), 'creator_name': names.get(r['creator_id'])} for r in rows]

async def _contact(cid, user):
    c = await db.wa_contacts.find_one({'id': cid}, {'_id': 0})
    if not c: raise HTTPException(404, 'Conversa não encontrada.')
    check(user, c['creator_id']); return c

@router.get('/wa/contacts/{cid}')
async def contact_detail(cid: str, user=Depends(wa_user)):
    c = await _contact(cid, user)
    msgs = await db.wa_messages.find({'contact_id': cid}, {'_id': 0, 'expires_at': 0, 'wa_msg_id': 0}).sort('at', -1).to_list(200)
    orders = await db.wa_orders.find({'contact_id': cid}, {'_id': 0, 'expires_at': 0}).sort('created_at', -1).to_list(50)
    cfg = await get_cfg(c['creator_id'])
    return {'contact': _contact_out(c), 'messages': list(reversed(msgs)), 'orders': orders, 'items': on_items(cfg), 'window_open': _in_window(c)}

@router.post('/wa/contacts/{cid}/take')
async def take(cid: str, user=Depends(wa_user)):
    c = await _contact(cid, user)
    await db.wa_contacts.update_one({'id': cid}, {'$set': {'human': True, 'human_by': user['name'], 'human_at': iso(), 'human_reason': c.get('human_reason') or 'assumida'}})
    return {'ok': True}
@router.post('/wa/contacts/{cid}/return')
async def give_back(cid: str, user=Depends(wa_user)):
    c = await _contact(cid, user)
    if not c.get('age_ok'): raise HTTPException(409, 'A idade ainda não foi confirmada: continue à mão ou bloqueie.')
    await db.wa_contacts.update_one({'id': cid}, {'$set': {'human': False, 'human_by': None, 'human_reason': None}})
    return {'ok': True}
class SendIn(Strict):
    text: str = Field(min_length=1, max_length=2000)
@router.post('/wa/contacts/{cid}/send')
async def send(cid: str, body: SendIn, user=Depends(wa_user)):
    c = await _contact(cid, user)
    if c.get('blocked'): raise HTTPException(409, 'Contato bloqueado.')
    if not c.get('human'): await db.wa_contacts.update_one({'id': cid}, {'$set': {'human': True, 'human_by': user['name'], 'human_at': iso()}})
    cfg = await get_cfg(c['creator_id'])
    r = await send_text(cfg, c, body.text, f"chatter:{user['name']}")
    if not r.get('ok'): raise HTTPException(502, 'O WhatsApp não aceitou a mensagem. Confira o número da criadora em WhatsApp.')
    return {'ok': True}
class BlockIn(Strict):
    reason: str = Field(default='bloqueado pela equipe', max_length=120)
@router.post('/wa/contacts/{cid}/block')
async def block_route(cid: str, body: BlockIn, user=Depends(wa_user)):
    c = await _contact(cid, user); await block(c, body.reason, user['name']); return {'ok': True}
@router.post('/wa/contacts/{cid}/unblock')
async def unblock(cid: str, user=Depends(manager)):
    c = await _contact(cid, user)
    if c.get('blocked') == 'menor de idade': raise HTTPException(409, 'Contato bloqueado por idade não é desbloqueado.')
    await db.wa_contacts.update_one({'id': cid}, {'$set': {'blocked': None, 'stage': 'conversando', 'human': True}}); return {'ok': True}
class AgeIn(Strict):
    ok: bool
@router.post('/wa/contacts/{cid}/age')
async def age(cid: str, body: AgeIn, user=Depends(wa_user)):
    c = await _contact(cid, user)
    if body.ok: await db.wa_contacts.update_one({'id': cid}, {'$set': {'age_ok': True, 'age_by': user['name'], 'age_at': iso(), 'stage': 'conversando'}})
    else: await block(c, 'menor de idade', user['name'])
    return {'ok': True}

class OfferIn(Strict):
    item_id: str = Field(max_length=24)
    slot_ts: Optional[int] = None
    custom: Optional[dict] = None
@router.post('/wa/contacts/{cid}/offer')
async def offer(cid: str, body: OfferIn, user=Depends(wa_user)):
    c = await _contact(cid, user)
    if not c.get('age_ok'): raise HTTPException(409, 'Confirme a idade antes de vender.')
    cfg = await get_cfg(c['creator_id']); it = item_by_id(cfg, body.item_id)
    if not it: raise HTTPException(404, 'Item desligado ou inexistente.')
    slot = None
    if it['kind'] == 'call':
        if not body.slot_ts: raise HTTPException(422, 'Escolha o horário.')
        slot = datetime.fromtimestamp(body.slot_ts, BR)
        if slot not in await free_slots(cfg, int(it.get('minutes') or 10), limit=60): raise HTTPException(409, 'Horário indisponível.')
    custom = {k: str((body.custom or {}).get(k) or '')[:300] for k in ('para', 'ocasiao', 'recado')} if it['kind'] == 'custom' else None
    o = await create_order(cfg, c, it, slot=slot, custom=custom, by=f"chatter:{user['name']}")
    return {'ok': True, 'order_id': o['id']}

@router.get('/wa/slots/{creator_id}')
async def slots(creator_id: str, item_id: str = '', user=Depends(wa_user)):
    check(user, creator_id); cfg = await get_cfg(creator_id)
    it = item_by_id(cfg, item_id) or (on_items(cfg, 'call') or [{'minutes': 10}])[0]
    return [{'ts': int(s.timestamp()), 'label': slot_label(s)} for s in await free_slots(cfg, int(it.get('minutes') or 10), days=14, limit=40)]

# ---------- pedidos ----------
@router.get('/wa/orders')
async def orders(creator_id: str = '', status: str = 'abertos', user=Depends(wa_user)):
    q = {}
    if creator_id: check(user, creator_id); q['creator_id'] = creator_id
    elif not is_staff(user): q['creator_id'] = {'$in': user.get('creator_ids') or []}
    if status == 'abertos': q['$or'] = [{'status': 'aguardando_pix'}, {'status': 'pago', 'kind': 'call', 'call_status': 'agendada'}, {'status': 'pago', 'kind': {'$ne': 'call'}, 'delivered_at': None}]
    elif status != 'todos': q['status'] = status
    rows = await db.wa_orders.find(q, {'_id': 0, 'expires_at': 0}).sort('created_at', -1).to_list(300)
    names = {c['id']: c['name'] for c in await db.creators.find({}, {'_id': 0, 'id': 1, 'name': 1}).to_list(500)}
    return [{**r, 'creator_name': names.get(r['creator_id'])} for r in rows]

async def _order(oid, user):
    o = await db.wa_orders.find_one({'id': oid}, {'_id': 0})
    if not o: raise HTTPException(404, 'Pedido não encontrado.')
    check(user, o['creator_id']); return o

@router.post('/wa/orders/{oid}/paid')
async def paid(oid: str, user=Depends(wa_user)):
    await _order(oid, user); o = await mark_paid(oid, user['name'])
    await audit(user, 'WhatsApp: pedido marcado como pago', oid)
    return {'ok': True, 'room': o.get('room')}
class StatusIn(Strict):
    status: Literal['feita', 'faltou_criadora', 'faltou_cliente', 'cancelado', 'devolvido']
    note: str = Field(default='', max_length=200)
@router.post('/wa/orders/{oid}/status')
async def order_status(oid: str, body: StatusIn, user=Depends(wa_user)):
    o = await _order(oid, user)
    if body.status in ('feita', 'faltou_criadora', 'faltou_cliente'):
        if o['kind'] != 'call': raise HTTPException(422, 'Só vale para chamada.')
        await db.wa_orders.update_one({'id': oid}, {'$set': {'call_status': body.status, 'call_note': body.note, 'call_marked_by': user['name']}})
    else:
        await db.wa_orders.update_one({'id': oid}, {'$set': {'status': body.status, 'call_status': 'cancelada' if o['kind'] == 'call' else None, 'cancel_note': body.note, 'cancel_by': user['name'], 'cancel_at': iso()}})
    await audit(user, f'WhatsApp: pedido {body.status}', oid)
    return {'ok': True}
class RescheduleIn(Strict):
    slot_ts: int
@router.post('/wa/orders/{oid}/reschedule')
async def reschedule(oid: str, body: RescheduleIn, user=Depends(wa_user)):
    o = await _order(oid, user)
    if o['kind'] != 'call' or o['status'] != 'pago': raise HTTPException(409, 'Só chamada paga pode ser remarcada.')
    cfg = await get_cfg(o['creator_id']); slot = datetime.fromtimestamp(body.slot_ts, BR)
    if slot not in await free_slots(cfg, int(o.get('minutes') or 10), days=30, limit=200): raise HTTPException(409, 'Horário indisponível.')
    await db.wa_orders.update_one({'id': oid}, {'$set': {'slot_start': slot.isoformat(), 'call_status': 'agendada', 'reminders': []}})
    c = await db.wa_contacts.find_one({'id': o['contact_id']}, {'_id': 0})
    if c:
        try: await say(cfg, c, f"amor, precisei mudar nossa chamada para {slot_label(slot)}. tudo bem pra você?", f"chatter:{user['name']}")
        except HTTPException: pass
    return {'ok': True}
class CustomIn(Strict):
    para: str = Field(default='', max_length=300)
    ocasiao: str = Field(default='', max_length=300)
    recado: str = Field(default='', max_length=300)
@router.post('/wa/orders/{oid}/custom')
async def set_custom(oid: str, body: CustomIn, user=Depends(wa_user)):
    await _order(oid, user); await db.wa_orders.update_one({'id': oid}, {'$set': {'custom': body.model_dump()}}); return {'ok': True}

LIMITS = {'image/jpeg': ('image', 5), 'image/png': ('image', 5), 'video/mp4': ('video', 16), 'video/3gpp': ('video', 16)}
@router.post('/wa/orders/{oid}/deliver')
async def deliver(oid: str, file: UploadFile = File(...), user=Depends(wa_user)):
    o = await _order(oid, user)
    if o['status'] != 'pago': raise HTTPException(409, 'Só entrega pedido pago.')
    if o['kind'] == 'call': raise HTTPException(422, 'Chamada não tem entrega de arquivo.')
    kind = LIMITS.get(file.content_type or '')
    if not kind: raise HTTPException(422, 'Mande foto JPG/PNG ou vídeo MP4.')
    data = await file.read()
    if len(data) > kind[1] * 1024 * 1024: raise HTTPException(413, f'O WhatsApp aceita até {kind[1]} MB nesse tipo de arquivo.')
    cfg = await get_cfg(o['creator_id']); c = await db.wa_contacts.find_one({'id': o['contact_id']}, {'_id': 0})
    if not c or not _in_window(c): raise HTTPException(409, 'Passou de 24 h da última mensagem do contato: peça para ele mandar um oi e entregue depois.')
    if not wa_token(): raise HTTPException(409, 'O WhatsApp ainda não foi configurado no servidor.')
    async with httpx.AsyncClient(timeout=120) as cl:
        r = await cl.post(f"{GRAPH}/{cfg['phone_number_id']}/media", headers={'Authorization': f'Bearer {wa_token()}'},
                          data={'messaging_product': 'whatsapp', 'type': file.content_type}, files={'file': (file.filename or 'arquivo', data, file.content_type)})
    if r.status_code >= 300: raise HTTPException(502, 'O WhatsApp recusou o arquivo.')
    mid = r.json().get('id')
    wid = await _post(cfg, {'to': c['wa_id'], 'type': kind[0], kind[0]: {'id': mid}})
    if not wid: raise HTTPException(502, 'O WhatsApp não entregou o arquivo.')
    await _log_out(c, f'[{kind[0]} entregue: {o["item"]}]', f"chatter:{user['name']}", kind[0], wid)
    await db.wa_orders.update_one({'id': oid}, {'$set': {'delivered_at': iso(), 'delivered_by': user['name']}})
    return {'ok': True}

# ---------- relatório ----------
@router.get('/wa/report')
async def report(days: int = 7, creator_id: str = '', user=Depends(manager)):
    since = (now() - timedelta(days=max(1, min(90, days)))).isoformat()
    q = {'created_at': {'$gte': since}, 'sim': {'$ne': True}}
    if creator_id: q['creator_id'] = creator_id
    cs = await db.wa_contacts.find(q, {'_id': 0, 'id': 1, 'creator_id': 1, 'age_ok': 1, 'source': 1, 'blocked': 1}).to_list(50000)
    oq = {'created_at': {'$gte': since}, 'sim': {'$ne': True}, **({'creator_id': creator_id} if creator_id else {})}
    os_ = await db.wa_orders.find(oq, {'_id': 0}).to_list(50000)
    paid_ = [o for o in os_ if o['status'] == 'pago']
    chose = {o['contact_id'] for o in os_}
    names = {c['id']: c['name'] for c in await db.creators.find({}, {'_id': 0, 'id': 1, 'name': 1}).to_list(500)}
    per = {}
    for c in cs: per.setdefault(c['creator_id'], {'contacts': 0, 'paid': 0, 'cents': 0, 'calls_done': 0, 'no_show': 0})['contacts'] += 1
    for o in paid_:
        p = per.setdefault(o['creator_id'], {'contacts': 0, 'paid': 0, 'cents': 0, 'calls_done': 0, 'no_show': 0}); p['paid'] += 1; p['cents'] += o['cents']
        if o.get('call_status') == 'feita': p['calls_done'] += 1
        if o.get('call_status') == 'faltou_criadora': p['no_show'] += 1
    by_kind = {}
    for o in paid_: k = by_kind.setdefault(o['kind'], {'count': 0, 'cents': 0}); k['count'] += 1; k['cents'] += o['cents']
    src = {s: sum(1 for c in cs if c.get('source') == s) for s in ('instagram', 'tiktok')}
    return {'funnel': {'contacts': len(cs), 'age_ok': sum(1 for c in cs if c.get('age_ok')), 'chose': len(chose), 'paid': len({o['contact_id'] for o in paid_}),
                       'calls_done': sum(1 for o in paid_ if o.get('call_status') == 'feita')},
            'cents': sum(o['cents'] for o in paid_), 'creator_cents': sum(o['cents'] * (o.get('creator_pct') or 0) // 100 for o in paid_),
            'sources': src, 'blocked_minor': sum(1 for c in cs if c.get('blocked') == 'menor de idade'), 'by_kind': by_kind, 'kinds': KINDS,
            'per_creator': [{'creator_id': k, 'name': names.get(k), **v} for k, v in per.items()]}


# ---------- simulador (lote 165): o gestor conversa como se fosse o fã, com as regras de verdade; nada vai para o WhatsApp ----------
class SimIn(Strict):
    text: str = Field(default='', max_length=1000)
    button: Optional[str] = Field(default=None, max_length=80)
    title: str = Field(default='', max_length=40)

async def _sim_contact(creator_id, user, create=True):
    wa = f"sim{user['id'][:12]}"
    c = await db.wa_contacts.find_one({'creator_id': creator_id, 'wa_id': wa}, {'_id': 0})
    if not c and create:
        c = {'id': uid(), 'creator_id': creator_id, 'wa_id': wa, 'name': f"Simulação ({user['name'].split(' ')[0]})", 'source': None, 'stage': 'novo', 'sim': True,
             'age_ok': False, 'human': False, 'blocked': None, 'created_at': iso(), 'spent_cents': 0, 'expires_at': now() + timedelta(days=30)}
        await db.wa_contacts.insert_one(dict(c))
    return c

async def _sim_view(c):
    if not c: return {'contact': None, 'messages': [], 'orders': []}
    msgs = await db.wa_messages.find({'contact_id': c['id']}, {'_id': 0, 'expires_at': 0, 'wa_msg_id': 0}).sort('at', 1).to_list(400)
    orders = await db.wa_orders.find({'contact_id': c['id']}, {'_id': 0, 'expires_at': 0}).sort('created_at', -1).to_list(20)
    return {'contact': _contact_out(c), 'messages': msgs, 'orders': orders, 'ai_raw': c.get('ai_raw') or []}

@router.get('/wa/sim/{creator_id}')
async def sim_read(creator_id: str, user=Depends(manager)):
    return await _sim_view(await _sim_contact(creator_id, user, create=False))

@router.post('/wa/sim/{creator_id}')
async def sim_send(creator_id: str, body: SimIn, user=Depends(manager)):
    if not body.text.strip() and not body.button: raise HTTPException(422, 'Escreva uma mensagem.')
    cfg = await get_cfg(creator_id)
    c = await _sim_contact(creator_id, user)
    lock = _locks.setdefault(f"{creator_id}:{c['wa_id']}", asyncio.Lock())
    async with lock:
        t = iso(); text = body.title if body.button else body.text.strip()
        await db.wa_contacts.update_one({'id': c['id']}, {'$set': {'last_in_at': t, 'last_text': text[:160]}})
        await db.wa_messages.insert_one({'id': uid(), 'contact_id': c['id'], 'creator_id': creator_id, 'dir': 'in', 'by': 'fã', 'text': text[:4000], 'kind': 'interactive' if body.button else 'text',
                                         'button': body.button, 'at': t, 'expires_at': now() + timedelta(days=30)})
        c = await db.wa_contacts.find_one({'id': c['id']}, {'_id': 0})
        try: await handle_in(cfg, c, text, body.button)
        except HTTPException as e: await _log_out(c, f'[erro: {e.detail}]', 'sistema')
    return await _sim_view(await db.wa_contacts.find_one({'id': c['id']}, {'_id': 0}))

@router.post('/wa/sim/{creator_id}/reset')
async def sim_reset(creator_id: str, user=Depends(manager)):
    c = await _sim_contact(creator_id, user, create=False)
    if c:
        await db.wa_messages.delete_many({'contact_id': c['id']}); await db.wa_orders.delete_many({'contact_id': c['id']}); await db.wa_contacts.delete_one({'id': c['id']})
    return {'ok': True}

@router.post('/wa/sim/{creator_id}/paid')
async def sim_paid(creator_id: str, user=Depends(manager)):
    c = await _sim_contact(creator_id, user, create=False)
    o = await db.wa_orders.find_one({'contact_id': (c or {}).get('id'), 'status': 'aguardando_pix', 'sim': True}, {'_id': 0}, sort=[('created_at', -1)]) if c else None
    if not o: raise HTTPException(404, 'Não há pedido esperando pagamento nesta simulação.')
    await mark_paid(o['id'], 'Simulação')
    return await _sim_view(await db.wa_contacts.find_one({'id': c['id']}, {'_id': 0}))

@router.post('/wa/sim/{creator_id}/probe')
async def sim_probe(creator_id: str, user=Depends(manager)):
    """Diagnóstico: roda as variantes da IA sobre a conversa atual do simulador e devolve a resposta crua de cada uma (não envia nada)."""
    c = await _sim_contact(creator_id, user, create=False)
    if not c: raise HTTPException(404, 'Comece uma conversa no simulador primeiro.')
    cfg = await get_cfg(creator_id)
    hist = await db.wa_messages.find({'contact_id': c['id']}, {'_id': 0, 'dir': 1, 'text': 1}).sort('at', -1).to_list(14); hist.reverse()
    return [await ai_reply(cfg, {**c, 'sim': False}, hist, variant=v, probe=True) for v in (0, 1, 2)]
