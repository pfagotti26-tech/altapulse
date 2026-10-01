// Leitor de vendas do FatalFans: transforma as linhas de "Minhas vendas → Transações" em vendas para o
// painel (platform 'fatalfans', sale_source 'extrato'). Comprador vira hash (HMAC local); o nome só vai
// com "guardar nome do assinante" ligado, como na Privacy.
'use strict';
const crypto = require('crypto');

const MONTHS = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// "Set 30, 23:02" (sem ano) ou "30/09/2026 23:02"; no fuso do computador
function parseWhen(when, now = new Date()) {
  const s = norm(when);
  let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\D+(\d{1,2}):(\d{2})/);
  if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]); return isNaN(d) ? null : d; }
  m = s.match(/([a-z]{3})[a-z.]*\s+(\d{1,2}),?\s+(\d{1,2}):(\d{2})/);
  if (!m || !(m[1] in MONTHS)) return null;
  let d = new Date(now.getFullYear(), MONTHS[m[1]], +m[2], +m[3], +m[4]);
  if (d > new Date(now.getTime() + 24 * 3600e3)) d = new Date(now.getFullYear() - 1, MONTHS[m[1]], +m[2], +m[3], +m[4]); // dezembro lido em janeiro
  return isNaN(d) ? null : d;
}
const cents = (s) => { const m = (s || '').replace(/\s/g, ' ').match(/(-?)R\$\s*([\d.]+,\d{2}|[\d.]+)/); if (!m) return null; const v = parseFloat(m[2].replace(/\./g, '').replace(',', '.')); return isNaN(v) ? null : Math.round(v * 100); };
function product(t) {
  const s = norm(t);
  if (/renova/.test(s)) return 'renewal';
  if (/assinatura/.test(s) && /recorr|[2-9]\s*º|[2-9]o pagamento/.test(s)) return 'renewal';
  if (/assinatura/.test(s)) return 'subscription';
  if (/chat|mensagem|midia/.test(s)) return 'chat';
  if (/presente|mimo|gorjeta|tip/.test(s)) return 'tip';
  if (/post/.test(s)) return 'post';
  return 'unknown';
}
function status(t) {
  const s = norm(t);
  if (!s) return 'confirmed'; // a lista de transações só mostra vendas pagas
  if (/estorn|reembols|chargeback|devolv/.test(s)) return 'refunded';
  if (/cancel|recus|negad|falh/.test(s)) return 'cancelled';
  if (/pend|aguard|process|analise/.test(s)) return 'pending';
  if (/aprovad|pag[oa]|conclu|confirm/.test(s)) return 'confirmed';
  return 'confirmed';
}

class SalesReader {
  constructor(creatorId, secret, store, options = {}, platform = 'fatalfans') {
    this.platform = platform; this.creatorId = creatorId; this.secret = secret; this.options = options;
    this.s = store || { sent: {}, backfilled: false };
  }
  ref(...parts) { return crypto.createHmac('sha256', this.secret).update([this.creatorId, this.platform, ...parts].join('|')).digest('hex'); }
  fan(name) { return name ? { fan_ref: this.ref('fan', name), ...(this.options.fanNames ? { fan_name: name.slice(0, 80) } : {}) } : {}; }
  known(r, now = new Date()) { const at = parseWhen(r.when, now); return at ? !!this.s.sent[this.ref('sale', at.toISOString(), r.name, r.gross, r.product)] : false; }
  process(rows, now = new Date()) {
    const events = []; let today = 0, todayCents = 0;
    this.s.pendingSig = {};
    for (const r of rows) {
      const at = parseWhen(r.when, now); const gross = cents(r.gross); const net = cents(r.net);
      if (!at || gross == null || at > new Date(now.getTime() + 2 * 60e3)) continue;
      const st = status(r.status); const origin = product(r.product);
      if (at.toDateString() === now.toDateString() && st === 'confirmed') { today += 1; todayCents += gross; }
      const ref = this.ref('sale', at.toISOString(), r.name, r.gross, r.product);
      const sig = `${st}|${gross}|${net}`;
      if (this.s.sent[ref] === sig) continue;
      // "Seu ganho"/"Valor líquido" é a parte da criadora, como a comissão do extrato da Privacy
      events.push({ creator_id: this.creatorId, event_ref: ref, kind: 'sale', platform: this.platform, amount_cents: gross,
        commission_cents: net != null && net <= gross ? net : null, sale_origin: origin, sale_status: st, sale_source: 'extrato',
        payment_method: (r.payment || '').slice(0, 30) || null, confirmed_at: at.toISOString(), sequence_complete: true, ...this.fan(r.name) });
      this.s.pendingSig[ref] = sig;
    }
    return { events, summary: { rows: rows.length, today, todayCents, readAt: now.toISOString() } };
  }
  markSent(refs) {
    for (const ref of refs) if (this.s.pendingSig && this.s.pendingSig[ref]) this.s.sent[ref] = this.s.pendingSig[ref];
    this.s.pendingSig = {}; this.s.lastReadAt = new Date().toISOString();
    const keys = Object.keys(this.s.sent); if (keys.length > 6000) for (const k of keys.slice(0, keys.length - 5000)) delete this.s.sent[k];
  }
}

class FatalFansReader extends SalesReader { constructor(c, s, st, o) { super(c, s, st, o, 'fatalfans'); } }
module.exports = { SalesReader, FatalFansReader, parseWhen, cents, product, status };
