// CloseFans → Vendas (https://close.fans/sales-report), lido numa aba oculta do app. Só leitura.
// Estrutura validada na calibração de 01/10/2026 (MUI): tabela única com cabeçalho "Data da venda,
// Canal de vendas, Membro, Produto, Valor bruto, Valor líquido, Forma de pagamento, Cupom, Status";
// células do corpo são <th>; paginação MUI (Mui-selected / NavigateNextIcon). Período padrão: mês atual.
module.exports.script = (action) => String.raw`(() => {
  const ACTION = ${JSON.stringify(action)};
  const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const loggedOut = !!document.querySelector('input[type="password"]') || /\/login/i.test(location.pathname);
  const table = [...document.querySelectorAll('table')].find((t) => /valor bruto/.test(norm(txt(t.querySelector('thead')))));
  const nav = document.querySelector('nav.MuiPagination-root');
  const nextBtn = () => { const i = nav && nav.querySelector('[data-testid="NavigateNextIcon"]'); return i ? i.closest('button') : null; };
  const pageInfo = () => {
    const cur = nav && nav.querySelector('button.Mui-selected');
    const nums = nav ? [...nav.querySelectorAll('button.MuiPaginationItem-page')].map((b) => parseInt(txt(b), 10)).filter((n) => n > 0) : [];
    const n = nextBtn();
    return { page: cur ? parseInt(txt(cur), 10) || 1 : 1, pages: nums.length ? Math.max(...nums) : 1, hasNext: !!(n && !n.disabled && !n.classList.contains('Mui-disabled')) };
  };
  if (ACTION === 'next') { const n = nextBtn(); if (n && !n.disabled) n.click(); return { clicked: !!n }; }
  if (!table) return { ok: false, loggedOut, url: location.href, rows: [] };
  const heads = [...table.querySelectorAll('thead th')].map((h) => norm(txt(h)));
  const col = (n) => heads.findIndex((h) => h.includes(n));
  const ci = { when: col('data'), channel: col('canal'), name: col('membro'), product: col('produto'), gross: col('bruto'), net: col('liquido'), payment: col('pagamento'), coupon: col('cupom'), status: col('status') };
  const rows = [...table.querySelectorAll('tbody tr')].map((tr) => {
    const c = [...tr.children].map(txt); const g = (k) => (ci[k] >= 0 ? c[ci[k]] || '' : '');
    return { when: g('when'), channel: g('channel'), name: g('name'), product: g('product'), gross: g('gross'), net: g('net'), payment: g('payment'), coupon: g('coupon'), status: g('status') };
  }).filter((r) => r.when && r.gross);
  const count = txt(document.querySelector('[class*="countResultText"]'));
  return { ok: true, url: location.href, heads, rows, count, ...pageInfo() };
})()`;
