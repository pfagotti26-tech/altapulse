// Cartão do fã: mostra o que o fã gastou com a criadora atendida, a sugestão, ofertas pendentes e as
// anotações da equipe. Atualiza sozinho quando o chatter troca de conversa. Nada do faturamento da criadora.
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => c == null ? '—' : 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyShort = (c) => c == null ? '—' : c >= 100000 ? 'R$ ' + Math.round(c / 100).toLocaleString('pt-BR') : money(c);
const dur = (sec) => { if (sec == null) return '—'; const m = Math.round(sec / 60); if (m < 1) return 'menos de 1 min'; if (m < 60) return `${m} min`; const h = Math.floor(m / 60); return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`; };
const day = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
const ORIGIN = { chat: 'Chat', subscription: 'Assinatura', renewal: 'Renovação', post: 'Publicação', tip: 'Mimo', unknown: 'Outro' };
const TIER = { baleia: ['Baleia', 'gold'], spender: ['Spender', 'green'] };
const TAG = { esfriando: ['Esfriando', 'amber'], dormente: ['Dormente', ''], novo_sem_compra: ['Novo sem compra', 'green'], assinatura_inativa: ['Assinatura inativa', 'red'] };
let F = null; let draft = '';

function render() {
  const collapsed = !!(F && F.collapsed);
  $('collapsed').classList.toggle('hidden', !collapsed); $('panel').classList.toggle('hidden', collapsed);
  $('collapsed').classList.toggle('has-fan', !!(F && F.fanRef && F.active));
  if (collapsed) return;
  const c = F && F.card;
  $('av').textContent = F && F.name ? F.name.trim()[0].toUpperCase() : '?';
  $('name').textContent = F && F.name ? F.name : 'Cartão do fã';
  let chips = '';
  if (c && (F.subAtiva === true || F.subAtiva === false)) {
    // a própria conversa da Privacy diz se é assinante (aviso no rodapé): vale mais que a lista lida de horas atrás
    const sub = c.subscription || {};
    c.subscription = { ...sub, active: F.subAtiva, status: F.subAtiva ? 'Ativa' : (sub.active === false && sub.status ? sub.status : 'Não assinante') };
    c.tags = (c.tags || []).filter((t) => t !== 'assinatura_inativa');
    if (!F.subAtiva) c.tags.push('assinatura_inativa');
  } else if (c && F.chatting && c.subscription && c.subscription.active === false) {
    // conversando hoje/ontem = tem acesso; a linha "inativa" da lista é de uma assinatura antiga
    c.subscription = { ...c.subscription, status: null, active: null }; c.tags = (c.tags || []).filter((t) => t !== 'assinatura_inativa');
  }
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
  // esperando resposta agora (conta ao vivo) e tempo de resposta com este fã
  if (F.waitSince) { const sec = (Date.now() - new Date(F.waitSince).getTime()) / 1000; const late = sec > (F.sla || 5) * 60;
    h += `<div class="wait ${late ? 'late' : ''}">Esperando sua resposta há <b>${dur(sec)}</b>${late ? ' · acima da meta' : ''}</div>`; }
  if (c.response) { const r = c.response; const parts = [];
    if (r.mine_avg_seconds != null) parts.push(`seu tempo médio: <b>${dur(r.mine_avg_seconds)}</b>`);
    parts.push(`equipe: <b>${dur(r.avg_seconds)}</b>`);
    if (r.last_seconds != null) parts.push(`última: ${dur(r.last_seconds)}`);
    h += `<div class="resp">Resposta a este fã (30 dias) · ${parts.join(' · ')}</div>`; }
  const subLine = c.subscription && (c.subscription.status || c.subscription.price_cents != null) ? `Assinatura${c.subscription.status ? `: <b>${esc(c.subscription.status)}</b>` : ''}${c.subscription.price_cents != null ? ` · ${money(c.subscription.price_cents)}` : ''}${c.subscription.duration ? ` · ${esc(c.subscription.duration)}` : ''}<br>` : '';
  if (!c.purchases) h += `<div class="sub">${subLine}Primeira compra ainda não registrada.</div>`;
  else h += `<div class="nums"><div><span>Gasto total</span><b>${moneyShort(c.total_cents)}</b></div><div><span>Ticket médio</span><b>${moneyShort(c.ticket_cents)}</b></div><div><span>Última compra</span><b>${c.days_since_last === 0 ? 'hoje' : `há ${c.days_since_last} d`}</b></div></div>`;
  if (c.suggestion) h += `<div class="tip"><b>Sugestão:</b> ${esc(c.suggestion)}</div>`;
  const OT = { request: 'Solicitação de mídia', ppv: 'Mídia paga' }; const MT = { photo: 'foto', video: 'vídeo', mixed: 'foto e vídeo' };
  for (const o of c.pending_offers || []) h += `<div class="pend">${OT[o.offer_type] || 'Oferta'}${MT[o.media_type] ? ` (${MT[o.media_type]})` : ''} de ${money(o.amount_cents)} ainda não paga · enviada ${day(o.offered_at)}</div>`;
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
$('collapse').addEventListener('dblclick', () => window.pulse.fanCollapse('auto'));
window.pulse.onFan((f) => {
  // não re-renderiza enquanto o chatter digita uma anotação (evita perder o foco)
  const typing = document.activeElement && document.activeElement.id === 'note' && F && f.fanRef === F.fanRef;
  if (!F || f.fanRef !== F.fanRef) draft = '';
  F = f; if (!typing) render();
});
render();
// o "esperando há" anda sozinho; não re-renderiza enquanto digita uma anotação
setInterval(() => { if (F && F.waitSince && !(document.activeElement && document.activeElement.id === 'note')) render(); }, 30000);
