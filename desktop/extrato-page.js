// Script executado DENTRO da página "Meu Privacy" (privacy.com.br/myprivacystats) numa aba OCULTA
// do próprio perfil da criadora — nunca na aba de chat que o chatter usa. Só leitura do DOM da aba
// Extratos: data/hora, assinante, valor bruto, comissão, forma de pagamento, produto e situação.
// As únicas interações são clicar na aba "Extratos" e em "Ver mais" para carregar linhas antigas.
// Seletores validados na calibração de 29/09/2026 (classes .seg-btn, .tx-card-shell, .tx-grid ...).
'use strict';

function script(action) {
  return String.raw`(() => {
    const ACTION = ${JSON.stringify(action)};
    const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
    const money = (s) => { const m = (s || '').match(/R\$\s*([\d.]+,\d{2})/); if (!m) return null; return Math.round(parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * 100); };
    // a página fica dentro de um shadow root (<privacy-web-myprivacy-stats>): a busca atravessa todos
    const roots = []; (function walk(root, depth) {
      if (depth > 6) return; roots.push(root);
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
    })(document, 0);
    const qs = (sel) => { for (const r of roots) { const e = r.querySelector(sel); if (e) return e; } return null; };
    const qsa = (sel) => roots.flatMap((r) => [...r.querySelectorAll(sel)]);
    const onStats = /myprivacystats/i.test(location.pathname);
    const tab = qs('.seg-btn[data-tour="tour-extratos"]');
    const tabActive = !!(tab && tab.classList.contains('active'));
    if (ACTION === 'tab') { if (tab && !tabActive) tab.click(); return { onStats, hadTab: !!tab, tabActive, loggedOut: /login|entrar/i.test(location.pathname), ready: document.readyState, roots: roots.length, vis: document.visibilityState, w: innerWidth, h: innerHeight }; }
    const more = qs('.ver-mais-btn');
    if (ACTION === 'more') { if (more) more.click(); return { clicked: !!more }; }
    // situação: o ícone vem dentro de <span title="Concluído"> (validado 30/09); por segurança também
    // pela cor/forma do ícone (check verde = concluído, relógio = a receber, x/seta = estorno)
    const statusOf = (cell) => {
      if (!cell) return { status: 'unknown', raw: '' };
      const titled = cell.querySelector('[title]'); const title = ((titled && titled.getAttribute('title')) || cell.getAttribute('title') || '').trim();
      const t = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (/conclu|pago|aprovad|confirm/.test(t)) return { status: 'confirmed', raw: title };
      if (/receber|pendente|process|aguard|analise/.test(t)) return { status: 'pending', raw: title };
      if (/estorn|cancel|recus|negad|chargeback|reembols/.test(t)) return { status: 'refunded', raw: title };
      const svg = cell.querySelector('svg'); const html = svg ? svg.outerHTML.toLowerCase() : '';
      if (/mp-green|m2\.5 7l3 3\.5|20 6 9 17/.test(html)) return { status: 'confirmed', raw: title || 'green' };
      if (html.includes('<circle') && html.includes('<polyline')) return { status: 'pending', raw: title || 'clock' };
      if (/mp-red|<line/.test(html) && html.includes('<circle')) return { status: 'refunded', raw: title || 'x' };
      return { status: 'unknown', raw: (title || html.replace(/<[^>]+>/g, ' ').trim()).slice(0, 40) };
    };
    const rows = qsa('.ext-tx-list .tx-card-shell').map((card) => {
      const cells = [...card.querySelectorAll('.tx-grid .tx-cell')];
      const when = txt(cells[0]); const name = txt(card.querySelector('.tx-user'));
      const grossCell = cells.find((c, i) => i > 0 && !c.classList.contains('tx-user') && !c.classList.contains('tx-commission'));
      const st = statusOf(card.querySelector('.tx-status-cell'));
      return { when, name, gross: money(txt(grossCell)), commission: money(txt(card.querySelector('.tx-commission'))),
        payment: txt(card.querySelector('.tx-payment')), product: txt(card.querySelector('.tx-tipo')), status: st.status, statusRaw: st.raw };
    }).filter((r) => r.when && r.gross != null);
    const period = txt(qs('.date-range-text'));
    return { onStats, tabActive, rows, hasMore: !!more, period, loggedOut: /login|entrar/i.test(location.pathname),
      dbg: { vis: document.visibilityState, lists: qsa('.ext-tx-list').length, shells: qsa('.tx-card-shell').length, skel: qsa('.skeleton-content').length, w: innerWidth, h: innerHeight, sy: scrollY, st: rows.slice(0, 3).map((r) => r.status + ':' + r.statusRaw).join(' | '), svg: ((qs('.tx-status-cell') || {}).innerHTML || '').replace(/\s+/g, ' ').slice(0, 260) } };
  })()`;
}

module.exports = { script };
