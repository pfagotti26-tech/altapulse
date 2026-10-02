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
  return { page: 'chat', open: name ? { name, cid: 'ff:' + name, msgs, skeleton: !msgs.length } : null };
})()`;
