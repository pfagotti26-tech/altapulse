// OnlyFans → Extratos → Renda (https://onlyfans.com/my/statements/earnings), lido numa aba oculta. Só leitura.
// Estrutura validada na calibração de 01/10/2026: table.b-table.m-earnings; por linha td.b-table__date
// (data "30 set, 2026" + hora), __amount / __fee / __net em US$, __desc ("Assinatura de <nome>",
// "Assinatura recorrente de", gorjeta, mensagem...), __status com ícone icon-done / icon-loading / icon-undo.
// A lista carrega mais linhas ao rolar até o fim (sem páginas).
module.exports.script = (action) => String.raw`(() => {
  const ACTION = ${JSON.stringify(action)};
  const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
  const loggedOut = !!document.querySelector('input[type="password"]') || /\/login|\/auth/i.test(location.pathname);
  const table = document.querySelector('table.b-table.m-earnings') || document.querySelector('table.b-table');
  if (ACTION === 'more') {
    const last = table && table.querySelector('tbody tr:last-child');
    if (last) last.scrollIntoView({ block: 'end' });
    window.scrollTo(0, document.body.scrollHeight);
    for (const el of document.querySelectorAll('*')) { if (el.scrollHeight > el.clientHeight + 200 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight; }
    return { rows: table ? table.querySelectorAll('tbody tr').length : 0 };
  }
  if (!table) return { ok: false, loggedOut, url: location.href, rows: [] };
  const rows = [...table.querySelectorAll('tbody tr')].map((tr) => {
    const q = (c) => tr.querySelector('.b-table__' + c);
    const date = txt(q('date__date')), time = txt(q('date__time'));
    const descEl = q('desc'); const span = descEl && descEl.querySelector('span');
    const desc = txt(span || descEl); const a = span && span.querySelector('a');
    const name = a ? txt(a) : desc.replace(/^.*?\bde\s+/i, '');
    const icon = (q('status') && q('status').querySelector('[data-icon-name]')) || (descEl && descEl.querySelector('[data-icon-name]'));
    const st = icon ? icon.getAttribute('data-icon-name') : '';
    return { when: (date + ' ' + time).trim(), gross: txt(q('amount')), fee: txt(q('fee')), net: txt(q('net')), product: desc.replace(/\s+de\s+.*$/i, '').trim() || desc, name, status: st };
  }).filter((r) => r.when && r.gross);
  return { ok: true, url: location.href, rows };
})()`;
