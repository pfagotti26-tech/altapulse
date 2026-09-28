"""Leitura conservadora de DOM visível. Nenhum seletor Privacy é presumido.

Somente atributos/timestamps dos campos locais explicitamente validados são lidos.
Não usa request, route, CDP, cookies, storage_state ou interceptação de rede.
"""
import hashlib
import hmac
import json
import re
from datetime import datetime
from pathlib import Path

EMPTY_ADAPTER = {
    'validated': False, 'validated_on': '', 'validation_scope': '',
    'chat': {'container': '', 'reference_attribute': '', 'rows': '', 'time_selector': '',
             'time_attribute': '', 'direction_attribute': '', 'incoming_value': '',
             'outgoing_value': '', 'sequence_attribute': ''},
    'sales': {'rows': '', 'reference_attribute': '', 'time_selector': '', 'time_attribute': '',
              'amount_selector': '', 'status_selector': '', 'origin_selector': '',
              'status_values': {}, 'origin_values': {}}
}

def load_adapter(path):
    if not path.exists(): return None
    config = json.loads(path.read_text(encoding='utf-8'))
    if not config.get('validated') or not config.get('validated_on') or not config.get('validation_scope'):
        return None
    validated = datetime.fromisoformat(config['validated_on']).date()
    if (datetime.now().date() - validated).days > 30: return None
    return config

def timestamp(value):
    if not value: return None
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result.isoformat() if result.tzinfo is not None else None
    except (ValueError, TypeError): return None

def reference(secret, *parts):
    return hmac.new(secret, '|'.join(str(x) for x in parts).encode(), hashlib.sha256).hexdigest()

# Atributos de referência só são aceitos em contentores visíveis. O retorno não contém
# mensagens, HTML, URLs, nomes, mídia ou identificadores brutos de assinantes.
DOM_READ = r"""({chat, sales}) => {
  const visible = el => {
    if (!el || el.closest('input,textarea,[contenteditable="true"],video,audio,img')) return false;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return el.checkVisibility ? el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) && r.width>0 && r.height>0 && r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth : s.display!=='none' && s.visibility!=='hidden' && s.opacity!=='0' && r.width>0 && r.height>0 && r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth;
  };
  const allowedAttr = name => /^(data-[a-z0-9_-]+|datetime|id)$/.test(name || '') && !/(token|cookie|auth|password|secret|session)/i.test(name);
  if (document.hidden) return {chat:[],sales:[],reference:null};
  let messages=[], transactions=[], ref=null;
  if (chat && chat.container && chat.rows && [chat.reference_attribute,chat.time_attribute,chat.direction_attribute,chat.sequence_attribute].every(allowedAttr)) {
    const container=document.querySelector(chat.container);
    if (visible(container)) {
      ref=container.getAttribute(chat.reference_attribute);
      for(const row of container.querySelectorAll(chat.rows)) {
        const time=row.querySelector(chat.time_selector);
        if(visible(row)&&visible(time)) messages.push({at:time.getAttribute(chat.time_attribute),direction:row.getAttribute(chat.direction_attribute),sequence:row.getAttribute(chat.sequence_attribute)});
      }
    }
  }
  if(sales && sales.rows && allowedAttr(sales.reference_attribute) && allowedAttr(sales.time_attribute)) {
    for(const row of document.querySelectorAll(sales.rows)) {
      const time=row.querySelector(sales.time_selector), amount=row.querySelector(sales.amount_selector), status=row.querySelector(sales.status_selector), origin=row.querySelector(sales.origin_selector);
      if(visible(row)&&visible(amount)&&visible(status)&&visible(origin)) transactions.push({ref:row.getAttribute(sales.reference_attribute),at:visible(time)?time.getAttribute(sales.time_attribute):null,amount:amount.innerText.slice(0,30),status:status.innerText.slice(0,60).trim(),origin:origin.innerText.slice(0,60).trim()});
    }
  }
  return {chat:messages.slice(0,200),sales:transactions.slice(0,200),reference:ref};
}"""

async def observe(page, config, secret, creator_id):
    raw = await page.evaluate(DOM_READ, {'chat': config.get('chat'), 'sales': config.get('sales')})
    events = []
    chat = config.get('chat') or {}
    rows = raw['chat']
    # A sequência precisa de índices NUMÉRICOS consecutivos reais e horários com fuso.
    # Se o DOM não os expuser, a métrica fica indisponível. Nunca inferir completude.
    if raw.get('reference') and rows and all(timestamp(r['at']) and str(r['sequence']).isdigit() for r in rows):
        rows.sort(key=lambda r: int(r['sequence']))
        valid_order = all(int(b['sequence']) == int(a['sequence']) + 1 and datetime.fromisoformat(timestamp(b['at'])) >= datetime.fromisoformat(timestamp(a['at'])) for a, b in zip(rows, rows[1:]))
        if valid_order:
            baseline = False
            pending = None
            for row in rows:
                direction = row['direction']
                if direction == chat['outgoing_value']:
                    if pending:
                        events.append({'creator_id': creator_id, 'kind': 'response', 'event_ref': reference(secret, creator_id, raw['reference'], pending['sequence']), 'started_at': timestamp(pending['at']), 'responded_at': timestamp(row['at']), 'sequence_complete': True})
                    pending = None
                    baseline = True
                elif direction == chat['incoming_value']:
                    if baseline and pending is None: pending = row
                else:
                    baseline = False
                    pending = None
            if pending and baseline:
                events.append({'creator_id': creator_id, 'kind': 'pending', 'event_ref': reference(secret, creator_id, raw['reference'], pending['sequence']), 'started_at': timestamp(pending['at']), 'sequence_complete': True})
    sales = config.get('sales') or {}
    for row in raw['sales']:
        # Somente moeda pt-BR sem valores laterais/genéricos, validada no mapeamento.
        amount = row['amount'].replace('R$', '').replace('\u00a0', '').strip()
        if not row['ref'] or not re.fullmatch(r'\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}', amount): continue
        cents = int(amount.replace('.', '').replace(',', ''))
        status = sales.get('status_values', {}).get(row['status'], 'unknown')
        origin = sales.get('origin_values', {}).get(row['origin'], 'unknown')
        if status not in ['confirmed', 'refunded', 'cancelled', 'unknown'] or origin not in ['chat', 'subscription', 'renewal', 'tip', 'unknown']: continue
        events.append({'creator_id': creator_id, 'kind': 'sale', 'event_ref': reference(secret, creator_id, 'sale', row['ref']), 'amount_cents': cents, 'sale_status': status, 'sale_origin': origin, 'confirmed_at': timestamp(row['at'])})
    # Referências brutas só existiram temporariamente em RAM; não são logadas/salvas.
    return events