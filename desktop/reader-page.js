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
  // conversa aberta: o id vem do endereço (?cid= ou /chat/<id>); no layout estreito da Privacy ele pode
  // não aparecer, então cai no nome do cabeçalho (estável para a mesma conversa)
  const headerName = txt(qs('.vac-room-header .vac-list-name .vac-text-ellipsis') || qs('.vac-room-header .vac-list-name'));
  const cid = new URLSearchParams(location.search).get('cid') || (location.pathname.match(/\/chat\/([^/?#]+)/) || [])[1] || (headerName ? 'n:' + headerName : null);
  let open = null;
  const cont = qs('.vac-messages-container');
  if (cont && cid) {
    let label = null, sawLabel = false; const msgs = [], undated = [];
    for (const el of cont.querySelectorAll('.vac-card-date, .vac-message-wrapper-msg')) {
      if (el.classList.contains('vac-card-date')) { label = txt(el); sawLabel = true; continue; }
      const m = txt(el.querySelector('.vac-text-timestamp')).match(/(\d{1,2}):(\d{2})/);
      if (!m) continue;
      const np = el.querySelector('.vac-text-not-paid');
      // oferta de mídia paga (bloco C): etiqueta "R$ X ainda não pago" (enviada) ou "R$ X pago" (paga)
      const paidEl = [...el.querySelectorAll('.vac-text-timestamp span')].find((x) => /R\$/.test(txt(x)) && /pago|paid/i.test(txt(x)) && !/n[aã]o pago|not-paid/i.test(txt(x) + ' ' + x.className));
      const offer = np ? { cents: (money(txt(np)) || {}).cents, paid: false } : paidEl ? { cents: (money(txt(paidEl)) || {}).cents, paid: true } : null;
      (label ? msgs : undated).push({ ours: el.classList.contains('vac-offset-current'), date: label, time: m[1].padStart(2, '0') + ':' + m[2], notPaid: np ? money(txt(np)) : null, offer: offer && offer.cents ? offer : null });
    }
    // aviso da Privacy no rodapé da conversa quando o fã não tem assinatura ativa
    const rx = /n[aã\u0303]+o poder[aá\u0301]+ responder|n[aã\u0303]+o [eé\u0301]+ seu assinante/i;
    const notSub = roots.some((r) => rx.test(String(((r === document ? document.body : r) || {}).textContent || '').normalize('NFC').replace(/\s+/g, ' ')));
    const sk = qs('.skeleton-messages');
    // sem nenhum separador de data carregado: todas as mensagens são do mesmo dia da última mensagem,
    // que a lista de conversas informa (HH:MM = hoje, "Ontem", "set 25")
    if (!msgs.length && undated.length && !sawLabel) {
      const room = rooms.find((x) => x.name === headerName);
      const w = room ? room.when : '';
      const day = /^\d{1,2}:\d{2}$/.test(w) ? 'Hoje' : w;
      if (day) for (const m of undated) msgs.push({ ...m, date: day });
    }
    open = { cid, msgs, name: headerName, skeleton: !!(sk && sk.getClientRects().length), notSub };
  }
  return { page: location.pathname.startsWith('/chat') ? 'chat' : 'other', rooms, open, loading: !!qs('.skeleton-messages'), roots: roots.length };
})()`;
