// Bloco D (passo 2): lê Meu Privacy → Assinantes (lista .sl-row) na aba oculta do extrato.
// Só leitura: nome de exibição (vira hash no processo principal), situação, preço e duração.
// Estrutura validada na calibração de 30/09/2026: .ass-view .sl-row, botão .ver-mais-btn.
module.exports.script = (action) => String.raw`(() => {
  const ACTION = ${JSON.stringify(action)};
  const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
  const roots = []; (function walk(root, depth) {
    if (depth > 6) return; roots.push(root);
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
  })(document, 0);
  const qs = (sel) => { for (const r of roots) { const e = r.querySelector(sel); if (e) return e; } return null; };
  const qsa = (sel) => roots.flatMap((r) => [...r.querySelectorAll(sel)]);
  const tab = qs('.seg-btn[data-tour="tour-assinantes"]');
  const tabActive = !!(tab && tab.classList.contains('active'));
  if (ACTION === 'tab') { if (tab && !tabActive) tab.click(); return { hadTab: !!tab, tabActive, vis: document.visibilityState }; }
  const view = qs('.ass-view');
  if (ACTION === 'more') { const b = view && view.querySelector('.ass-main .ver-mais-btn'); if (b) b.click(); return { clicked: !!b }; }
  const money = (s) => { const m = (s || '').match(/R\$\s*([\d.]+,\d{2}|[\d.]+)/); if (!m) return null; const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.')); return isNaN(v) ? null : Math.round(v * 100); };
  const rows = (view ? [...view.querySelectorAll('.sl-row')] : []).map((r) => {
    const kids = [...r.children];
    const who = kids[0]; const info = who && who.children[1];
    const name = info ? txt(info.children[0]) : '';
    const handle = info && info.children[1] ? txt(info.children[1]) : '';
    const spans = kids.filter((k) => k.tagName === 'SPAN').map(txt);
    const priceIdx = spans.findIndex((s) => /R\$/.test(s));
    return { name, handle, status: priceIdx > 0 ? spans[priceIdx - 1] : spans[0] || '', price_cents: priceIdx >= 0 ? money(spans[priceIdx]) : null, duration: priceIdx >= 0 ? spans[priceIdx + 1] || '' : '' };
  }).filter((r) => r.name);
  const count = txt(qs('.sbc-count')); const revenue = money(txt(qs('.sbc-revenue')));
  const more = view && view.querySelector('.ass-main .ver-mais-btn');
  const headers = view ? [...(view.querySelector('.sl-row') || { parentElement: null }).parentElement?.previousElementSibling?.children || []].map(txt) : [];
  return { tabActive, rows, hasMore: !!more, count, revenue_cents: revenue, headers, vis: document.visibilityState };
})()`;
