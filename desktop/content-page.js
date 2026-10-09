// Conteúdo e disparos: scripts executados DENTRO das páginas da Privacy. Só leitura.
// - eng(action): Meu Privacy → Engajamento (resultado de cada post). Seletores da calibração de 09/10/2026:
//   .seg-btn[data-tour="tour-engajamento"], .pub-list .mp-stagger (data, legenda, .ppc-chip preço, compras...).
// - cal(action): Calendário (privacy.com.br/calendar) em modo lista: article.__event-card is-message/is-post,
//   .card-time, .card-status is-done/is-scheduled, texto em .preview-text quando o cartão está aberto.
//   Abrir o cartão (clicar na seta) só mostra o conteúdo; nunca clica em "Cancelar envio".
// - ctx(): o que está aberto na tela no momento de um envio (mensagem em massa ou publicação), para
//   registrar QUEM fez pelo app. Nada é enviado por este script.
'use strict';

const COMMON = String.raw`
    const roots = []; (function walk(root, depth) { if (depth > 7) return; roots.push(root); for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, depth + 1); })(document, 0);
    const qs = (sel) => { for (const r of roots) { const e = r.querySelector(sel); if (e) return e; } return null; };
    const qsa = (sel) => roots.flatMap((r) => [...r.querySelectorAll(sel)]);
    const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
    const money = (s) => { const m = (s || '').match(/R\$\s*([\d.]+,\d{2})/); return m ? Math.round(parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * 100) : null; };
    const MES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
    const MESF = { janeiro: 0, fevereiro: 1, marco: 2, 'março': 2, abril: 3, maio: 4, junho: 5, julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11 };
    const visible = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
`;

function eng(action) {
  return String.raw`(() => {
    const ACTION = ${JSON.stringify(action)};
    ${COMMON}
    const tab = qs('.seg-btn[data-tour="tour-engajamento"]');
    if (ACTION === 'tab') { if (tab && !tab.classList.contains('active')) tab.click(); return { hadTab: !!tab, active: !!(tab && tab.classList.contains('active')), onStats: /myprivacystats/i.test(location.pathname) }; }
    const view = qs('.pub-view');
    if (ACTION === 'more') { const b = view && view.querySelector('.ver-mais-btn'); if (b) b.click(); return { clicked: !!b }; }
    const when = (s) => { const m = (s || '').toLowerCase().match(/(\d{1,2})\s+([a-zç]{3})[a-zç]*\.?,?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})/); if (!m || MES[m[2]] == null) return null; const d = new Date(+m[3], MES[m[2]], +m[1], +m[4], +m[5]); return isNaN(d) ? null : d.toISOString(); };
    const rows = [];
    for (const card of (view ? [...view.querySelectorAll('.pub-list .mp-stagger')] : [])) {
      const spans = [...card.querySelectorAll('span')].map(txt);
      const at = spans.map(when).find(Boolean); if (!at) continue;
      const cap = txt(card.querySelector('p'));
      const chip = card.querySelector('.ppc-chip'); const price = chip ? money(txt(chip)) : null;
      const boxes = [...card.querySelectorAll('div')].filter((d) => /compra/i.test(txt(d)) && /mimo/i.test(txt(d)));
      const box = boxes[boxes.length - 1]; const sp = box ? [...box.children].map(txt).filter((x) => x && x !== '·' && x !== '•') : [];
      const all = box ? txt(box) : txt(card);
      const revS = sp.find((x) => /^R\$/.test(x) && !/mimo/i.test(x)); const tipsS = sp.find((x) => /mimo/i.test(x));
      const n = (re) => { const m = all.match(re); return m ? parseInt(m[1].replace(/\./g, ''), 10) : 0; };
      rows.push({ posted_at: at, caption: cap.slice(0, 2000), price_cents: price, revenue_cents: money(revS) || 0, tips_cents: money(tipsS) || 0,
        likes: n(/([\d.]+)\s*curtida/i), comments: n(/([\d.]+)\s*coment/i), purchases: n(/([\d.]+)\s*compra/i) });
    }
    return { ok: !!view, rows, hasMore: !!(view && view.querySelector('.ver-mais-btn')), period: txt(qs('.date-range-text')), loading: qsa('.skeleton-content, .animated-background').length };
  })()`;
}

