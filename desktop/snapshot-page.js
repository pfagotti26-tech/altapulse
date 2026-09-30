// Bloco B: lê a aba "Visão geral" do Meu Privacy (na mesma aba oculta do extrato) e devolve um retrato
// da criadora: vendas hoje/mês/histórico, assinantes, projeção, saldos, recordes e faturamento por
// produto no período. Só números e rótulos visíveis; nada de assinante nem mensagem.
// Os cartões não têm classes: a leitura é por rótulo de texto ("Hoje", "No mês", "Total", "Ativos"...)
// dentro do cartão cujo título é conhecido ("Vendas nacionais", "Assinantes", "Projeção de Faturamento").
'use strict';

function script(action) {
  return String.raw`(() => {
    const ACTION = ${JSON.stringify(action)};
    const roots = []; (function walk(root, depth) { if (depth > 6) return; roots.push(root); for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, depth + 1); })(document, 0);
    const qs = (sel) => { for (const r of roots) { const e = r.querySelector(sel); if (e) return e; } return null; };
    const qsa = (sel) => roots.flatMap((r) => [...r.querySelectorAll(sel)]);
    const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const tab = qs('.seg-btn[data-tour="tour-visao-geral"]');
    if (ACTION === 'tab') { if (tab && !tab.classList.contains('active')) tab.click(); return { hadTab: !!tab, active: !!(tab && tab.classList.contains('active')) }; }
    const money = (s) => { const m = (s || '').match(/R\$\s*([\d.]+,\d{2})/); return m ? Math.round(parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * 100) : null; };
    const int = (s) => { const m = (s || '').replace(/\./g, '').match(/-?\d+/); return m ? parseInt(m[0], 10) : null; };
    const pct = (s) => { const m = (s || '').match(/(-?[\d.,]+)\s*%/); return m ? parseFloat(m[1].replace(/\./g, '').replace(',', '.')) : null; };
    // folhas de texto (elementos sem filhos-elemento com texto)
    const leaves = qsa('*').filter((e) => e.children.length === 0 && txt(e));
    const leaf = (label, scope) => leaves.find((e) => norm(txt(e)) === norm(label) && (!scope || scope.contains(e)));
    const valueAfter = (el) => { if (!el) return ''; let n = el.nextElementSibling; if (n) return txt(n); const p = el.parentElement; n = p && p.nextElementSibling; return txt(n); };
    // o título do cartão é procurado só no conteúdo (a aba "Assinantes" do topo tem o mesmo texto) e o
    // cartão é o menor ancestral do título que contém o rótulo: "Hoje" de Nacionais ≠ "Hoje" de Internacionais
    const main = qs('.mp-content') || document.body;
    const titleLeaf = (title) => leaves.find((e) => norm(txt(e)) === norm(title) && main.contains(e) && !e.closest('button'));
    const pick = (title, label) => {
      const t = titleLeaf(title); if (!t) return '';
      let c = t.parentElement;
      for (let i = 0; i < 4 && c; i++, c = c.parentElement) { const l = leaf(label, c); if (l && l !== t) return valueAfter(l); }
      return '';
    };
    const out = { readAt: new Date().toISOString(), period: txt(qs('.date-range-text')) };
    out.sales_today_cents = money(pick('Vendas nacionais', 'Hoje')); out.sales_month_cents = money(pick('Vendas nacionais', 'No mês')); out.sales_total_cents = money(pick('Vendas nacionais', 'Total faturamento histórico'));
    out.intl_today_cents = money(pick('Vendas internacionais', 'Hoje')); out.intl_month_cents = money(pick('Vendas internacionais', 'No mês')); out.intl_total_cents = money(pick('Vendas internacionais', 'Total faturamento histórico'));
    out.subscribers_total = int(pick('Assinantes', 'Total')); out.subscribers_active = int(pick('Assinantes', 'Ativos')); out.revenue_rank_pct = pct(pick('Assinantes', 'Faturamento em relação a outros criadores'));
    out.projection_month_cents = money(pick('Projeção de Faturamento', 'Total')); out.projection_avg_day_cents = money(pick('Projeção de Faturamento', 'Média Dia')); out.projection_cents = money(pick('Projeção de Faturamento', 'Projeção'));
    out.revenue_today_cents = money(txt(qs('.tcc-fat-value')));
    const bal = qsa('.tcc-bal-value').map((e) => money(txt(e))); out.balance_national_cents = bal[0] ?? null; out.balance_international_cents = bal[1] ?? null; out.balance_pending_cents = bal[2] ?? null;
    out.record_day_cents = money(txt(qs('.tcc-record-value')));
    out.by_product = qsa('.vgf-sub-card').map((c) => ({ product: txt(c.querySelector('.vgf-sub-title')), count: int(valueAfter(leaf('Quantidade', c))), cents: money(valueAfter(leaf('Faturamento no período', c))) })).filter((x) => x.product);
    out.period_total_cents = money(txt(qs('.vgf-card .vgf-title') ? qs('.vgf-card').querySelector('.vgf-title').parentElement : null));
    out.ok = out.sales_today_cents != null || out.subscribers_total != null;
    return out;
  })()`;
}
module.exports = { script };
