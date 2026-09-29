// Script executado DENTRO da página da Privacy (só leitura do DOM visível).
// Não clica, não rola, não lê cookies. Devolve só estrutura: quem mandou a última mensagem,
// horários, totais gastos e etiquetas de conteúdo pago. O nome do fã sai daqui apenas para
// virar um hash no processo principal; nunca é gravado nem enviado.
// Seletores validados na calibração de 29/09/2026 (biblioteca vue-advanced-chat).
module.exports = String.raw`(() => {
  const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
  // o chat da Privacy fica dentro de shadow roots (<privacy-web-chat>): a busca precisa atravessá-los
  const roots = []; (function walk(root, depth) {
    if (depth > 6) return; roots.push(root);
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
  })(document, 0);
  const qs = (sel) => { for (const r of roots) { const e = r.querySelector(sel); if (e) return e; } return null; };
  const qsa = (sel) => roots.flatMap((r) => [...r.querySelectorAll(sel)]);
  const money = (s) => {
    const m = s.match(/R\$\s*([\d.,]+)\s*([KM])?/i);
    if (!m) return null;
    let n = m[1];
    if (m[2]) return { cents: Math.round(parseFloat(n.replace(',', '.')) * (m[2].toUpperCase() === 'K' ? 1e3 : 1e6) * 100), approx: true };
    if (n.includes(',') && n.includes('.')) n = n.replace(/\./g, '').replace(',', '.');
    else if (n.includes(',')) n = n.replace(',', '.');
    const v = parseFloat(n);
    return isNaN(v) ? null : { cents: Math.round(v * 100), approx: false };
  };
  const rooms = qsa('.vac-room-list .vac-room-item').map((r) => ({
    name: txt(r.querySelector('.name')),
    spent: money(txt(r.querySelector('.spent, .never-spent'))),
    ours: !!r.querySelector('.message-last .vac-icon-check'),
    unread: parseInt(txt(r.querySelector('.cn-unread-number')), 10) || 0,
    when: txt(r.querySelector('.vac-text-date')),
  })).filter((r) => r.name);
  const cid = new URLSearchParams(location.search).get('cid');
  let open = null;
  const cont = qs('.vac-messages-container');
  if (cont && cid) {
    let label = null; const msgs = [];
    for (const el of cont.querySelectorAll('.vac-card-date, .vac-message-wrapper-msg')) {
      if (el.classList.contains('vac-card-date')) { label = txt(el); continue; }
      if (!label) continue; // sem separador de data acima, a data é desconhecida: ignora
      const m = txt(el.querySelector('.vac-text-timestamp')).match(/(\d{1,2}):(\d{2})/);
      if (!m) continue;
      const np = el.querySelector('.vac-text-not-paid');
      msgs.push({ ours: el.classList.contains('vac-offset-current'), date: label, time: m[1].padStart(2, '0') + ':' + m[2], notPaid: np ? money(txt(np)) : null });
    }
    open = { cid, msgs, skeleton: !!qs('.skeleton-messages') };
  }
  return { page: location.pathname.startsWith('/chat') ? 'chat' : 'other', rooms, open, loading: !!qs('.skeleton-messages'), roots: roots.length };
})()`;
