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
const open = (() => { try { return JSON.parse(localStorage.getItem('fan-open') || '{}'); } catch { return {}; } })();
const isOpen = (k, def) => (k in open ? open[k] : def);
const toggle = (k, def) => { open[k] = !isOpen(k, def); try { localStorage.setItem('fan-open', JSON.stringify(open)); } catch {} render(); };
let noteOpen = false;
// Alta Ajuda (um bloco só): sugestão de mensagem na voz da criadora, a partir do fim da conversa.
// Automática quando a ficha liga "sugestão automática" e o fã falou por último; nas outras, o chatter clica em Sugerir.
// O chatter edita aqui ou na caixa da Privacy e envia. Nada é enviado pelo sistema.
const LV = [['leve', 'Leve'], ['picante', 'Picante'], ['explicito', 'Explícito']];
const AJ_HELP = 'Como usar: quando o fã fala por último, a Alta Ajuda lê o fim da conversa e sugere a resposta na voz da criadora, no tom do perfil do fã. Edite o texto aqui se quiser, clique em Colocar na caixa e envie pela Privacy. Leve/Picante/Explícito refaz a sugestão nesse nível; Outra gera outra versão; Mais vendedora puxa para a oferta. Classifique o fã (Servo, Cuck, Baunilha…) para acertar o tom: vale para a equipe toda.';
const STEP = { abertura: 'Abertura', aquecimento: 'Aquecimento', oferta: 'Oferta', fechamento: 'Fechamento', 'pos-venda': 'Pós-venda', reativacao: 'Reativação' };
let AS = null, asFor = null, aj = { help: false, sheet: false, sheetData: null, sheetFor: null };
async function loadAssist(force) {
  const key = F && F.creatorId; if (!key) return;
  if (!force && asFor === key && AS) return;
  asFor = key; AS = await window.pulse.assistStatus(force).catch(() => null); render(); loadSeg(); maybeSuggest();
}
// perfil do fã (classificação da equipe)
let SEG = { for: null, value: '', by: null, busy: false };
const segList = () => (AS && AS.segments) || [];
const fanKey = () => (F && F.creatorId && F.fanRef) ? `${F.creatorId}|${F.fanRef}` : null;
async function loadSeg() {
  const k = fanKey(); if (!k || !segList().length || SEG.for === k || SEG.loading === k) return;
  SEG = { for: null, value: '', by: null, loading: k };
  const r = await window.pulse.fanSegGet().catch(() => ({ segment: '' }));
  if (fanKey() !== k) return;
  SEG = { for: k, value: r.segment || '', by: r.by || null }; renderAssist(); maybeSuggest();
}
async function setSeg(value) {
  const k = fanKey(); if (!k) return;
  const prev = SEG.value; SEG = { ...SEG, value, busy: true }; renderAssist();
  try { const r = await window.pulse.fanSegSet(value); if (fanKey() === k) SEG = { for: k, value: r.segment || '', by: r.by || null }; }
  catch (err) { SEG = { ...SEG, value: prev }; alertLine(err.message); }
  SEG.busy = false; renderAssist();
  if (SG.key && SG.key.startsWith(k)) runSuggest(SG.key, {}); // refaz no tom do novo perfil
}
function segHtml() {
  const list = segList(); if (!list.length) return '';
  const ready = SEG.for === fanKey();
  const dflt = list.find((x) => x.default) || list[0];
  const tip = SEG.value ? `Classificado${SEG.by ? ` por ${SEG.by}` : ''}. Clique de novo para tirar.` : `Sem classificação: a sugestão usa ${dflt.label}.`;
  return `<div class="seg" title="${esc(tip)}"><span>Perfil do fã</span>${list.map((x) => `<button class="seg-b${ready && SEG.value === x.key ? ' on' : ''}" data-seg="${esc(x.key)}" ${!ready || SEG.busy ? 'disabled' : ''}>${esc(x.label)}</button>`).join('')}</div>`;
}
// sugestão: uma por fã e momento da conversa
let SG = { key: null }, sgTimer = null;
const baseKey = () => (AS && AS.manual && F && F.active && F.fanRef && !F.collapsed && (!segList().length || SEG.for === fanKey())) ? `${F.creatorId}|${F.fanRef}|${F.waitSince || 'nossa'}` : null;
function maybeSuggest() {
  const k = baseKey();
  if (!k) { if (SG.key) { SG = { key: null }; renderAssist(); } return; }
  if (SG.key === k) return;
  SG = { key: k }; // conversa nova ou o fã falou de novo: limpa a sugestão anterior
  if (AS.suggest && F.waitSince) { SG.busy = true; clearTimeout(sgTimer); sgTimer = setTimeout(() => runSuggest(k, {}), 600); }
  renderAssist();
}
async function runSuggest(k, { style, level } = {}) {
  if (SG.key !== k) return;
  const mode = F && F.waitSince ? 'reply' : 'followup';
  SG = { key: k, busy: true, level: level || SG.level }; renderAssist();
  try {
    const res = await window.pulse.assistSuggest({ style, level, mode });
    if (SG.key !== k) return;
    if (res && res.skip) { SG = { key: k }; renderAssist(); return; }
    SG = { key: k, res, text: res.text || '', level: res.level }; if (res && res.remaining != null && AS) AS.remaining = res.remaining;
  } catch (err) { if (SG.key !== k) return; SG = { key: k, err: String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }; }
  renderAssist();
}

