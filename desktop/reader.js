// Leitor (fase 2): transforma a estrutura devolvida por reader-page.js em eventos do painel
// (espera, resposta, venda) e num resumo de fila para a lateral. Regras do PRD:
// - espera = da primeira mensagem do fã depois da nossa última resposta até a próxima resposta;
//   mensagens seguidas do fã não reiniciam o relógio; sem data conhecida, não conta.
// - venda = aumento do total gasto do fã na lista de conversas (cobre PPV, mimo e assinatura
//   vista pelo chat); a etiqueta 'ainda não pago' da mensagem não é usada para não contar em dobro; o instante é o da observação quando a leitura
//   estava contínua (< 2 min entre leituras); senão fica "desconhecida" e sem atribuição.
// - o assinante vai sempre como hash (HMAC com segredo local) e, só com a opção 'guardar nome do
//   assinante' ligada no painel, também com o nome de exibição; nada de texto de mensagem.
'use strict';
const crypto = require('crypto');

const MONTHS = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
const CONTINUOUS_MS = 2 * 60 * 1000;

function parseDateLabel(label, now) {
  const l = label.toLowerCase().replace(/\./g, '').trim();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (l === 'hoje') return today;
  if (l === 'ontem') return new Date(today.getTime() - 864e5);
  let m = l.match(/^([a-z]{3})\s+(\d{1,2})$/) || l.match(/^(\d{1,2})\s+de\s+([a-z]{3})/);
  if (m) {
    const mon = MONTHS[isNaN(m[1]) ? m[1] : m[2]]; const day = parseInt(isNaN(m[1]) ? m[2] : m[1], 10);
    if (mon === undefined) return null;
    let d = new Date(now.getFullYear(), mon, day);
    if (d > today) d = new Date(now.getFullYear() - 1, mon, day);
    return d;
  }
  m = l.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}
function at(dateLabel, hhmm, now) {
  const d = parseDateLabel(dateLabel, now); if (!d) return null;
  const [h, mi] = hhmm.split(':').map(Number);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi);
  return t > new Date(now.getTime() + 2 * 60e3) ? null : t;
}
// "quando" da lista: HH:MM = hoje; "Ontem"; "set 25"
// só o dia é conhecido: devolve o fim daquele dia (limite inferior da espera, nunca exagera)
function listAt(when, now) {
  if (/^\d{1,2}:\d{2}$/.test(when)) return at('hoje', when, now);
  const d = parseDateLabel(when, now); return d ? new Date(Math.min(d.getTime() + 864e5, now.getTime())) : null;
}
function isoLocal(d) { return d.toISOString(); }

class CreatorReader {
  constructor(creatorId, secret, store, options = {}) {
    this.creatorId = creatorId; this.secret = secret; this.options = options; // { fanNames: bool }
    this.s = store || { rooms: {}, sent: {}, lastObservedAt: null };
  }
  ref(...parts) { return crypto.createHmac('sha256', this.secret).update([this.creatorId, ...parts].join('|')).digest('hex'); }
  roomKey(name) { return this.ref('room', name); }
  // identificação do assinante: hash sempre; nome só com a opção da agência ligada
  fan(name) { return name ? { fan_ref: this.roomKey(name), ...(this.options.fanNames ? { fan_name: name.slice(0, 80) } : {}) } : {}; }

  // devolve { events: [], summary: {} } e atualiza o estado interno
  process(data, now = new Date()) {
    const events = [];
    const observedAt = now.getTime();
    const continuous = this.s.lastObservedAt && (observedAt - this.s.lastObservedAt) < CONTINUOUS_MS;
    this.s.lastObservedAt = observedAt;

    // ---- fila (só local) + vendas por total gasto na lista ----
    let waiting = 0, oldest = null;
    for (const r of data.rooms || []) {
      const key = this.roomKey(r.name);
      if (!r.ours) {
        waiting += 1;
        const t = listAt(r.when, now);
        if (t && (!oldest || t < oldest)) oldest = t;
      }
      if (r.spent && !r.spent.approx) {
        const prev = this.s.rooms[key];
        if (prev && !prev.approx && r.spent.cents > prev.cents) {
          const delta = r.spent.cents - prev.cents;
          const known = continuous && prev.at && (observedAt - prev.at) < CONTINUOUS_MS;
          events.push({ creator_id: this.creatorId, event_ref: this.ref('sale', key, String(r.spent.cents)), kind: 'sale',
            amount_cents: delta, sale_origin: 'chat', sale_status: known ? 'confirmed' : 'unknown',
            confirmed_at: known ? isoLocal(now) : null, ...this.fan(r.name) });
        }
        this.s.rooms[key] = { cents: r.spent.cents, approx: false, at: observedAt };
      } else if (r.spent) this.s.rooms[key] = { cents: r.spent.cents, approx: true, at: observedAt };
    }

    // ---- conversa aberta: esperas e respostas ----
    const open = data.open;
    if (open && !open.skeleton && open.msgs.length) {
      let start = null;
      for (const m of open.msgs) {
        const t = at(m.date, m.time, now); if (!t) continue;
        if (!m.ours) { if (!start) start = t; }
        else if (start) {
          const ref = this.ref('wait', open.cid, isoLocal(start));
          if (this.s.sent[ref] !== 'response') {
            events.push({ creator_id: this.creatorId, event_ref: ref, kind: 'response', started_at: isoLocal(start), responded_at: isoLocal(t < start ? start : t), sequence_complete: true, ...this.fan(open.name) });
            this.s.sent[ref] = 'response';
          }
          start = null;
        }
      }
      // ofertas de mídia paga enviadas por nós (bloco C): uma por mensagem; quando aparece como paga, atualiza
      for (const m of open.msgs) {
        if (!m.ours || !m.offer) continue;
        const t = at(m.date, m.time, now); if (!t) continue;
        const ref = this.ref('offer', open.cid, isoLocal(t), String(m.offer.cents));
        const status = m.offer.paid ? 'paid' : 'sent';
        if (this.s.sent[ref] === 'offer:' + status || (this.s.sent[ref] === 'offer:paid')) continue;
        events.push({ creator_id: this.creatorId, event_ref: ref, kind: 'offer', offered_at: isoLocal(t), amount_cents: m.offer.cents, offer_status: status, sequence_complete: true, ...this.fan(open.name) });
        this.s.sent[ref] = 'offer:' + status;
      }
      if (start) {
        const ref = this.ref('wait', open.cid, isoLocal(start));
        if (!this.s.sent[ref]) {
          events.push({ creator_id: this.creatorId, event_ref: ref, kind: 'pending', started_at: isoLocal(start), sequence_complete: true, ...this.fan(open.name) });
          this.s.sent[ref] = 'pending';
        }
      }
    }
    // limpeza: refs com mais de 30 dias
    const keys = Object.keys(this.s.sent); if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 4000)) delete this.s.sent[k];

    return { events, summary: { waiting, oldestWaitMin: oldest ? Math.max(0, Math.round((now - oldest) / 60000)) : null, page: data.page, readAt: isoLocal(now) } };
  }
}

module.exports = { CreatorReader, parseDateLabel };
