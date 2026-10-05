// FatalFans → Chat (https://fatalfans.com/chat), conversa aberta. Só para o Cartão do fã: nome do fã no cabeçalho
// e, de cada mensagem, se é nossa, o dia (separador) e a hora. Texto das mensagens não é lido.
// Estrutura validada na calibração de 02/10/2026 (Nuxt UI): cabeçalho h2 ao lado do botão i-lucide:square-pen;
// mensagens [data-message-id]; hora em .pt-1.text-dimmed (justify-end = nossa); dia em .mb-4.flex.justify-center.
module.exports = String.raw`(() => {
  const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
  if (!/\/chat/.test(location.pathname)) return { page: 'other' };
  const pen = document.querySelector('.iconify.i-lucide\\:square-pen');
  const h2 = pen && pen.closest('button') && pen.closest('button').parentElement.querySelector('h2');
  const name = txt(h2);
  const msgs = []; let day = '';
  for (const el of document.querySelectorAll('div.mb-4.flex.justify-center, [data-message-id]')) {
    if (!el.hasAttribute('data-message-id')) { day = txt(el); continue; }
    const t = el.querySelector('.pt-1.text-dimmed');
    msgs.push({ ours: !!(t && t.classList.contains('justify-end')), date: day, time: ((txt(t).match(/\d{1,2}:\d{2}/)) || [''])[0] });
  }
  // radar: lista de conversas (calibração de 05/10/2026): item div.min-h-18.cursor-pointer, nome h3, hora/dia
  // span.text-xs.text-muted, prévia span.truncate ("Você: …" = nossa), h3 em negrito = não lida.
  // A prévia só vira sim/não de "pediu preço" aqui dentro; o texto não sai da página.
  const INTENT = /quanto|valor|pre[cç]o|\bpix\b|tem (v[ií]deo|foto|conte[uú]do|pack)|manda(r)? (v[ií]deo|foto|mais|nude)|vende|comprar|quero (ver|comprar|um|uma|seu|sua)|\bpack\b|personalizad|custom|chamada|\bcall\b|exclusiv|mais (fotos|v[ií]deos)|desbloque/;
  const rooms = [...document.querySelectorAll('div.min-h-18.cursor-pointer')].map((r) => {
    const h3 = r.querySelector('h3');
    const prevs = [...r.querySelectorAll('span.truncate')].map(txt).filter(Boolean);
    const last = prevs[prevs.length - 1] || '';
    const ours = /^voc[eê]:/i.test(last);
    return { name: txt(h3), ours, unread: h3 && /font-semibold/.test(h3.className) ? 1 : 0, when: txt(r.querySelector('span.text-xs.text-muted')),
      intent: !ours && INTENT.test(prevs.join(' ').toLowerCase()) };
  }).filter((r) => r.name);
  return { page: 'chat', rooms, open: name ? { name, cid: 'ff:' + name, msgs, skeleton: !msgs.length } : null };
})()`;