function render() {
  const typing = document.activeElement && document.activeElement.id;
  if (typing !== 'note') renderBody();
  if (typing !== 'aj-text') renderAssist();
}
function renderBody() {
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
    b.innerHTML = `<div class="empty">${F && F.error ? esc(F.error) : 'Abra uma conversa (Privacy, OnlyFans ou FatalFans) para ver quem é o fã: quanto já gastou, o que costuma comprar e as anotações da equipe.'}</div>`;
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
  const recent = c.recent || [];
  if (recent.length) {
    const o = isOpen('buys', true);
    h += `<button class="sec-t" data-tg="buys">${o ? '▾' : '▸'} Últimas compras <span>${recent.length}</span></button>`;
    if (o) for (const r of recent) h += `<div class="row"><span>${day(r.at)} · ${ORIGIN[r.origin] || 'Outro'}</span>${money(r.amount_cents)}</div>`;
  }
  const notes = c.notes || []; const on = isOpen('notes', notes.length > 0) || noteOpen;
  h += `<div class="sec-row"><button class="sec-t" data-tg="notes">${on ? '▾' : '▸'} Anotações da equipe <span>${notes.length}</span></button><button class="icon add-note" id="add-note" title="Escrever uma anotação sobre este fã para a equipe">+ anotação</button></div>`;
  if (on) {
    for (const n of notes) {
      const mine = F.user && (n.author_id === F.user.id || F.user.role !== 'chatter');
      h += `<div class="note">${esc(n.text)}<small>${esc(n.author_name)} · ${day(n.created_at)}</small>${mine ? `<button class="icon del" data-del="${esc(n.id)}" title="Apagar">×</button>` : ''}</div>`;
    }
    if (!notes.length && !noteOpen) h += '<div class="muted">Nenhuma anotação ainda.</div>';
  }
  if (noteOpen || draft) h += `<textarea id="note" maxlength="300" placeholder="Escrever anotação (Enter salva, Esc cancela)">${esc(draft)}</textarea><div class="muted" style="font-size:10px">Nada de telefone, endereço ou dado de saúde.</div>`;
  if (F.loading) h += '<div class="loading">atualizando…</div>';
  b.innerHTML = h;
  b.querySelectorAll('[data-tg]').forEach((x) => x.addEventListener('click', () => toggle(x.dataset.tg, x.dataset.tg === 'buys' ? true : notes.length > 0)));
  $('add-note').addEventListener('click', () => { noteOpen = true; open.notes = true; render(); const t = $('note'); if (t) t.focus(); });
  const ta = $('note');
  if (ta) ta.addEventListener('input', () => { draft = ta.value; });
  if (ta) ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { noteOpen = false; draft = ''; render(); } });
  if (ta) ta.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return; e.preventDefault();
    const text = ta.value.trim(); if (!text) return;
    ta.disabled = true;
    try { await window.pulse.fanNoteAdd(text); draft = ''; noteOpen = false; } catch (err) { alertLine(err.message); } finally { ta.disabled = false; }
  });
  b.querySelectorAll('[data-del]').forEach((x) => x.addEventListener('click', () => window.pulse.fanNoteDel(x.dataset.del).catch((err) => alertLine(err.message))));
  const ct = $('contacted'); if (ct) ct.addEventListener('click', () => window.pulse.fanContacted(c.task.id).catch((err) => alertLine(err.message)));
}
function renderAssist() {
  const box = $('assist');
  const show = !!(AS && AS.enabled && F && F.active && F.fanRef && !F.collapsed);
  box.classList.toggle('hidden', !show);
  if (!show) { box.innerHTML = ''; return; }
  if (aj.sheetFor !== F.creatorId) aj = { ...aj, sheet: false, sheetData: null, sheetFor: F.creatorId };
  let h = `<div class="aj-head"><b>Alta Ajuda</b><span class="aj-meta">${!AS.has_prices ? '<span class="aj-warn" title="Esta criadora ainda não tem tabela de preços. Valores aparecem como [preço]. O gestor preenche na ficha (painel → Criadoras).">sem tabela</span>' : ''}<span class="muted" title="Ajudas que você ainda pode pedir hoje">${AS.remaining} hoje</span><button class="icon aj-sheet${aj.sheet ? ' on' : ''}" id="aj-sheet" title="Ficha da criadora: persona, limites e tabela de preços">▦</button><button class="icon aj-q" id="aj-help" title="${esc(AJ_HELP)}">?</button></span></div>`;
  if (aj.help) h += `<div class="aj-help">${esc(AJ_HELP)}</div>`;
  if (aj.sheet) h += sheetHtml();
  h += segHtml();
  if (!AS.manual) { box.innerHTML = h + '<div class="muted aj-note">A ficha desta criadora ainda não foi preenchida no painel.</div>'; bindAssist(); return; }
  const r = SG.res;
  const lvMax = Math.max(0, LV.findIndex(([v]) => v === ((r && r.max_level) || AS.max_level)));
  if (SG.busy) h += '<div class="sg-meta">Lendo a conversa e escrevendo na voz da criadora…</div>';
  else if (SG.err) h += `<div class="pend">${esc(SG.err)}</div>`;
  else if (r && r.alert) h += `<div class="tip"><b>Atenção:</b> possível menor de idade (${esc(r.reason)}). Nada foi gerado e o gestor foi avisado. Não ofereça conteúdo.</div>`;
  else if (r) {
    const meta = [STEP[r.step] ? `Passo: ${STEP[r.step]}` : '', r.objection ? `objeção: ${r.objection}` : ''].filter(Boolean).join(' · ');
    if (meta) h += `<div class="sg-meta">${esc(meta)}</div>`;
    h += `<textarea id="aj-text" rows="3" maxlength="1500" title="Edite à vontade antes de colocar na caixa">${esc(SG.text)}</textarea>`;
    if (r.warning) h += `<div class="sg-warn">${esc(r.warning)}</div>`;
    const sug = r.suggested_segment && !SEG.value && segList().find((x) => x.key === r.suggested_segment);
    if (sug) h += `<div class="sg-seg">Parece <b>${esc(sug.label)}</b>. <button class="btn ghost" id="sg-class" data-k="${esc(sug.key)}">Classificar como ${esc(sug.label)}</button></div>`;
    if (r.price_fixed) h += '<div class="muted aj-note">Um valor fora da tabela virou [preço]. Complete antes de enviar.</div>';
  } else {
    h += `<button class="btn aj-go" id="sg-start" style="width:100%">${F.waitSince ? 'Sugerir resposta' : 'Sugerir mensagem para puxar conversa'}</button>`;
  }
  if (r && !r.alert && !SG.busy) {
    h += `<div class="aj-levels" title="Refaz a sugestão nesse nível. O máximo é o da ficha.">${LV.slice(0, lvMax + 1).map(([v, l]) => `<button class="aj-lv ${v === SG.level ? 'on' : ''}" data-lv="${v}">${l}</button>`).join('')}</div>`;
    h += '<div class="sg-act"><button class="btn" id="sg-use" title="Coloca na caixa de mensagem da Privacy. Revise e envie.">Colocar na caixa</button><button class="btn ghost" id="sg-again">Outra</button><button class="btn ghost" id="sg-sell" title="Outra versão puxando para a venda">Mais vendedora</button></div>';
  } else if (SG.err) h += '<div class="sg-act"><button class="btn ghost" id="sg-again">Tentar de novo</button></div>';
  box.innerHTML = h;
  const ta = $('aj-text');
  if (ta) { const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; }; grow(); ta.addEventListener('input', () => { SG.text = ta.value; grow(); }); }
  bindAssist();
}

