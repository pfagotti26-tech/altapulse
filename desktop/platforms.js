// Plataformas que o app abre no perfil isolado da criadora (mesma lista do backend/vault.py).
// Cada criadora tem UM perfil (partição) para todas as plataformas: os cookies já são separados por site.
'use strict';
const PLATFORMS = {
  privacy:   { label: 'Privacy',     home: 'https://privacy.com.br/',         hosts: ['privacy.com.br'] },
  fatalfans: { label: 'FatalFans',   home: 'https://fatalfans.com/',          hosts: ['fatalfans.com'] },
  closefans: { label: 'CloseFans',   home: 'https://close.fans/',             hosts: ['close.fans', 'closefans.com'] },
  onlyfans:  { label: 'OnlyFans',    home: 'https://onlyfans.com/',           hosts: ['onlyfans.com'] },
  x:         { label: 'X (Twitter)', home: 'https://x.com/home',              hosts: ['x.com', 'twitter.com'] },
  instagram: { label: 'Instagram',   home: 'https://www.instagram.com/',      hosts: ['instagram.com'] },
  facebook:  { label: 'Facebook',    home: 'https://www.facebook.com/',       hosts: ['facebook.com'] },
};
// hosts de login social que as plataformas usam em pop-up
const AUTH_HOSTS = ['accounts.google.com', 'appleid.apple.com', 'www.facebook.com', 'facebook.com', 'api.twitter.com', 'x.com'];

function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }
function matchesHost(host, list) { return list.some((h) => host === h || host.endsWith('.' + h)); }
function platformOf(url) {
  const host = hostOf(url);
  return Object.keys(PLATFORMS).find((id) => matchesHost(host, PLATFORMS[id].hosts)) || null;
}
function allowedUrl(url) {
  const host = hostOf(url);
  return !!platformOf(url) || matchesHost(host, AUTH_HOSTS);
}

// Preenche login e senha na página de login (roda DENTRO da página, atravessando shadow roots).
// Só preenche campos visíveis; clica em "Entrar" se existir. Nada é lido da página além dos campos.
function fillScript(login, password) {
  return String.raw`(() => {
    const LOGIN = ${JSON.stringify(login)}; const PASS = ${JSON.stringify(password)};
    const OPEN_LOGIN = /^(entrar|login|log in|fazer login|acessar|acessar conta|sign in)$/i;
    const roots = []; (function walk(root, depth) { if (depth > 6) return; roots.push(root); for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, depth + 1); })(document, 0);
    const all = (sel) => roots.flatMap((r) => [...r.querySelectorAll(sel)]);
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const set = (el, value) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const d = Object.getOwnPropertyDescriptor(proto, 'value'); el.focus(); d.set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); };
    const pass = all('input[type="password"]').find(visible);
    if (!pass) {
      // páginas que só mostram o formulário depois de clicar em "Entrar" (ex.: CloseFans): abre e tenta de novo
      const area = (b) => { const r = b.getBoundingClientRect(); return r.width * r.height; };
      const opens = all('button, a').filter(visible).filter((b) => OPEN_LOGIN.test((b.textContent || '').trim())).sort((a, b) => area(b) - area(a)); // o maior primeiro (botão principal); se não abrir, tenta o próximo
      const k = window.__altaLoginTry || 0; window.__altaLoginTry = k + 1;
      const open = opens.length ? opens[k % opens.length] : null;
      if (open) { open.click(); return { ok: false, retry: true, reason: 'abrindo o login' }; }
      return { ok: false, reason: 'sem campo de senha' };
    }
    const user = all('input').filter(visible).find((i) => i !== pass && ['text', 'email', 'tel', ''].includes((i.getAttribute('type') || '').toLowerCase()) && !/search|busca|code|codigo|otp/i.test(i.name + ' ' + i.id + ' ' + i.placeholder));
    if (user) set(user, LOGIN);
    set(pass, PASS);
    // "Lembrar de mim" ligado, para o login durar neste computador
    const keep = all('input[type="checkbox"]').find((c) => { const l = c.closest('label') || (c.id && document.querySelector('label[for="' + c.id + '"]')); return l && /lembrar|manter|remember|keep me/i.test(l.textContent || ''); });
    if (keep && !keep.checked) keep.click();
    // botão de enviar DO FORMULÁRIO da senha (o primeiro "Entrar" da página pode ser o do topo ou a aba do
    // modal, e clicar nele recria o formulário vazio, como no CloseFans): mesmo form, type=submit, e depois da senha
    const okText = (b) => { const t = (b.textContent || b.value || '').trim(); return /entrar|log ?in|sign ?in|acessar|continuar|next|avan/i.test(t) && !/google|apple|facebook|x\b|twitter|cadast|sign ?up|criar/i.test(t); };
    const after = (b) => !!(pass.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const form = pass.closest('form');
    // botões desativados também contam: a página só libera depois de validar os campos (o clique espera liberar)
    const cands = all('button, input[type="submit"]').filter(visible);
    const btn = (form && cands.find((b) => form.contains(b) && (b.type === 'submit' || okText(b))))
      || cands.find((b) => after(b) && b.type === 'submit' && okText(b))
      || cands.find((b) => after(b) && okText(b));
    // espera o botão habilitar (a página valida os campos depois de preenchidos) e clica; até 4 s
    if (btn) { let n = 0; const tryClick = () => { const off = btn.disabled || /disabled/i.test(btn.className || ''); if (!off || n >= 16) { btn.click(); return; } n += 1; setTimeout(tryClick, 250); }; setTimeout(tryClick, 400); }
    else if (form) setTimeout(() => form.requestSubmit ? form.requestSubmit() : form.submit(), 400);
    return { ok: true, user: !!user, clicked: !!btn, btn: btn ? ((btn.textContent || btn.value || '').trim().slice(0, 20) + (btn.disabled ? ' (desativado)' : '')) : null, inForm: !!(form && btn && form.contains(btn)) };
  })()`;
}
// Sonda leve: a página atual tem um campo de senha visível? (roda dentro da página)
const LOGIN_PROBE = String.raw`(() => {
  const roots = []; (function walk(root, depth) { if (depth > 6) return; roots.push(root); for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, depth + 1); })(document, 0);
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inputs = roots.flatMap((r) => [...r.querySelectorAll('input[type="password"]')]);
  if (inputs.some(vis)) return true;
  // deslogada, com o formulário escondido atrás de um botão "Entrar" (CloseFans, FatalFans). Só vale se também
  // houver "Cadastre-se"/"Criar conta" na tela: logada, a página não oferece cadastro (evita botão falso)
  const btns = roots.flatMap((r) => [...r.querySelectorAll('button, a')]).filter(vis).map((b) => (b.textContent || '').trim());
  return btns.some((t) => /^(entrar|login|log in|fazer login|acessar conta|sign in)$/i.test(t)) && btns.some((t) => /^(cadastre-se|cadastrar|criar conta|crie sua conta|sign up|registre-se|cadastre-se gr[aá]tis)$/i.test(t));
})()`;

module.exports = { PLATFORMS, platformOf, allowedUrl, fillScript, LOGIN_PROBE };
