// Cartão do fã: mostra o que o fã gastou com a criadora atendida, a sugestão, ofertas pendentes e as
// anotações da equipe. Atualiza sozinho quando o chatter troca de conversa. Nada do faturamento da criadora.
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => c == null ? '—' : 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyShort = (c) => c == null ? '—' : c >= 100000 ? 'R$ ' + Math.round(c / 100).toLocaleString('pt-BR') : money(c);
const day = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
const ORIGIN = { chat: 'Chat', subscription: 'Assinatura', renewal: 'Renovação', post: 'Publicação', tip: 'Mimo', unknown: 'Outro' };
const TIER = { baleia: ['Baleia', 'gold'], spender: ['Spender', 'green'] };
const TAG = { esfriando: ['Esfriando', 'amber'], dormente: ['Dormente', ''], novo_sem_compra: ['Novo sem compra', 'green'], assinatura_inativa: ['Assinatura inativa', 'red'] };
let F = null; let draft = '';

function render() {
  const collapsed = !!(F && F.collapsed);
  $('collapsed').classList.toggle('hidden', !collapsed); $('panel').classList.toggle('hidden', collapsed);
  if (collapsed) return;
  const c = F && F.card;
  $('av').textContent = F && F.name ? F.name.trim()[0].toUpperCase() : '?';
  $('name').textContent = F && F.name ? F.name : 'Cartão do fã';
  let chips = '';
  if (c) {
    if (TIER[c.tier]) chips += `<span class="chip ${TIER[c.tier][1]}">${TIER[c.tier][0]}</span>`;
    for (const t of c.tags || []) if (TAG[t]) chips += `<span class="chip ${TAG[t][1]}">${TAG[t][0]}${t === 'esfriando' && c.days_since_last != null ? ` · ${c.days_since_last} dias` : ''}</span>`;
    if (c.subscription && c.subscription.active) chips += '<span class="chip green">Assinante ativo</span>';
  }
  $('chips').innerHTML = chips;
  const b = $('body');
  if (!F || !F.active || !F.fanRef) {
    b.innerHTML = `<div class="empty">${F && F.error ? esc(F.error) : 'Abra uma conversa da Privacy para ver quem é o fã: quanto já gastou, o que costuma comprar e as anotações da equipe.'}</div>`;
    return;
  }
  if (!c) { b.innerHTML = `<div class="empty">${F.error ? esc(F.error) : 'Carregando o cartão…'}</div>`; return; }
  let h = '';
  if (!c.purchases) h += `<div class="sub">${c.subscription ? `Assinatura: <b>${esc(c.subscription.status || '—')}</b>${c.subscription.price_cents != null ? ` · ${money(c.subscription.price_cents)}` : ''}${c.subscription.duration ? ` · ${esc(c.subscription.duration)}` : ''}<br>` : ''}Primeira compra ainda não registrada.</div>`;
  else h += `<div class="nums"><div><span>Gasto total</span><b>${moneyShort(c.total_cents)}</b></div><div><span>Ticket médio</span><b>${moneyShort(c.ticket_cents)}</b></div><div><span>Última compra</span><b>${c.days_since_last === 0 ? 'hoje' : `há ${c.days_since_last} d`}</b></div></div>`;
  if (c.suggestion) h += `<div class="tip"><b>Sugestão:</b> ${esc(c.suggestion)}</div>`;
  for (const o of c.pending_offers || []) h += `<div class="pend">Oferta de ${money(o.amount_cents)} ainda não paga · enviada ${day(o.offered_at)}</div>`;
  if (c.task) h += `<div class="sub">Na sua lista${c.task.reason ? `: ${esc(c.task.reason)}` : ''}.<br><button class="btn" id="contacted" style="width:100%;margin-top:6px">Marcar como contatado</button></div>`;
  if ((c.recent || []).length) { h += '<div class="sec">Últimas compras</div>'; for (const r of c.recent) h += `<div class="row"><span>${day(r.at)} · ${ORIGIN[r.origin] || 'Outro'}</span>${money(r.amount_cents)}</div>`; }
  h += '<div class="sec">Anotações da equipe</div>';
  for (const n of c.notes || []) {
    const mine = F.user && (n.author_id === F.user.id || F.user.role === 'manager');
    h += `<div class="note">${esc(n.text)}<small>${esc(n.author_name)} · ${day(n.created_at)}</small>${mine ? `<button class="icon del" data-del="${esc(n.id)}" title="Apagar">×</button>` : ''}</div>`;
  }
  if (!(c.notes || []).length) h += '<div class="muted">Nenhuma anotação ainda.</div>';
  h += `<textarea id="note" maxlength="300" placeholder="Escrever anotação (Enter salva)">${esc(draft)}</textarea><div class="muted" style="font-size:10px">Nada de telefone, endereço ou dado de saúde.</div>`;
  if (F.loading) h += '<div class="loading">atualizando…</div>';
  b.innerHTML = h;
  const ta = $('note');
  ta.addEventListener('input', () => { draft = ta.value; });
  ta.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return; e.preventDefault();
    const text = ta.value.trim(); if (!text) return;
    ta.disabled = true;
    try { await window.pulse.fanNoteAdd(text); draft = ''; } catch (err) { alertLine(err.message); } finally { ta.disabled = false; }
  });
  b.querySelectorAll('[data-del]').forEach((x) => x.addEventListener('click', () => window.pulse.fanNoteDel(x.dataset.del).catch((err) => alertLine(err.message))));
  const ct = $('contacted'); if (ct) ct.addEventListener('click', () => window.pulse.fanContacted(c.task.id).catch((err) => alertLine(err.message)));
}
function alertLine(msg) { const d = document.createElement('div'); d.className = 'pend'; d.textContent = String(msg).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); $('body').prepend(d); setTimeout(() => d.remove(), 5000); }

$('collapse').addEventListener('click', () => window.pulse.fanCollapse(true));
$('collapsed').addEventListener('click', () => window.pulse.fanCollapse(false));
window.pulse.onFan((f) => {
  // não re-renderiza enquanto o chatter digita uma anotação (evita perder o foco)
  const typing = document.activeElement && document.activeElement.id === 'note' && F && f.fanRef === F.fanRef;
  if (!F || f.fanRef !== F.fanRef) draft = '';
  F = f; if (!typing) render();
});
render();
