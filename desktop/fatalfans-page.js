// FatalFans → Minhas vendas (https://fatalfans.com/creator/dashboard), lido numa aba oculta do app.
// Estrutura validada na calibração de 01/10/2026 (Nuxt UI): abas são botões com ícone lucide
// (banknote = Transações, users = Assinantes); tabelas com data-slot th/td; paginação com
// button[data-slot=item][data-type=page] e button[data-slot=next]. Só leitura.
module.exports.script = (action) => String.raw`(() => {
  const ACTION = ${JSON.stringify(action)};
  const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const tabBtn = (icon) => { const i = document.querySelector('button span.iconify.i-lucide\\:' + icon); return i ? i.closest('button') : null; };
  const isActive = (b) => !!(b && b.classList.contains('bg-primary') && b.classList.contains('text-inverted'));
  const loggedOut = !!document.querySelector('input[type="password"]') || /\/login|\/entrar/i.test(location.pathname);
  if (ACTION === 'tab:transacoes' || ACTION === 'tab:assinantes') {
    const b = tabBtn(ACTION === 'tab:transacoes' ? 'banknote' : 'users');
    const was = isActive(b); if (b && !was) b.click();
    return { hadTab: !!b, tabActive: was, loggedOut, url: location.href };
  }
  // tabela visível cujo cabeçalho tem as colunas pedidas
  const tables = [...document.querySelectorAll('table')].filter((t) => t.getClientRects().length);
  const pick = (need) => tables.map((t) => ({ t, heads: [...t.querySelectorAll('th')].map((h) => norm(txt(h))) }))
    .find((x) => need.every((n) => x.heads.some((h) => h.includes(n))));
  const pager = (t) => { const box = t && t.closest('[data-slot="root"]'); const root = box ? box.parentElement.parentElement : document; return root.querySelector('nav [data-slot="list"]') || document.querySelector('nav [data-slot="list"]'); };
  const pageInfo = (t) => {
    const list = pager(t); if (!list) return { page: 1, pages: 1, hasNext: false };
    const items = [...list.querySelectorAll('button[data-slot="item"][data-type="page"]')];
    const cur = items.find((b) => b.getAttribute('data-selected') === 'true');
    const next = list.querySelector('button[data-slot="next"]');
    const nums = items.map((b) => parseInt(txt(b), 10)).filter((n) => n > 0);
    return { page: cur ? parseInt(txt(cur), 10) || 1 : 1, pages: nums.length ? Math.max(...nums) : 1, hasNext: !!(next && !next.disabled && next.getAttribute('aria-disabled') !== 'true' && !/invisible|hidden/.test(next.className)) };
  };
  if (ACTION === 'next' || ACTION === 'first') {
    const x = pick(['data']) || pick(['status']); const list = pager(x && x.t);
    if (!list) return { clicked: false };
    const b = ACTION === 'next' ? list.querySelector('button[data-slot="next"]') : [...list.querySelectorAll('button[data-slot="item"][data-type="page"]')].find((i) => txt(i) === '1');
    if (b && !b.disabled) b.click();
    return { clicked: !!b };
  }
  if (ACTION === 'transacoes') {
    const x = pick(['data', 'valor', 'ganho']);
    if (!x) return { ok: false, loggedOut, rows: [], tabActive: isActive(tabBtn('banknote')) };
    const col = (n) => x.heads.findIndex((h) => h.includes(n));
    const ci = { when: col('data'), gross: col('valor'), net: col('ganho'), product: col('tipo'), payment: col('pagamento'), name: col('comprador'), status: col('status') >= 0 ? col('status') : col('situa') };
    const rows = [...x.t.querySelectorAll('tbody tr')].map((tr) => {
      const td = [...tr.querySelectorAll('td')].map(txt); const g = (k) => (ci[k] >= 0 ? td[ci[k]] || '' : '');
      return { when: g('when'), gross: g('gross'), net: g('net'), product: g('product'), payment: g('payment'), name: g('name'), status: g('status'), extra: td.length > 6 ? td.slice(6).join(' | ') : '' };
    }).filter((r) => r.when && r.gross);
    return { ok: true, rows, heads: x.heads, ...pageInfo(x.t), tabActive: isActive(tabBtn('banknote')) };
  }
  if (ACTION === 'assinantes') {
    const x = pick(['assinatura', 'status']);
    const cards = {}; for (const t of document.querySelectorAll('[data-slot="title"]')) { const k = norm(txt(t)); const v = txt(t.closest('[data-slot="container"]')?.querySelector('p')); if (k && v) cards[k] = v; }
    if (!x) return { ok: false, loggedOut, rows: [], cards, tabActive: isActive(tabBtn('users')) };
    const rows = [...x.t.querySelectorAll('tbody tr')].map((tr) => { const td = [...tr.querySelectorAll('td')].map(txt); return { name: td[0] || '', price: td[1] || '', status: td[2] || '' }; }).filter((r) => r.name);
    return { ok: true, rows, cards, ...pageInfo(x.t), tabActive: isActive(tabBtn('users')) };
  }
  return { loggedOut, url: location.href };
})()`;
