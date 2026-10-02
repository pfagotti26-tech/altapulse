// OnlyFans → Mensagens → conversa aberta (https://onlyfans.com/my/chats/chat/<id>/). Só para o Cartão do fã:
// nome do fã no cabeçalho e, de cada mensagem, se é nossa, o dia (separador) e a hora. Texto das mensagens não é lido.
// Estrutura validada na calibração de 01/10/2026: .b-chat__header.b-header-conversation .g-user-name;
// mensagens .b-chat__message (m-from-me = nossa), hora .b-chat__message__time, dia .b-chat__messages__time.
module.exports = String.raw`(() => {
  const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
  const m = location.pathname.match(/\/my\/chats\/chat\/(\d+)/);
  if (!m) return { page: 'other' };
  const head = document.querySelector('.b-chat__header.b-header-conversation') || document.querySelector('.b-header-conversation');
  const name = txt(head && (head.querySelector('.g-user-name .g-user-name') || head.querySelector('.g-user-name')));
  const msgs = []; let day = '';
  const box = document.querySelector('.b-chats__conversations-content') || document;
  for (const el of box.querySelectorAll('.b-chat__messages__time, .b-chat__message')) {
    if (el.classList.contains('b-chat__messages__time')) { day = txt(el); continue; }
    if (el.classList.contains('b-chat__message__system')) continue;
    msgs.push({ ours: el.classList.contains('m-from-me'), date: day, time: ((txt(el.querySelector('.b-chat__message__time')).match(/\d{1,2}:\d{2}(\s*[ap]m)?/i)) || [''])[0] });
  }
  return { page: 'chat', open: name ? { name, cid: 'of:' + m[1], msgs, skeleton: !msgs.length } : null };
})()`;