// ficha da criadora (preenchida pelo gestor no painel): preços primeiro, depois limites e persona
const brl = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',').replace(',00', '');
function sheetHtml() {
  const p = aj.sheetData;
  if (!p) return '<div class="aj-sheetbox muted">Carregando a ficha…</div>';
  if (p.error) return `<div class="aj-sheetbox pend">${esc(p.error)}</div>`;
  let s = '<div class="aj-sheetbox">';
  if ((p.prices || []).length) s += `<div class="aj-st">Preços mínimos</div><table class="aj-prices">${p.prices.map((x) => `<tr><td>${esc(x.item)}</td><td>${brl(x.cents)}</td></tr>${x.obs ? `<tr><td colspan="2" class="muted">${esc(x.obs)}</td></tr>` : ''}`).join('')}</table>`;
  else s += '<div class="muted">Sem tabela de preços.</div>';
  if (p.limits) s += `<div class="aj-st">Não faz</div><div>${esc(p.limits)}</div>`;
  for (const f of p.fields || []) s += `<div class="aj-st">${esc(f.label)}</div><div>${esc(f.value)}</div>`;
  if (!(p.fields || []).length && !p.limits) s += '<div class="muted">A ficha ainda não foi preenchida no painel.</div>';
  return s + '</div>';
}
function bindAssist() {
  const sh = $('aj-sheet'); if (sh) sh.addEventListener('click', async () => {
    aj.sheet = !aj.sheet; if (aj.sheet) { aj.sheetData = null; renderAssist(); try { aj.sheetData = await window.pulse.assistProfile(); } catch (err) { aj.sheetData = { error: err.message }; } }
    renderAssist();
  });
  const help = $('aj-help'); if (help) help.addEventListener('click', () => { aj.help = !aj.help; renderAssist(); });
  document.querySelectorAll('#assist [data-seg]').forEach((x) => x.addEventListener('click', () => setSeg(SEG.value === x.dataset.seg ? '' : x.dataset.seg)));
  const k = SG.key || baseKey();
  const start = $('sg-start'); if (start) start.addEventListener('click', () => { if (!SG.key) SG = { key: k }; runSuggest(SG.key, {}); });
  document.querySelectorAll('[data-lv]').forEach((b) => b.addEventListener('click', () => runSuggest(SG.key, { level: b.dataset.lv })));
  const again = $('sg-again'); if (again) again.addEventListener('click', () => runSuggest(SG.key, { level: SG.level }));
  const sell = $('sg-sell'); if (sell) sell.addEventListener('click', () => runSuggest(SG.key, { style: 'vendedora', level: SG.level }));
  const cl = $('sg-class'); if (cl) cl.addEventListener('click', () => setSeg(cl.dataset.k));
  const use = $('sg-use'); if (use) use.addEventListener('click', async () => {
    const text = ($('aj-text') ? $('aj-text').value : SG.text) || ''; if (!text.trim()) return;
    const r = await window.pulse.assistUse(text).catch(() => ({ filled: false }));
    use.textContent = r.filled ? 'Na caixa da Privacy' : 'Copiado (Ctrl+V)';
  });
}

function alertLine(msg) { const d = document.createElement('div'); d.className = 'pend'; d.textContent = String(msg).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); $('body').prepend(d); setTimeout(() => d.remove(), 5000); }

$('collapse').addEventListener('click', () => window.pulse.fanCollapse(true));
$('collapsed').addEventListener('click', () => window.pulse.fanCollapse(false));
$('collapse').addEventListener('dblclick', () => window.pulse.fanCollapse('auto'));
window.pulse.onFan((f) => {
  // não re-renderiza enquanto o chatter digita uma anotação (evita perder o foco)
  if (!F || f.fanRef !== F.fanRef) { draft = ''; noteOpen = false; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
  F = f; render(); loadAssist(); loadSeg(); maybeSuggest();
});
render();
// o "esperando há" anda sozinho; não re-renderiza enquanto digita uma anotação
setInterval(() => { if (F && F.waitSince && !(document.activeElement && document.activeElement.id === 'note')) render(); }, 30000);
