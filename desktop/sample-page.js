// Bloco E: lê o TEXTO das últimas mensagens da conversa aberta (só com "análise por IA" ligada em
// Configurações). Nomes, e-mails, telefones, links e números longos são mascarados ainda aqui,
// dentro da página; o nome do fã sai só para virar o mesmo hash usado nos outros eventos.
module.exports = String.raw`(() => {
  const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
  const roots = []; (function walk(root, depth) {
    if (depth > 6) return; roots.push(root);
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
  })(document, 0);
  const qs = (sel) => { for (const r of roots) { const e = r.querySelector(sel); if (e) return e; } return null; };
  const name = txt(qs('.vac-room-header .vac-list-name .vac-text-ellipsis') || qs('.vac-room-header .vac-list-name'));
  const cid = new URLSearchParams(location.search).get('cid') || (location.pathname.match(/\/chat\/([^/?#]+)/) || [])[1] || (name ? 'n:' + name : null);
  const cont = qs('.vac-messages-container');
  if (!cid || !cont || qs('.skeleton-messages')) return null;
  const mask = (s) => s
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail]')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[link]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[número]')
    .replace(/@[\w.]{3,}/g, '[@usuário]')
    .replace(/\d{5,}/g, '[número]');
  const nameRx = name && name.length > 2 ? new RegExp(name.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&'), 'gi') : null;
  let label = null; const msgs = [];
  for (const el of cont.querySelectorAll('.vac-card-date, .vac-message-wrapper-msg')) {
    if (el.classList.contains('vac-card-date')) { label = txt(el); continue; }
    const m = txt(el.querySelector('.vac-text-timestamp')).match(/(\d{1,2}):(\d{2})/);
    const body = el.querySelector('.vac-format-message-wrapper, .vac-format-container, .vac-message-card');
    let text = txt(body);
    // tira horário e etiquetas de valor que ficam dentro do mesmo cartão
    text = text.replace(/\b\d{1,2}:\d{2}\b/g, '').replace(/R\$\s*[\d.,]+\s*(ainda n[aã]o pago|pago)?/gi, '[oferta]').trim();
    if (!text) { if (el.querySelector('img, video, audio')) text = '[mídia]'; else continue; }
    if (nameRx) text = text.replace(nameRx, '[fã]');
    text = mask(text).slice(0, 400);
    msgs.push({ ours: el.classList.contains('vac-offset-current'), date: label, time: m ? m[1].padStart(2, '0') + ':' + m[2] : null, text });
  }
  return { cid, name, msgs: msgs.slice(-40) };
})()`;
