// Barra de endereço da plataforma aberta (como no Lauth): mostra o link da conversa, copia com um clique e
// abre um link colado (Enter). Quem decide se o link pode abrir é o processo principal.
const $ = (id) => document.getElementById(id);
let current = '', editing = false;
window.pulse.onUrl((d) => {
  current = (d && d.url) || '';
  $('plat').textContent = d && d.label ? d.label : '';
  if (!editing) $('u').value = current;
});
$('u').addEventListener('focus', () => { editing = true; setTimeout(() => $('u').select(), 0); });
$('u').addEventListener('blur', () => { editing = false; $('u').value = current; });
$('u').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('u').value = current; $('u').blur(); } });
$('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('u').value.trim(); if (!v || v === current) { $('u').blur(); return; }
  const r = await window.pulse.urlGo(v).catch((err) => ({ ok: false, reason: err.message }));
  if (r && r.ok) $('u').blur(); else { $('u').value = v; $('u').title = (r && r.reason) || 'Não foi possível abrir este link.'; flash($('u'), false); }
});
$('copy').addEventListener('click', async () => {
  const ok = await window.pulse.urlCopy().catch(() => false);
  const b = $('copy'); b.textContent = ok ? 'Copiado ✓' : 'Sem link'; b.classList.toggle('ok', !!ok);
  setTimeout(() => { b.textContent = 'Copiar'; b.classList.remove('ok'); }, 1500);
});
$('hide').addEventListener('click', () => window.pulse.urlbarShow(false));
function flash(el, ok) { el.style.borderColor = ok ? '#2f7a4d' : '#b54848'; setTimeout(() => { el.style.borderColor = ''; }, 1500); }