function cal(action) {
  return String.raw`(() => {
    const ACTION = ${JSON.stringify(action)};
    ${COMMON}
    const root = qs('.wc-eventcalendar');
    if (!root) return { ok: false, path: location.pathname };
    const list = root.querySelector('.__month-event-list');
    if (ACTION === 'list') { if (!list) { const b = root.querySelector('.header-action.is-toggle'); if (b) b.click(); } return { ok: true, list: !!list }; }
    if (ACTION === 'prev' || ACTION === 'next') { const a = root.querySelectorAll('.nav-arrow'); const b = a[ACTION === 'prev' ? 0 : a.length - 1]; if (b) b.click(); return { ok: !!b }; }
    if (ACTION === 'expand') {
      let n = 0; // só a linha do cartão (seta); o botão "Cancelar envio" fica em outra área e não é tocado
      for (const card of list ? [...list.querySelectorAll('article.__event-card.is-message:not(.is-expanded), article.__event-card.is-post:not(.is-expanded)')] : []) {
        const row = card.querySelector(':scope > .card-row.is-clickable'); if (row && n < 80) { row.click(); n += 1; }
      }
      return { ok: true, expanded: n };
    }
    const label = txt(root.querySelector('.nav-label')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const lm = label.match(/([a-z]+)\s+(\d{4})/); if (!lm || MESF[lm[1]] == null) return { ok: false, label };
    const month = MESF[lm[1]], year = +lm[2];
    const rows = [];
    for (const day of list ? [...list.querySelectorAll('section.list-day')] : []) {
      const dm = txt(day.querySelector('.__day-chip')).match(/(\d{1,2})/); if (!dm) continue;
      for (const card of day.querySelectorAll('article.__event-card')) {
        const c = card.classList;
        const kind = c.contains('is-message') ? 'mass' : c.contains('is-post') ? 'post' : c.contains('is-live') ? 'live' : null; if (!kind) continue;
        const tm = txt(card.querySelector('.card-time')).match(/(\d{1,2}):(\d{2})/); if (!tm) continue;
        const st = card.querySelector('.card-status'); const sc = st ? st.className : '';
        const status = /is-done/.test(sc) ? 'done' : /is-scheduled/.test(sc) ? 'scheduled' : /cancel/.test(sc) || /cancel/i.test(txt(st)) ? 'canceled' : 'unknown';
        const d = new Date(year, month, +dm[1], +tm[1], +tm[2]);
        rows.push({ at: d.toISOString(), kind, status, text: txt(card.querySelector('.preview-text')).slice(0, 2000) });
      }
    }
    return { ok: true, list: !!list, label, rows };
  })()`;
}

// Contexto no instante de uma chamada de envio: mensagem em massa aberta? publicação aberta?
const CTX = String.raw`(() => {
    ${COMMON}
    const path = location.pathname;
    const wiz = qsa('.vac-message-wizard').find(visible);
    if (wiz) {
      const ta = wiz.querySelector('.ce-textarea') || qsa('.ce-textarea').find(visible);
      const footer = wiz.querySelector('.vac-room-footer') || wiz;
      const prices = [...footer.querySelectorAll('*')].filter((e) => !e.children.length && /R\$\s*[\d.]+,\d{2}/.test(e.textContent) && !/m[íi]nimo|m[áa]ximo/i.test(e.textContent)).map((e) => money(e.textContent)).filter((x) => x != null);
      const tags = [...wiz.querySelectorAll('.filter-tag')].filter((t) => !/el-tag--info/.test(t.className) || /is-active|selected|is-checked|el-tag--primary|el-tag--dark/.test(t.className)).map(txt).slice(0, 12);
      const sched = [...wiz.querySelectorAll('*')].filter((e) => !e.children.length && /agend/i.test(e.textContent) && /\d{1,2}[:/h]\d{2}/.test(e.textContent)).map(txt)[0] || '';
      return { kind: 'mass', path, text: ((ta && ta.value) || '').slice(0, 2000), price_cents: prices[0] == null ? null : prices[0], audience: tags, sched, media: wiz.querySelectorAll('.ce-media-preview, .media-preview, img[src^="blob:"]').length };
    }
    if (/^\/publisher/i.test(path)) {
      const ta = qsa('textarea').find(visible);
      const prices = qsa('*').filter((e) => !e.children.length && /R\$\s*[\d.]+,\d{2}/.test(e.textContent) && !/m[íi]nimo|m[áa]ximo/i.test(e.textContent) && visible(e)).map((e) => money(e.textContent)).filter((x) => x != null);
      const sched = qsa('*').filter((e) => !e.children.length && visible(e) && /\b\d{1,2}\/\d{1,2}\b|\b\d{1,2}:\d{2}\b/.test(e.textContent) && e.textContent.length < 60).map(txt).slice(0, 3).join(' | ');
      return { kind: 'post', path, text: ((ta && ta.value) || '').slice(0, 2000), price_cents: prices[0] == null ? null : prices[0], audience: [], sched, media: qsa('img[src^="blob:"], video[src^="blob:"]').length };
    }
    return { kind: null, path };
})()`;

module.exports = { eng, cal, CTX };
