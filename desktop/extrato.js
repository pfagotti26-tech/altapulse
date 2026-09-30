// Leitor do Extrato (bloco A): transforma as linhas lidas por extrato-page.js em eventos de venda
// exatos para o painel. Cada linha do extrato da Privacy já traz o instante da transação, o produto,
// a forma de pagamento e a situação; por isso a venda vai com confirmed_at exato e sem heurística.
// O assinante vai como hash (HMAC local) e, só com "guardar nome do assinante" ligado, com o nome.
'use strict';
const crypto = require('crypto');

const PRODUCTS = { chat: 'chat', assinatura: 'subscription', postagem: 'post', mimo: 'tip', renovacao: 'renewal', 'renovação': 'renewal' };

function parseWhen(when) {
  // "29/09/2026, 12:29" no fuso do computador (o mesmo que a Privacy mostra para a conta)
  const m = (when || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\D+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
  return isNaN(d) ? null : d;
}

class ExtratoReader {
  constructor(creatorId, secret, store, options = {}) {
    this.creatorId = creatorId; this.secret = secret; this.options = options; // { fanNames }
    this.s = store || { sent: {}, backfilled: false, lastReadAt: null };
  }
  ref(...parts) { return crypto.createHmac('sha256', this.secret).update([this.creatorId, ...parts].join('|')).digest('hex'); }
  fan(name) { return name ? { fan_ref: this.ref('room', name), ...(this.options.fanNames ? { fan_name: name.slice(0, 80) } : {}) } : {}; }

  // rows: [{when,name,gross,commission,payment,product,status}] → { events, summary }
  process(rows, now = new Date()) {
    const events = []; let today = 0, todayCents = 0, unknownStatus = 0;
    const dayKey = (d) => d.toDateString();
    for (const r of rows) {
      const at = parseWhen(r.when); if (!at || at > new Date(now.getTime() + 2 * 60e3)) continue;
      const product = PRODUCTS[(r.product || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')] || 'unknown';
      const status = r.status === 'confirmed' || r.status === 'pending' || r.status === 'refunded' ? r.status : 'unknown';
      if (status === 'unknown') unknownStatus += 1;
      if (dayKey(at) === dayKey(now) && status !== 'refunded') { today += 1; todayCents += r.gross; }
      // a referência não inclui a situação: quando "a receber" vira "concluído", o mesmo evento é atualizado
      const ref = this.ref('extrato', at.toISOString(), r.name, String(r.gross), product);
      const sig = `${status}|${r.gross}|${r.commission}`;
      if (this.s.sent[ref] === sig) continue;
      events.push({ creator_id: this.creatorId, event_ref: ref, kind: 'sale', amount_cents: r.gross, commission_cents: r.commission,
        sale_origin: product, sale_status: status, sale_source: 'extrato', payment_method: (r.payment || '').slice(0, 30) || null,
        confirmed_at: at.toISOString(), sequence_complete: true, ...this.fan(r.name) });
      this.s.pendingSig = this.s.pendingSig || {}; this.s.pendingSig[ref] = sig;
    }
    return { events, summary: { rows: rows.length, today, todayCents, unknownStatus, readAt: now.toISOString() } };
  }
  // chamado depois do envio aceito: só então marca como enviado (se a rede falhar, tenta na próxima leitura)
  markSent(refs) { for (const ref of refs) if (this.s.pendingSig && this.s.pendingSig[ref]) this.s.sent[ref] = this.s.pendingSig[ref]; this.s.pendingSig = {}; this.s.lastReadAt = new Date().toISOString();
    const keys = Object.keys(this.s.sent); if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 4000)) delete this.s.sent[k]; }
}

module.exports = { ExtratoReader, parseWhen };
