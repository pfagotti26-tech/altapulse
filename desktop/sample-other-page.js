// Bloco E no OnlyFans e no FatalFans: texto das últimas mensagens da conversa aberta, mascarado aqui dentro
// (e-mail, link, telefone, @, números longos e o nome do fã). Estrutura validada nas calibrações de 01–02/10/2026.
const common = String.raw`
  const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
  const mask = (s) => s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail]').replace(/https?:\/\/\S+|www\.\S+/gi, '[link]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[número]').replace(/@[\w.]{3,}/g, '[@usuário]').replace(/\d{5,}/g, '[número]');
  const clean = (text, name) => { let t = text.replace(/\b\d{1,2}:\d{2}(\s*[ap]m)?\b/gi, '').replace(/\$\s*[\d.,]+|R\$\s*[\d.,]+/g, '[valor]').trim();
    if (name && name.length > 2) t = t.split(name).join('[fã]'); return mask(t).slice(0, 400); };`;
module.exports = {
  onlyfans: String.raw`(() => {${common}
    const m = location.pathname.match(/\/my\/chats\/chat\/(\d+)/); if (!m) return null;
    const head = document.querySelector('.b-chat__header.b-header-conversation') || document.querySelector('.b-header-conversation');
    const name = txt(head && (head.querySelector('.g-user-name .g-user-name') || head.querySelector('.g-user-name')));
    const box = document.querySelector('.b-chats__conversations-content') || document; const msgs = []; let day = '';
    for (const el of box.querySelectorAll('.b-chat__messages__time, .b-chat__message')) {
      if (el.classList.contains('b-chat__messages__time')) { day = txt(el); continue; }
      if (el.classList.contains('b-chat__message__system')) continue;
      let text = clean(txt(el.querySelector('.b-chat__message__text-holder') || el.querySelector('.b-chat__message__text')), name);
      if (!text) { if (el.querySelector('img, video, .b-post__media, .b-chat__message__media')) text = '[mídia]'; else continue; }
      const t = (txt(el.querySelector('.b-chat__message__time')).match(/\d{1,2}:\d{2}/) || [null])[0];
      msgs.push({ ours: el.classList.contains('m-from-me'), date: day, time: t, text });
    }
    return name ? { cid: 'of:' + m[1], name, msgs: msgs.slice(-40) } : null;
  })()`,
  fatalfans: String.raw`(() => {${common}
    if (!/\/chat/.test(location.pathname)) return null;
    const pen = document.querySelector('.iconify.i-lucide\\:square-pen');
    const h2 = pen && pen.closest('button') && pen.closest('button').parentElement.querySelector('h2');
    const name = txt(h2); const msgs = []; let day = '';
    for (const el of document.querySelectorAll('div.mb-4.flex.justify-center, [data-message-id]')) {
      if (!el.hasAttribute('data-message-id')) { day = txt(el); continue; }
      const t = el.querySelector('.pt-1.text-dimmed');
      let text = clean(txt(el.querySelector('p.whitespace-pre-wrap') || el.querySelector('p')), name);
      if (!text) { if (el.querySelector('img, video')) text = '[mídia]'; else continue; }
      msgs.push({ ours: !!(t && t.classList.contains('justify-end')), date: day, time: (txt(t).match(/\d{1,2}:\d{2}/) || [null])[0], text });
    }
    return name ? { cid: 'ff:' + name, name, msgs: msgs.slice(-40) } : null;
  })()`,
};
