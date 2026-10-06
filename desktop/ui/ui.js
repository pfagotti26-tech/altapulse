'use strict';
const $ = (id) => document.getElementById(id);
let S = null;               // último estado vindo do processo principal
const closedGroups = new Set(JSON.parse(localStorage.getItem('closedGroups') || '[]'));
// painel lateral: cada bloco pode estar aberto, minimizado ('min') ou oculto ('off'); fica salvo por usuário neste computador
const PANEL0 = { search: 'open', turn: 'open', filter: 'open', opps: 'open', focus: false };
let panel = { ...PANEL0 };
const panelKey = () => `alta-panel:${(S.user && S.user.id) || 'anon'}`;
function loadPanel() { try { panel = { ...PANEL0, ...JSON.parse(localStorage.getItem(panelKey()) || '{}') }; } catch { panel = { ...PANEL0 }; } }
function savePanel() { try { localStorage.setItem(panelKey(), JSON.stringify(panel)); } catch {} }
function blkState(k) { return panel.focus ? 'off' : panel[k]; }
function setBlk(k, v) { panel[k] = v; savePanel(); applyPanel(); }
function applyPanel() {
  document.body.classList.toggle('focus', !!panel.focus);
  const st = { search: blkState('search'), turn: blkState('turn'), filter: blkState('filter'), opps: blkState('opps') };
  $('blk-search').classList.toggle('hidden', st.search !== 'open');
  $('btn-search').classList.toggle('hidden', st.search === 'open');
  $('my-shift').classList.toggle('gone', st.turn === 'off'); $('my-shift').classList.toggle('min', st.turn === 'min');
  $('blk-filter').classList.toggle('hidden', st.filter !== 'open');
  // filtro minimizado: chip na linha do turno; sem a linha do turno, vira um botãozinho no topo
  $('btn-filter').classList.toggle('hidden', !(st.filter === 'min' && st.turn === 'off'));
  $('btn-filter').classList.toggle('on', $('only-open').checked);
  $('my-opps').classList.toggle('min', st.opps === 'min'); $('my-opps').classList.toggle('gone', st.opps === 'off');
  $('btn-opps').classList.toggle('hidden', !(st.opps === 'off' && (S.opportunities || []).length));
  $('menu-turn-start').classList.toggle('hidden', !(st.turn === 'off' && S.user && myTurn().state === 'off'));
  $('menu-turn-end').classList.toggle('hidden', !(st.turn === 'off' && S.user && myTurn().state !== 'off'));
  renderTurn(); renderOpps();
}
function toggleFocus() { panel.focus = !panel.focus; savePanel(); applyPanel(); toast(panel.focus ? 'Modo foco: só a lista de criadoras (Ctrl+Shift+M volta).' : 'Painel completo de volta.', 2500); }
function panelDialog() {
  const row = (k, label, hint) => `<label class="pl-row"><span><b>${label}</b><small>${hint}</small></span><select data-pl="${k}"><option value="open" ${panel[k] === 'open' ? 'selected' : ''}>Mostrar</option><option value="min" ${panel[k] === 'min' ? 'selected' : ''}>Minimizado</option><option value="off" ${panel[k] === 'off' ? 'selected' : ''}>Oculto</option></select></label>`;
  dialog({ title: 'Painel lateral', hideOk: true, body: `<p class="muted">Escolha o que aparece acima da lista de criadoras. Vale só para você, neste computador.</p>`
    + row('search', 'Busca e ordem', 'minimizado vira uma lupa no topo') + row('turn', 'Turno', 'oculto: iniciar/encerrar ficam no menu ⋮') + row('filter', 'Somente em atendimento', 'minimizado vira um chip na linha do turno') + row('opps', 'Oportunidades', 'oculto: fica um ícone no topo com as quentes')
    + `<label class="pl-row"><span><b>Modo foco</b><small>esconde tudo de uma vez · Ctrl+Shift+M</small></span><input type="checkbox" data-pl="focus" ${panel.focus ? 'checked' : ''}></label>` });
  $('dialog-body').querySelectorAll('[data-pl]').forEach((el) => el.addEventListener('change', () => { if (el.dataset.pl === 'focus') panel.focus = el.checked; else panel[el.dataset.pl] = el.value; savePanel(); applyPanel(); }));
}
document.addEventListener('click', (e) => { const b = e.target.closest('.blk-min'); if (!b) return; e.preventDefault(); e.stopPropagation(); setBlk(b.dataset.blk, 'min'); }, true);

// ---------- utilidades ----------
function toast(msg, ms = 3500) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), ms); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
async function run(fn, okMsg) {
  try { const r = await fn(); if (r && r.creators) apply(r); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
}
function hideMenus() { $('app-menu').classList.add('hidden'); $('creator-menu').classList.add('hidden'); }
document.addEventListener('click', (e) => { if (!e.target.closest('.popover') && !e.target.closest('.cmenu') && !e.target.closest('#btn-menu') && !e.target.closest('.gmenu')) hideMenus(); });
// fora da lateral (página da plataforma, cartão do fã), Esc, rolagem ou janela sem foco: fecha os menus
window.addEventListener('blur', hideMenus);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenus(); });
document.addEventListener('scroll', (e) => { if (!(e.target.closest && e.target.closest('.popover'))) hideMenus(); }, true);
if (window.pulse.onMenusHide) window.pulse.onMenusHide(hideMenus);

function dialog({ title, body, okText = 'OK', onOk, hideOk = false }) {
  return new Promise((resolve) => {
    $('dialog-title').textContent = title; $('dialog-body').innerHTML = body;
    $('dialog-ok').textContent = okText; $('dialog-ok').classList.toggle('hidden', hideOk);
    $('dialog').classList.remove('hidden');
    const close = (v) => { $('dialog').classList.add('hidden'); $('dialog-ok').onclick = null; $('dialog-cancel').onclick = null; $('dialog-x').onclick = null; $('dialog').onclick = null; document.removeEventListener('keydown', onKey); resolve(v); };
    // fecha com ×, Esc e clique fora da caixa
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey);
    $('dialog-ok').onclick = async () => { const v = onOk ? await onOk() : true; if (v !== false) close(v); };
    $('dialog-cancel').onclick = () => close(null);
    $('dialog-x').onclick = () => close(null);
    $('dialog').onclick = (e) => { if (e.target === $('dialog')) close(null); };
    // foco na própria janela (se a página da plataforma estiver com o foco, o Esc iria para ela)
    try { window.focus(); if (window.pulse.focusSidebar) window.pulse.focusSidebar(); } catch {}
    const first = $('dialog-body').querySelector('input, textarea'); if (first) first.focus(); else { $('dialog-x').focus(); }
  });
}

// ---------- estado ----------
// foto de perfil: imagem (data URL) ou iniciais
function setAvatar(el, src, name) {
  el.textContent = '';
  if (src && /^data:image\//.test(src)) { const img = document.createElement('img'); img.src = src; img.alt = ''; el.appendChild(img); }
  else el.textContent = initials(name || '?');
}
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Escolha uma imagem (JPG, PNG ou WebP).'));
    const r = new FileReader(); r.onerror = () => reject(new Error('Não consegui ler a imagem.'));
    r.onload = () => { const img = new Image(); img.onerror = () => reject(new Error('Imagem inválida.')); img.onload = () => {
      const side = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 256;
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
      let q = 0.85, out = c.toDataURL('image/jpeg', q); while (out.length > 110000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
      resolve(out); }; img.src = r.result; };
    r.readAsDataURL(file);
  });
}
async function photoMenu() {
  const has = S.user && S.user.avatar;
  if (!has) return $('me-photo').click();
  const p = dialog({ title: 'Sua foto', body: `<div class="photo-choice"><img src="${esc(S.user.avatar)}" alt=""><button class="primary" id="ph-change">Trocar foto</button><button class="ghost" id="ph-remove">Remover foto</button></div>`, hideOk: true });
  $('ph-change').onclick = () => { $('dialog-cancel').onclick(); $('me-photo').click(); };
  $('ph-remove').onclick = () => { $('dialog-cancel').onclick(); run(() => window.pulse.setAvatar(null), 'Foto removida.'); };
  await p;
}

// boas-vindas: a cada login (e a cada vez que o app abre já logado), primeiro nome + frase motivacional
let welcomedFor = null;
function showWelcome() {
  const old = document.getElementById('welcome'); if (old) old.remove();
  const box = document.createElement('div'); box.id = 'welcome'; box.className = 'welcome';
  const u = S.user; const ini = String(u.name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const photo = u.avatar ? `<img class="welcome-photo" src="${esc(u.avatar)}" alt="">` : `<div class="welcome-photo ini">${esc(ini)}</div>`;
  box.innerHTML = `<div class="welcome-card">${photo}<div class="welcome-hi">${esc(window.altaGreeting(u.name))}</div><p>${esc(window.altaNextPhrase(u.id))}</p><div class="welcome-sign">${esc(window.ALTA_SIGNATURE)}</div><button class="primary">Bora!</button></div>`;
  const close = () => { box.classList.add('out'); setTimeout(() => box.remove(), 250); };
  box.querySelector('button').onclick = close; box.onclick = (e) => { if (e.target === box) close(); };
  document.body.appendChild(box); setTimeout(close, 9000);
}
function apply(state) {
  S = state;
  const logged = !!(S && S.user);
  $('login').classList.toggle('hidden', logged);
  $('main').classList.toggle('hidden', !logged);
  $('origin').value = S.origin || '';
  if (!logged) { welcomedFor = null; return; }
  if (welcomedFor !== S.user.id && window.altaNextPhrase) { welcomedFor = S.user.id; showWelcome(); }
  $('me-name').textContent = S.user.name;
  setAvatar($('me-avatar'), S.user.avatar, S.user.name);
  if (!panel._for || panel._for !== S.user.id) { loadPanel(); panel._for = S.user.id; }
  $('me-role').textContent = S.user.role === 'manager' ? 'Gestor' : 'Chatter';
  // sem foto: sinal de + na bolinha e convite ao lado do cargo
  $('me-avatar').classList.toggle('nophoto', !S.user.avatar);
  if (!S.user.avatar) { const a = document.createElement('a'); a.href = '#'; a.className = 'photo-nudge'; a.textContent = 'Colocar sua foto'; a.onclick = (e) => { e.preventDefault(); photoMenu(); }; $('me-role').append(' · ', a); }
  const warn = S.warning || (S.open.length && !S.storage_allowed ? 'Métricas desligadas no painel: ative "armazenamento" em Configurações para registrar tempo de resposta e vendas.' : '');
  $('warning').textContent = warn; $('warning').classList.toggle('hidden', !warn);
  const openTasks = (S.tasks || []).filter((t) => t.status === 'open');
  $('my-list').classList.toggle('hidden', !openTasks.length);
  if (openTasks.length) { const byReason = {}; for (const t of openTasks) byReason[t.reason || 'fãs'] = (byReason[t.reason || 'fãs'] || 0) + 1; $('my-list').innerHTML = `<b>Minha lista · ${openTasks.length}</b><small>${esc(Object.entries(byReason).map(([r, n]) => `${n} ${r.toLowerCase()}`).join(' · '))}</small>`; }
  renderList(); renderZoom(); applyPanel();
}

function localOf(id) { return (S.local.creators && S.local.creators[id]) || {}; }
function tagOf(id) { const t = localOf(id).tag; return S.local.tags.find((x) => x.id === t) || null; }
function statusOf(c) {
  const mine = c.shift && c.shift.operator_id === S.user.id;
  if (c.shift && mine) return { cls: c.shift.paused ? 'paused' : 'mine', text: c.shift.paused ? 'Seu turno · pausado' : 'Você · em atendimento' };
  if (c.shift) return { cls: 'other', text: `${c.shift.operator_name} · em atendimento` };
  if (c.browser && c.browser.state === 'open') return { cls: 'other', text: `${c.browser.operator_name || 'Alguém'} · aba aberta` };
  return { cls: '', text: S.open.includes(c.id) ? 'Aberta aqui · sem turno' : 'Livre' };
}

// ---------- lista ----------
function renderList() {
  renderTurn();
  // total de conversas sem resposta (24 h) em todas as criadoras abertas: balão no topo
  const total = Object.values(S.readers || {}).reduce((n, r) => n + ((r && r.waitingRecent) || 0), 0);
  const tb = $('unread-total'); if (tb) { tb.textContent = total > 99 ? '99+' : String(total); tb.classList.toggle('hidden', !total); tb.title = `${total} conversa${total === 1 ? '' : 's'} sem resposta nas últimas 24 h`; }
  const q = $('search').value.trim().toLowerCase();
  const sort = $('sort').value;
  const onlyOpen = $('only-open').checked;
  let rows = S.creators.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.handle || '').toLowerCase().includes(q));
  if (onlyOpen) rows = rows.filter((c) => c.shift || S.open.includes(c.id));
  const by = { az: (a, b) => a.name.localeCompare(b.name), za: (a, b) => b.name.localeCompare(a.name),
    recent: (a, b) => b.created_at.localeCompare(a.created_at), old: (a, b) => a.created_at.localeCompare(b.created_at),
    tag: (a, b) => ((tagOf(a.id) || {}).name || 'zzz').localeCompare((tagOf(b.id) || {}).name || 'zzz') || a.name.localeCompare(b.name) };
  by.mine = (a, b) => { const o = myOrder(); const ia = o.has(a.id) ? o.get(a.id) : 1e6, ib = o.has(b.id) ? o.get(b.id) : 1e6; return ia - ib || a.name.localeCompare(b.name); };
  rows.sort(by[sort] || by.az);

  const groups = [...S.local.groups.map((g) => ({ id: g.id, name: g.name })), { id: '', name: 'Sem grupo' }];
  const list = $('list'); list.innerHTML = '';
  if (!rows.length) { list.innerHTML = `<p class="empty">${S.creators.length ? 'Nenhuma criadora com esse filtro.' : 'Nenhuma criadora liberada para você. Cadastre no painel ou peça acesso ao gestor.'}</p>`; return; }
  for (const g of groups) {
    const items = rows.filter((c) => { const gs = groupsOf(c.id); return g.id ? gs.includes(g.id) : !gs.length; });
    if (!items.length && g.id === '') continue;
    const el = document.createElement('div');
    el.className = 'group' + (closedGroups.has(g.id) ? ' closed' : '');
    el.innerHTML = `<div class="group-head" data-g="${esc(g.id)}"><span class="caret">▾</span><span>${esc(g.name)}</span><span class="count">${items.length}</span>${g.id ? `<button class="gmenu" data-g="${esc(g.id)}" title="Grupo">⋮</button>` : ''}</div><div class="cards"></div>`;
    const cards = el.querySelector('.cards');
    for (const c of items) { const k = card(c, items); if (sort === 'mine' && !q) dragCard(k, c, items); cards.appendChild(k); }
    list.appendChild(el);
  }
}

function card(c, groupItems) {
  const st = statusOf(c); const tag = tagOf(c.id);
  const rd = S.readers && S.readers[c.id];
  let queue = '';
  if (rd && rd.page === 'chat') {
    if (rd.waiting > 0) { const late = rd.oldestWaitMin != null && rd.oldestWaitMin > (S.sla_minutes || 5); const w = rd.oldestWaitMin; const wt = w == null ? '' : w < 60 ? ` · ${w} min` : ` · ${Math.floor(w / 60)} h${w % 60 ? ` ${w % 60} min` : ''}`; queue = `<div class="queue ${late ? 'late' : ''}">${rd.waiting} esperando${wt}</div>`; }
    else queue = '<div class="queue ok">fila zerada</div>';
  }
  const ex = S.extratos && S.extratos[c.id];
  if (ex && S.user && S.user.role === 'manager') {
    if (ex.error === 'login') queue += '<div class="queue">extrato: entre na Privacy</div>';
    else if (ex.error) queue += `<div class="queue late" title="${esc(ex.error)}">extrato: falha na leitura</div>`;
    else if (ex.readAt) { const cents = ex.todayCents || 0; queue += `<div class="queue ok" title="Extrato lido às ${new Date(ex.readAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${ex.rows || 0} linhas · ${ex.sent || 0} enviadas${ex.dropped ? ` · ${ex.dropped} não enviadas (armazenamento desligado)` : ''}${ex.rejected ? ` · ${ex.rejected} recusadas: ${esc(ex.lastReject || '')}` : ''}${ex.period ? ` · ${esc(ex.period)}` : ''}${ex.dbg ? ` · ${esc(ex.dbg)}` : ''}">hoje: ${ex.today || 0} venda${ex.today === 1 ? '' : 's'} · R$ ${(cents / 100).toFixed(2).replace('.', ',')}</div>`; }
  }
  // abas abertas desta criadora (uma por plataforma): chip clicável; bolinha vermelha = tela de login
  const openTabs = (S.tabs && S.tabs[c.id]) || []; const cur = S.activeTab && S.activeTab[c.id];
  const loginList = (S.loginPages && S.loginPages[c.id]) || [];
  const labelOf = (p) => (S.platforms && S.platforms[p] ? S.platforms[p].label : p);
  const hasCred = (p) => (S.credentials || []).some((x) => x.creator_id === c.id && x.platform === p);
  // tela de login + acesso salvo: o próprio chip vira o "Entrar" (e o clique no card também entra)
  const ent = S.entering && S.entering[c.id];
  const canEnter = (p) => loginList.includes(p) && hasCred(p) && !ent;
  const verr = S.vaultErrors && S.vaultErrors[c.id];
  if (verr && !ent && S.open.includes(c.id)) queue += `<div class="queue late" title="${esc(verr.reason)}">${esc(labelOf(verr.platform))}: não entrou · ${esc(verr.reason.split(':')[0])}</div>`;
  let chips = '';
  if (openTabs.length) chips = `<div class="chips">${openTabs.map((p) => `<span class="chip${p === cur && S.active === c.id ? ' on' : ''}${loginList.includes(p) ? ' login' : ''}${canEnter(p) || ent === p ? ' enter' : ''}${ent === p ? ' entering' : ''}" data-plat="${esc(p)}" title="${ent === p ? 'Entrando com o acesso salvo…' : canEnter(p) ? `Clique para entrar na ${esc(labelOf(p))} com o acesso salvo (a senha não aparece)` : loginList.includes(p) && !hasCred(p) ? 'Tela de login · sem acesso salvo (peça ao gestor para cadastrar no painel)' : 'Mostrar ' + esc(labelOf(p))}">${esc(labelOf(p))}${ent === p ? '<i class="chip-enter">Entrando…</i>' : canEnter(p) ? '<i class="chip-enter">Entrar</i>' : ''}<b class="chip-x" data-close="${esc(p)}" title="Fechar ${esc(labelOf(p))}">×</b></span>`).join('')}<span class="chip add" data-plat="+" title="Abrir outra plataforma neste perfil">+</span></div>`;
  const pi = S.probeInfo && S.probeInfo[c.id];
  if (!loginList.length && pi && S.user && S.user.role === 'manager' && S.open.includes(c.id)) queue += `<div class="queue" style="opacity:.5" title="${esc(JSON.stringify(pi))}">${pi.error ? 'sonda: erro' : pi.platform ? `${esc(pi.platform)} · ${pi.hasPassword ? 'login' : 'sem login'}` : 'fora das plataformas'}</div>`;
  // botão de turno sempre à vista: "Iniciar turno" vira "Encerrar turno" (e "Pausar/Retomar") enquanto o turno é seu
  const mine = c.shift && c.shift.operator_id === S.user.id;
  // turno: um botão único na barra "Meu turno" (topo); exceções pelo ⋮ da criadora
  const shiftBtn = '';
  const el = document.createElement('div');
  // cards compactos (nome + status); a criadora aberta na tela mostra os detalhes
  const compact = S.active !== c.id;
  el.className = 'card' + (S.open.includes(c.id) ? ' open' : '') + (S.active === c.id ? ' active' : '') + (compact ? ' compact' : '');
  let inds = '';
  if (compact) {
    if (loginList.length) inds += `<span class="ind login" title="${esc(loginList.map(labelOf).join(', '))}: tela de login. Clique na criadora para entrar."></span>`;
    if (ex && ex.error && S.user && S.user.role === 'manager') inds += `<span class="ind warn" title="${ex.error === 'login' ? 'Extrato: entre na Privacy' : 'Extrato: falha na leitura'}"></span>`;
  }
  el.dataset.id = c.id;
  // setinhas ▲▼ para mudar a posição dentro do grupo (aparecem ao passar o mouse); mesma lógica do arrastar
  let steps = '', sib = [];
  if (groupItems && groupItems.length > 1) {
    const ord = fullOrder(); sib = [...groupItems].sort((a, b) => ord.indexOf(a.id) - ord.indexOf(b.id));
    const i = sib.findIndex((x) => x.id === c.id);
    steps = `<span class="steps"><button class="step" data-step="-1" title="Subir uma posição" ${i > 0 ? '' : 'disabled'}>▲</button><button class="step" data-step="1" title="Descer uma posição" ${i >= 0 && i < sib.length - 1 ? '' : 'disabled'}>▼</button></span>`;
  }
  // quem mais está neste perfil agora (outros chatters/gestor com a criadora aberta no app)
  const vw = c.viewers || [];
  const viewers = vw.length ? `<div class="viewers${vw.some((v) => v.active) ? ' on' : ''}" title="${esc(vw.map((v) => `${v.name}${v.active ? ' (na tela agora)' : ' (aberta em segundo plano)'}`).join(' · '))}">👀 ${esc(vw.map((v) => v.name.split(' ')[0]).slice(0, 3).join(', '))}${vw.length > 3 ? ` +${vw.length - 3}` : ''} ${vw.length === 1 ? 'está' : 'estão'} neste perfil</div>` : '';
  const ni = c.notes_info;
  if (ni) inds += `<span class="ind note" title="${esc(`${ni.count} anotaç${ni.count === 1 ? 'ão' : 'ões'} · ${ni.last.author}: ${ni.last.text}`)}">📝${ni.count > 1 ? `<i>${ni.count}</i>` : ''}</span>`;
  const unread = rd && rd.waitingRecent ? rd.waitingRecent : 0;
  const bubble = unread ? `<span class="bubble" title="${unread} conversa${unread === 1 ? '' : 's'} sem resposta nas últimas 24 h">${unread > 99 ? '99+' : unread}</span>` : '';
  const face = c.avatar && /^data:image\//.test(c.avatar) ? `<img class="creator-photo" src="${esc(c.avatar)}" alt="">` : esc(initials(c.name));
  el.innerHTML = `<div class="avatar ${esc(c.color)}${c.avatar ? ' has-photo' : ''}">${face}${bubble}</div>
    <div class="info"><div class="name">${esc(c.name)}</div><div class="status ${st.cls}">${c.shift && c.shift.operator_avatar && /^data:image\//.test(c.shift.operator_avatar) ? `<img class="op-photo" src="${esc(c.shift.operator_avatar)}" alt="">` : ''}${esc(st.text)}</div>${viewers}${chips}${queue}${shiftBtn}</div>
    ${inds}${tag ? `<span class="tagdot" style="background:${esc(tag.color)}" title="${esc(tag.name)}"></span>` : ''}
    ${steps}<button class="cmenu" title="Opções">⋮</button>`;
  el.addEventListener('click', (e) => {
    if (e.target.closest('.cmenu') || e.target.closest('.chip') || e.target.closest('.shift-btn') || e.target.closest('.steps')) return;
    // clique no card: abre/mostra a plataforma e, se ela estiver na tela de login e houver acesso salvo, já entra
    const target = cur && loginList.includes(cur) ? cur : (loginList.length === 1 ? loginList[0] : cur);
    if (S.open.includes(c.id) && target) return enterPlatform(c, target);
    openCreator(c).then(() => { if (S.open.includes(c.id)) enterPlatform(c, (S.activeTab && S.activeTab[c.id]) || 'privacy', true); });
  });
  el.querySelectorAll('.shift-btn').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); shiftClick(c, b.dataset.shift); }));
  el.querySelectorAll('.chip').forEach((ch) => ch.addEventListener('click', (e) => {
    e.stopPropagation();
    const x = e.target.closest('.chip-x'); if (x) return run(() => window.pulse.closeTab(c.id, x.dataset.close));
    const p = ch.dataset.plat; if (p === '+') return platformDialog(c);
    enterPlatform(c, p);
  }));
  el.querySelectorAll('.step').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); if (!b.disabled) moveStep(c, sib, Number(b.dataset.step)); }));
  el.querySelector('.cmenu').addEventListener('click', (e) => { e.stopPropagation(); creatorMenu(c, e.currentTarget); });
  return el;
}

// um clique: mostra a plataforma e, se a página estiver (ou carregar) na tela de login com acesso salvo, entra
async function enterPlatform(c, platform, quietShow) {
  if (!quietShow) await run(() => window.pulse.showProfile(c.id, platform));
  const hasCred = (S.credentials || []).some((x) => x.creator_id === c.id && x.platform === platform);
  if (!hasCred) return;
  const r = await run(() => window.pulse.vaultEnter(c.id, platform));
  if (r && r.ok && !r.already) toast(r.clicked ? 'Login enviado. Se a plataforma pedir código (2FA), digite na tela.' : 'Login e senha preenchidos. Clique em Entrar na tela.');
}
const vaultLogin = (c, platform) => enterPlatform(c, platform);
async function openCreator(c, platform) {
  if (S.open.includes(c.id) && !platform) return run(() => window.pulse.showProfile(c.id));
  if (c.shift && c.shift.operator_id !== S.user.id) {
    const ok = await dialog({ title: 'Criadora em atendimento', body: `<p>${esc(c.shift.operator_name)} está com o turno ativo de <b>${esc(c.name)}</b>. Abrir mesmo assim só para acompanhar? Você não vai conseguir iniciar turno enquanto o dele estiver ativo.</p>`, okText: 'Abrir' });
    if (!ok) return;
  }
  await run(() => window.pulse.openProfile(c.id, platform || 'privacy'));
  const others = (c.viewers || []).filter((v) => v.active);
  if (others.length && !(c.shift && c.shift.operator_id !== S.user.id)) toast(`${others.map((v) => v.name.split(' ')[0]).join(' e ')} ${others.length === 1 ? 'está' : 'estão'} neste perfil agora. Combinem para não responder o mesmo fã.`, 7000);
  if (!c.shift && !platform) offerShift(c);
}
async function platformDialog(c) {
  const plats = S.platforms || {}; const creds = (S.credentials || []).filter((x) => x.creator_id === c.id);
  const body = `<p>Abrir no perfil isolado de <b>${esc(c.name)}</b>:</p><div class="plat-list">${Object.keys(plats).map((id) => `<button class="plat" data-plat="${esc(id)}">${esc(plats[id].label)}${creds.some((x) => x.platform === id) ? ' <span class="plat-ok" title="acesso salvo no cofre">🔑</span>' : ''}</button>`).join('')}</div>`;
  const p = dialog({ title: 'Abrir plataforma', body, hideOk: true });
  $('dialog-body').querySelectorAll('.plat').forEach((b) => b.addEventListener('click', () => { $('dialog-cancel').onclick(); const pl = b.dataset.plat; openCreator(c, pl).then(() => { if (S.tabs && (S.tabs[c.id] || []).includes(pl)) enterPlatform(c, pl, true); }); }));
  await p;
}
async function shiftClick(c, action) {
  if (action === 'start') {
    await run(() => window.pulse.startShift(c.id), 'Turno iniciado.');
    if (!S.open.includes(c.id)) openCreator(c);
    return;
  }
  if (action === 'end') {
    const ok = await dialog({ title: 'Encerrar turno', body: `<p>Encerrar seu turno em <b>${esc(c.name)}</b>? A partir de agora as vendas e o tempo de resposta desta criadora deixam de contar pra você.</p>`, okText: 'Encerrar' });
    if (!ok) return;
    return run(() => window.pulse.shiftAction(c.shift.id, 'end'), 'Turno encerrado.');
  }
  run(() => window.pulse.shiftAction(c.shift.id, action), action === 'pause' ? 'Turno pausado.' : 'Turno retomado.');
}
async function offerShift(c) {
  const t = myTurn();
  if (t.state === 'active') run(() => window.pulse.startShift(c.id), `${c.name} entrou no seu turno.`);
}

// ---------- Meu turno: um botão só para todas as criadoras do chatter ----------
function myShifts() { return S.creators.filter((c) => c.shift && c.shift.operator_id === S.user.id); }
function turnScope() {
  // chatter: as criadoras liberadas para ele; gestor: as que estão abertas neste app (ou já no turno dele)
  if (S.user.role !== 'manager') return S.creators;
  return S.creators.filter((c) => S.open.includes(c.id) || (c.shift && c.shift.operator_id === S.user.id));
}
function myTurn() {
  const mine = myShifts();
  if (!mine.length) return { state: 'off', mine };
  const since = mine.map((c) => c.shift.started_at).sort()[0];
  return { state: mine.every((c) => c.shift.paused) ? 'paused' : 'active', mine, since };
}
const hm = (iso) => { const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };
function renderTurn() {
  const box = $('my-shift'); if (!box || !S.user) return;
  const t = myTurn(); const scope = turnScope();
  const free = scope.filter((c) => !c.shift).length;
  box.classList.remove('hidden'); box.className = `myshift ${t.state}${blkState('turn') === 'min' ? ' min' : ''}${blkState('turn') === 'off' ? ' gone' : ''}`;
  const chip = blkState('filter') === 'min' ? `<button class="ms-chip ${$('only-open').checked ? 'on' : ''}" data-chip="filter" title="Mostrar só as criadoras em atendimento">em atendimento</button>` : '';
  const minBtn = blkState('turn') === 'min' ? '' : '<button class="blk-min" data-blk="turn" title="Minimizar">&#9662;</button>';
  if (t.state === 'off') {
    box.innerHTML = `<div class="ms-info"><b>Fora de turno</b><span>${scope.length ? `${scope.length} criadora${scope.length === 1 ? '' : 's'}` : (S.user.role === 'manager' ? 'abra as criadoras que vai atender' : 'nenhuma criadora liberada')}</span></div><button class="ms-btn start" data-turn="start" ${scope.length ? '' : 'disabled'} title="Inicia o turno em todas as suas criadoras de uma vez">Iniciar turno</button>` + chip + minBtn;
  } else {
    const n = t.mine.length;
    box.innerHTML = `<div class="ms-info"><b>${t.state === 'paused' ? 'Pausado' : 'Em turno'} · ${hm(t.since)}</b><span>${n} criadora${n === 1 ? '' : 's'}${free && S.user.role !== 'manager' ? ` · <a href="#" data-turn="start" title="Incluir no turno as criadoras que ficaram de fora">+${free}</a>` : ''}</span></div>`
      + `<button class="ms-btn ghost" data-turn="${t.state === 'paused' ? 'resume' : 'pause'}" title="${t.state === 'paused' ? 'Voltar a atender' : 'Pausa rápida (banheiro, almoço)'}">${t.state === 'paused' ? 'Retomar' : 'Pausar'}</button><button class="ms-btn end" data-turn="end">Encerrar</button>` + chip + minBtn;
  }
  box.querySelectorAll('[data-turn]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); turnAction(b.dataset.turn); }));
  const ch = box.querySelector('[data-chip="filter"]'); if (ch) ch.onclick = () => { $('only-open').checked = !$('only-open').checked; $('only-open').dispatchEvent(new Event('change')); };
}
async function turnAction(action) {
  const t = myTurn();
  if (action === 'start') {
    const scope = turnScope(); const busy = scope.filter((c) => c.shift && c.shift.operator_id !== S.user.id);
    const todo = scope.filter((c) => !c.shift);
    let last = null, ok = 0;
    for (const c of todo) { try { last = await window.pulse.startShift(c.id); ok += 1; } catch (e) { toast(`${c.name}: ${String(e.message).replace(/^Error invoking remote method '[^']+': Error: /, '')}`); } }
    if (last && last.creators) apply(last);
    if (ok) toast(`Turno iniciado em ${ok} criadora${ok === 1 ? '' : 's'}.`);
    if (busy.length) {
      const names = busy.map((c) => `<li><b>${esc(c.name)}</b> ainda está com ${esc(c.shift.operator_name)}</li>`).join('');
      const canEnd = S.user.role === 'manager';
      const r = await dialog({ title: 'Criadoras com outro chatter', body: `<p>Estas ficaram fora do seu turno porque outro chatter ainda não encerrou:</p><ul>${names}</ul><p class="muted">${canEnd ? 'Você pode encerrar o turno dele e assumir agora.' : 'Peça para ele encerrar, ou avise o gestor. Depois clique no “+” da barra Meu turno.'}</p>`, okText: canEnd ? 'Encerrar e assumir' : 'Entendi', hideOk: false });
      if (r && canEnd) {
        let l2 = null;
        for (const c of busy) { try { await window.pulse.shiftAction(c.shift.id, 'end'); l2 = await window.pulse.startShift(c.id); } catch (e) { toast(`${c.name}: ${String(e.message).replace(/^Error invoking remote method '[^']+': Error: /, '')}`); } }
        if (l2 && l2.creators) apply(l2);
      }
    }
    return;
  }
  if (action === 'end') {
    const ok = await dialog({ title: 'Encerrar turno', body: `<p>Encerrar seu turno em <b>${t.mine.length} criadora${t.mine.length === 1 ? '' : 's'}</b>? A partir de agora as vendas e o tempo de resposta deixam de contar para você.</p>`, okText: 'Encerrar turno' });
    if (!ok) return;
  }
  const list = t.mine.filter((c) => (action === 'pause' ? !c.shift.paused : action === 'resume' ? c.shift.paused : true));
  let last = null;
  for (const c of list) { try { last = await window.pulse.shiftAction(c.shift.id, action); } catch {} }
  if (last && last.creators) apply(last);
  toast(action === 'pause' ? 'Turno pausado.' : action === 'resume' ? 'Turno retomado.' : 'Turno encerrado.');
}
setInterval(() => { if (S && S.user) renderTurn(); }, 30000);

// ---------- ordem própria (arrastar o card ou setas no ⋮) ----------
// a ordem é uma lista única do usuário; mover dentro de um grupo troca a posição relativa nessa lista
function myOrder() { const list = (S.user && S.user.creator_order && S.user.creator_order.length ? S.user.creator_order : (S.local && S.local.order) || []); return new Map(list.map((id, i) => [id, i])); }
function fullOrder() {
  const o = myOrder();
  return [...S.creators].sort((a, b) => (o.has(a.id) ? o.get(a.id) : 1e6) - (o.has(b.id) ? o.get(b.id) : 1e6) || a.name.localeCompare(b.name)).map((c) => c.id);
}
function moveStep(c, items, step) {
  const ids = items.map((x) => x.id); const i = ids.indexOf(c.id); const j = i + step;
  if (i < 0 || j < 0 || j >= ids.length) return;
  const all = fullOrder().filter((x) => x !== c.id);
  const anchor = ids[j]; let at = all.indexOf(anchor); if (step > 0) at += 1;
  all.splice(at, 0, c.id); $('sort').value = 'mine'; saveSort();
  return window.pulse.setOrder(all);
}
let dragId = null;
function dragCard(el, c, items) {
  el.draggable = true; el.title = 'Arraste para mudar a ordem';
  el.addEventListener('dragstart', (e) => { dragId = c.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', c.id); } catch {} });
  el.addEventListener('dragend', () => { dragId = null; el.classList.remove('dragging'); document.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); });
  el.addEventListener('dragover', (e) => {
    if (!dragId || dragId === c.id || !items.some((x) => x.id === dragId)) return; // só dentro do mesmo grupo
    e.preventDefault(); const r = el.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2;
    el.classList.toggle('drop-after', after); el.classList.toggle('drop-before', !after);
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
  el.addEventListener('drop', (e) => {
    if (!dragId || dragId === c.id) return; e.preventDefault();
    const after = el.classList.contains('drop-after'); el.classList.remove('drop-before', 'drop-after');
    const all = fullOrder().filter((x) => x !== dragId); all.splice(all.indexOf(c.id) + (after ? 1 : 0), 0, dragId);
    $('sort').value = 'mine'; saveSort(); window.pulse.setOrder(all);
  });
}
function saveSort() { try { localStorage.setItem('alta-sort', $('sort').value); } catch {} }
try { const sv = localStorage.getItem('alta-sort'); if (sv && [...$('sort').options].some((o) => o.value === sv)) $('sort').value = sv; } catch {}

// ---------- menu da criadora ----------
// ---------- menu ⋮ da criadora (cabeçalho, barra de ícones, turno em destaque, organizar, vendas, avançado, sair) ----------
function menuItem(it) {
  const b = document.createElement('button'); b.className = `mi${it.cls ? ' ' + it.cls : ''}`; b.type = 'button';
  b.innerHTML = `<span class="mi-ic">${it.icon || ''}</span><span class="mi-tx"><span class="mi-l">${esc(it.label)}</span>${it.sub ? `<span class="mi-s">${esc(it.sub)}</span>` : ''}</span>${it.right != null ? `<span class="mi-r">${it.right}</span>` : ''}`;
  b.onclick = (e) => { e.stopPropagation(); if (!it.keep) hideMenus(); it.fn(e); };
  return b;
}
function renderMenu(m, sections) {
  m.innerHTML = ''; m.classList.add('menu2');
  sections.filter(Boolean).forEach((sec, i) => {
    if (i && !sec.noLine) m.appendChild(document.createElement('hr'));
    if (sec.html) { const d = document.createElement('div'); d.innerHTML = sec.html; m.appendChild(d.firstElementChild); return; }
    if (sec.icons) { const row = document.createElement('div'); row.className = 'mi-icons'; for (const it of sec.icons) { const b = document.createElement('button'); b.type = 'button'; b.className = 'mi-icon'; b.title = it.label; b.setAttribute('aria-label', it.label); b.textContent = it.icon; b.disabled = !!it.disabled; b.onclick = (e) => { e.stopPropagation(); hideMenus(); it.fn(); }; row.appendChild(b); } m.appendChild(row); return; }
    if (sec.primary) { const row = document.createElement('div'); row.className = 'mi-primary'; for (const it of sec.primary) { const b = document.createElement('button'); b.type = 'button'; b.className = `mi-btn ${it.cls || ''}`; b.textContent = it.label; b.onclick = (e) => { e.stopPropagation(); hideMenus(); it.fn(); }; row.appendChild(b); } m.appendChild(row); return; }
    for (const it of sec.items || []) m.appendChild(menuItem(it));
  });
}
// teclado: ↑ ↓ andam pelos itens, Enter abre, ← volta do Avançado, Esc fecha (Esc já é tratado no documento)
document.addEventListener('keydown', (e) => {
  const m = $('creator-menu'); if (m.classList.contains('hidden') || !['ArrowDown', 'ArrowUp', 'ArrowLeft'].includes(e.key)) return;
  const items = [...m.querySelectorAll('button:not(:disabled)')]; if (!items.length) return;
  e.preventDefault();
  if (e.key === 'ArrowLeft') { const back = m.querySelector('.mi-back'); if (back) back.click(); return; }
  const i = items.indexOf(document.activeElement); const n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
  items[n].focus();
});
function creatorMenu(c, anchor) {
  const m = $('creator-menu'); const isOpen = S.open.includes(c.id); const isMgr = S.user.role === 'manager';
  const mine = c.shift && c.shift.operator_id === S.user.id;
  const st = statusOf(c); const tabsHere = (S.tabs && S.tabs[c.id]) || [];
  const labelOf = (p) => (S.platforms && S.platforms[p] ? S.platforms[p].label : p);
  const face = c.avatar && /^data:image\//.test(c.avatar) ? `<img src="${esc(c.avatar)}" alt="">` : esc(initials(c.name));
  const head = { html: `<div class="mi-head"><span class="mi-face avatar ${esc(c.color)}">${face}</span><span class="mi-who"><b>${esc(c.name)}</b><small>${esc(st.text)}${tabsHere.length ? ' · ' + esc(tabsHere.map(labelOf).join(', ')) : ''}</small></span></div>` };
  const icons = { noLine: true, icons: [
    { icon: '←', label: 'Voltar a página', disabled: !isOpen, fn: () => window.pulse.backProfile(c.id) },
    { icon: '↻', label: 'Recarregar a página', disabled: !isOpen, fn: () => window.pulse.reloadProfile(c.id) },
    { icon: '＋', label: 'Abrir outra plataforma neste perfil', fn: () => platformDialog(c) },
    { icon: '✕', label: tabsHere.length > 1 ? 'Fechar todas as abas' : 'Fechar perfil', disabled: !isOpen, fn: () => run(() => window.pulse.closeProfile(c.id)) },
  ] };
  const shiftBtns = [];
  if (!c.shift) shiftBtns.push({ label: '▶ Iniciar turno', cls: 'go', fn: () => run(() => window.pulse.startShift(c.id), 'Turno iniciado.') });
  if (mine && !c.shift.paused) shiftBtns.push({ label: 'Pausar', cls: 'soft', fn: () => run(() => window.pulse.shiftAction(c.shift.id, 'pause'), 'Turno pausado.') });
  if (mine && c.shift.paused) shiftBtns.push({ label: 'Retomar', cls: 'go', fn: () => run(() => window.pulse.shiftAction(c.shift.id, 'resume'), 'Turno retomado.') });
  if (mine || (c.shift && isMgr)) shiftBtns.push({ label: mine ? 'Encerrar' : `Encerrar turno de ${c.shift.operator_name.split(' ')[0]}`, cls: 'stop', fn: () => run(() => window.pulse.shiftAction(c.shift.id, 'end'), 'Turno encerrado.') });
  const enter = [];
  for (const lp of (S.loginPages && S.loginPages[c.id]) || []) if ((S.credentials || []).some((x) => x.creator_id === c.id && x.platform === lp)) enter.push({ icon: '🔑', label: `Entrar na ${labelOf(lp)}`, sub: 'com o acesso salvo (senha não aparece)', fn: () => vaultLogin(c, lp) });
  if (!isOpen) enter.unshift({ icon: '▣', label: 'Abrir perfil', fn: () => openCreator(c) });
  const gnames = groupsOf(c.id).map((id) => (S.local.groups.find((g) => g.id === id) || {}).name).filter(Boolean);
  const tag = tagOf(c.id); const nNotes = c.notes_info ? c.notes_info.count : 0;
  const ord = fullOrder();
  const sib = [...(anchor.closest('.cards') || document).querySelectorAll('.card')].map((x) => S.creators.find((k) => k.id === x.dataset.id)).filter(Boolean).sort((a, b) => ord.indexOf(a.id) - ord.indexOf(b.id));
  const pos = sib.findIndex((x) => x.id === c.id);
  const organize = [
    { icon: '📝', label: 'Anotações', right: nNotes ? `<i class="mi-badge">${nNotes}</i>` : '', fn: () => notesDialog(c) },
    { icon: '📁', label: 'Grupos', right: gnames.length ? esc(gnames.slice(0, 2).join(', ') + (gnames.length > 2 ? ` +${gnames.length - 2}` : '')) : '<span class="mi-muted">nenhum</span>', fn: () => groupDialog(c) },
    { icon: '●', label: 'Etiqueta', right: tag ? `<span class="mi-dot" style="background:${esc(tag.color)}"></span>${esc(tag.name)}` : '<span class="mi-muted">nenhuma</span>', fn: () => tagDialog(c) },
  ];
  const posRow = sib.length > 1 ? { noLine: true, html: `<div class="mi mi-pos"><span class="mi-ic">↕</span><span class="mi-tx"><span class="mi-l">Posição</span></span><span class="mi-r"><button type="button" class="mi-arrow" data-step="-1" ${pos > 0 ? '' : 'disabled'} title="Mover para cima">↑</button><button type="button" class="mi-arrow" data-step="1" ${pos >= 0 && pos < sib.length - 1 ? '' : 'disabled'} title="Mover para baixo">↓</button></span></div>` } : null;
  const ex = S.extratos && S.extratos[c.id];
  const sales = (isOpen || isMgr) ? [{ icon: '💲', label: 'Ler extrato agora', sub: ex && ex.readAt ? `última leitura ${new Date(ex.readAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'ainda não lido', fn: () => run(() => window.pulse.readExtrato(c.id), 'Extrato lido.') }] : [];
  const adv = [];
  if (isOpen && isMgr) adv.push({ icon: '🧪', label: 'Mostrar/esconder aba do extrato', sub: 'diagnóstico', fn: () => window.pulse.toggleExtrato(c.id) });
  if (isOpen) adv.push({ icon: '🧩', label: 'Capturar estrutura da tela', sub: 'calibração', fn: () => calibrate(c) });
  if (isMgr) adv.push({ icon: '🧩', label: 'Capturar Meu Privacy → Assinantes', sub: 'calibração', fn: async () => { const r = await run(() => window.pulse.calibrateStats(c.id, 'assinantes')); if (r && r.ok) toast(`Estrutura salva (${r.size} caracteres): ${r.file}`); } });
  const cache = { icon: '🧹', label: 'Limpar cache', sub: 'resolve página travada ou desatualizada', fn: () => run(() => window.pulse.clearProfile(c.id, 'cache'), 'Cache limpo.') };
  if (isMgr) adv.push(cache); else sales.push(cache);
  const wire = () => m.querySelectorAll('.mi-arrow').forEach((b) => b.onclick = (e) => { e.stopPropagation(); hideMenus(); moveStep(c, sib, Number(b.dataset.step)); });
  const main = () => { renderMenu(m, [head, icons,
    shiftBtns.length ? { primary: shiftBtns } : null,
    enter.length ? { items: enter } : null,
    { items: organize },
    sales.length || isMgr ? { items: [...sales, ...(isMgr ? [{ icon: '⚙', label: 'Avançado', right: '›', keep: true, fn: () => advanced() }] : [])] } : null,
    { items: [{ icon: '⎋', label: 'Sair da conta da Privacy…', sub: 'apaga o login deste computador', cls: 'danger', fn: async () => { const ok = await dialog({ title: 'Sair da conta', body: `<p>Isso apaga o login da Privacy de <b>${esc(c.name)}</b> neste computador. Vai ser preciso entrar de novo.</p>`, okText: 'Limpar' }); if (ok) run(() => window.pulse.clearProfile(c.id, 'cookies'), 'Sessão apagada.'); } }] },
  ]); wire(); };
  const advanced = () => { renderMenu(m, [{ items: [{ icon: '‹', label: 'Avançado', cls: 'mi-back', keep: true, fn: () => { main(); place(m, anchor); } }] }, { items: adv }]); place(m, anchor); const f = m.querySelector('button.mi:not(.mi-back)'); if (f) f.focus(); };
  main(); place(m, anchor);
}
function place(m, anchor) {
  const r = anchor.getBoundingClientRect(); m.classList.remove('hidden');
  m.style.maxHeight = `${window.innerHeight - 16}px`;
  // cabe embaixo? abre embaixo; senão abre para cima do botão; em último caso encosta no topo e rola
  const h = m.offsetHeight; let top = r.bottom + 4;
  if (top + h > window.innerHeight - 8) top = r.top - h - 4 >= 8 ? r.top - h - 4 : Math.max(8, window.innerHeight - h - 8);
  m.style.top = `${top}px`; m.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8))}px`;
}

async function calibrate(c) {
  const ok = await dialog({ title: 'Capturar estrutura da tela', body: `<p>Com uma <b>conversa aberta</b> na Privacy de ${esc(c.name)} (espere as mensagens carregarem), o app envia ao painel só o esqueleto da tela: caixas, classes e horários.</p><p>Nomes de fãs e o texto das mensagens <b>não</b> são enviados.</p>`, okText: 'Capturar' });
  if (!ok) return;
  toast('Capturando...');
  const r = await run(() => window.pulse.calibrate(c.id));
  if (r && r.ok) toast(r.sent ? '✓ Estrutura enviada ao painel e salva localmente.' : '✓ Estrutura salva localmente (painel indisponível).', 6000);
}

// ---------- diálogos ----------
// anotações da criadora: recados com autor e hora, iguais no painel e em qualquer computador
async function notesDialog(c) {
  const fmt = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const legacy = (localOf(c.id).notes || c.notes || '').trim();
  const p = dialog({ title: `Anotações · ${c.name}`, body: `<textarea id="cn-text" maxlength="1000" placeholder="Ex.: fã João prometeu comprar às 21h · não oferecer vídeo essa semana"></textarea><div class="cn-row"><label><input type="checkbox" id="cn-pin"> Fixar no topo</label><button class="primary" id="cn-add">Adicionar</button></div><div id="cn-list" class="cn-list"><p class="muted">Carregando…</p></div>`, hideOk: true });
  const draw = async () => {
    let rows = [];
    try { rows = await window.pulse.creatorNotes(c.id); } catch (e) { $('cn-list').innerHTML = `<p class="muted">${esc(e.message.replace(/^Error invoking remote method '[^']+': Error: /, ''))}</p>`; return; }
    const old = legacy ? `<div class="cn-item old"><p>${esc(legacy)}</p><small>nota antiga (versões anteriores)</small></div>` : '';
    $('cn-list').innerHTML = rows.length || legacy ? old + rows.map((n) => `<div class="cn-item${n.pinned ? ' pinned' : ''}"><p>${esc(n.text)}</p><small>${n.pinned ? '📌 ' : ''}${esc(n.author)} · ${fmt(n.created_at)}<span><button class="link" data-pin="${esc(n.id)}" data-v="${n.pinned ? '' : '1'}">${n.pinned ? 'desafixar' : 'fixar'}</button>${n.author_id === S.user.id || S.user.role === 'manager' ? `<button class="link danger" data-del="${esc(n.id)}">apagar</button>` : ''}</span></small></div>`).join('') : '<p class="muted">Nenhuma anotação ainda. Use para recados de passagem de turno.</p>';
    $('cn-list').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { await run(() => window.pulse.creatorNoteDel(b.dataset.del)); draw(); });
    $('cn-list').querySelectorAll('[data-pin]').forEach((b) => b.onclick = async () => { await run(() => window.pulse.creatorNotePin(b.dataset.pin, !!b.dataset.v)); draw(); });
  };
  $('cn-add').onclick = async () => { const t = $('cn-text').value.trim(); if (!t) return; const r = await run(() => window.pulse.creatorNoteAdd(c.id, t, $('cn-pin').checked)); if (r) { $('cn-text').value = ''; $('cn-pin').checked = false; draw(); } };
  draw(); await p;
}
// grupos da criadora (pode estar em vários); local antigo tinha só 'group'
function groupsOf(id) { const l = localOf(id); return Array.isArray(l.groups) ? l.groups : (l.group ? [l.group] : []); }
const MAX_GROUPS_PER_CREATOR = 100;
function groupDialog(c) {
  if (!S.local.groups.length) { dialog({ title: `Grupos · ${c.name}`, body: '<p>Crie um grupo primeiro em “+ Novo grupo”.</p>', hideOk: true }); return; }
  const cur = new Set(groupsOf(c.id));
  const opts = S.local.groups.map((g) => `<label class="ghost choice multi ${cur.has(g.id) ? 'sel' : ''}"><input type="checkbox" data-g="${esc(g.id)}" ${cur.has(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('');
  dialog({ title: `Grupos · ${c.name}`, body: `<p>Marque um ou mais grupos.</p>${opts}`, okText: 'Salvar',
    onOk: async () => { const groups = [...$('dialog-body').querySelectorAll('input[type=checkbox]')].filter((i) => i.checked).map((i) => i.dataset.g); if (groups.length > MAX_GROUPS_PER_CREATOR) { toast(`Cada criadora pode estar em no máximo ${MAX_GROUPS_PER_CREATOR} grupos.`, 5000); return false; } await window.pulse.setCreatorLocal(c.id, { groups }); } });
  $('dialog-body').querySelectorAll('input[type=checkbox]').forEach((i) => i.onchange = () => i.closest('label').classList.toggle('sel', i.checked));
}
function tagDialog(c) {
  const cur = localOf(c.id).tag || '';
  const opts = [{ id: '', name: 'Sem etiqueta', color: '#555' }, ...S.local.tags].map((t) => `<button class="ghost choice ${t.id === cur ? 'sel' : ''}" data-t="${esc(t.id)}"><span class="tagdot" style="display:inline-block;vertical-align:middle;margin-right:8px;background:${esc(t.color)}"></span>${esc(t.name)}</button>`).join('');
  dialog({ title: `Etiqueta · ${c.name}`, body: opts, hideOk: true });
  $('dialog-body').querySelectorAll('.choice').forEach((b) => b.onclick = async () => { await window.pulse.setCreatorLocal(c.id, { tag: b.dataset.t }); $('dialog').classList.add('hidden'); });
}
function newGroupDialog() {
  dialog({ title: 'Novo grupo', body: '<input id="dlg-group" placeholder="Nome do grupo" maxlength="40">', okText: 'Criar',
    onOk: async () => { const name = $('dlg-group').value.trim(); if (!name) return false; await window.pulse.setGroups([...S.local.groups, { id: 'g' + Date.now(), name }]); } });
}
function groupMenu(gid, anchor) {
  const g = S.local.groups.find((x) => x.id === gid); if (!g) return;
  const m = $('creator-menu'); const n = S.creators.filter((c) => groupsOf(c.id).includes(gid)).length;
  renderMenu(m, [
    { html: `<div class="mi-head"><span class="mi-face avatar">📁</span><span class="mi-who"><b>${esc(g.name)}</b><small>${n} criadora${n === 1 ? '' : 's'}</small></span></div>` },
    { items: [
      { icon: '☑', label: 'Escolher criadoras do grupo…', sub: 'várias de uma vez, com busca', fn: () => groupMembersDialog(g) },
      { icon: '✎', label: 'Renomear grupo', fn: () => dialog({ title: 'Renomear grupo', body: `<input id="dlg-group" value="${esc(g.name)}" maxlength="40">`, okText: 'Salvar',
        onOk: async () => { const name = $('dlg-group').value.trim(); if (!name) return false; await window.pulse.setGroups(S.local.groups.map((x) => x.id === gid ? { ...x, name } : x)); } }) },
    ] },
    { items: [{ icon: '🗑', label: 'Excluir grupo…', sub: 'as criadoras não são apagadas', cls: 'danger', fn: async () => {
      const ok = await dialog({ title: 'Excluir grupo', body: `<p>Excluir <b>${esc(g.name)}</b>? As criadoras não são apagadas, só perdem o grupo.</p>`, okText: 'Excluir' });
      if (!ok) return;
      for (const id of Object.keys(S.local.creators || {})) { const gs = groupsOf(id); if (gs.includes(gid)) await window.pulse.setCreatorLocal(id, { groups: gs.filter((x) => x !== gid) }); }
      await window.pulse.setGroups(S.local.groups.filter((x) => x.id !== gid));
    } }] },
  ]);
  place(m, anchor);
}
// várias criadoras de uma vez num grupo: busca, marcar todas, e só grava quem mudou
function groupMembersDialog(g) {
  const list = [...S.creators].sort((a, b) => a.name.localeCompare(b.name));
  const rows = list.map((c) => { const on = groupsOf(c.id).includes(g.id); return `<label class="ghost choice multi ${on ? 'sel' : ''}" data-name="${esc(c.name.toLowerCase())}"><input type="checkbox" data-c="${esc(c.id)}" ${on ? 'checked' : ''}> ${esc(c.name)}</label>`; }).join('');
  dialog({ title: `Criadoras · ${g.name}`, body: `<input id="gm-search" placeholder="Buscar criadora"><div class="gm-bar"><button type="button" class="ghost" id="gm-all">Marcar todas</button><button type="button" class="ghost" id="gm-none">Desmarcar todas</button><span id="gm-count" class="muted"></span></div><div class="gm-list">${rows}</div>`, okText: 'Salvar',
    onOk: async () => {
      const boxes = [...$('dialog-body').querySelectorAll('input[data-c]')]; let changed = 0, blocked = [];
      for (const b of boxes) {
        const id = b.dataset.c; const gs = groupsOf(id); const has = gs.includes(g.id);
        if (b.checked === has) continue;
        if (b.checked && gs.length >= MAX_GROUPS_PER_CREATOR) { blocked.push((S.creators.find((x) => x.id === id) || {}).name || id); continue; }
        await window.pulse.setCreatorLocal(id, { groups: b.checked ? [...gs, g.id] : gs.filter((x) => x !== g.id) }); changed += 1;
      }
      toast(blocked.length ? `${changed} alteradas. Já estão em ${MAX_GROUPS_PER_CREATOR} grupos: ${blocked.join(', ')}.` : `${changed} criadora${changed === 1 ? '' : 's'} alterada${changed === 1 ? '' : 's'} no grupo.`, 5000);
    } });
  const body = $('dialog-body'); const count = () => { $('gm-count').textContent = `${body.querySelectorAll('input[data-c]:checked').length} no grupo`; };
  body.querySelectorAll('input[data-c]').forEach((i) => i.onchange = () => { i.closest('label').classList.toggle('sel', i.checked); count(); });
  const visible = () => [...body.querySelectorAll('label[data-name]')].filter((l) => l.style.display !== 'none');
  $('gm-all').onclick = () => { visible().forEach((l) => { const i = l.querySelector('input'); i.checked = true; l.classList.add('sel'); }); count(); };
  $('gm-none').onclick = () => { visible().forEach((l) => { const i = l.querySelector('input'); i.checked = false; l.classList.remove('sel'); }); count(); };
  $('gm-search').oninput = (e) => { const q = e.target.value.trim().toLowerCase(); body.querySelectorAll('label[data-name]').forEach((l) => { l.style.display = !q || l.dataset.name.includes(q) ? '' : 'none'; }); };
  count();
}
function tagsDialog() {
  const rows = S.local.tags.map((t, i) => `<div class="tagrow"><input type="color" value="${esc(t.color)}" data-i="${i}"><input value="${esc(t.name)}" data-i="${i}" maxlength="30"></div>`).join('');
  dialog({ title: 'Etiquetas', body: rows, okText: 'Salvar', onOk: async () => {
    const tags = S.local.tags.map((t, i) => ({ ...t, color: $('dialog-body').querySelector(`input[type=color][data-i="${i}"]`).value, name: $('dialog-body').querySelector(`input:not([type=color])[data-i="${i}"]`).value.trim() || t.name }));
    await window.pulse.setTags(tags);
  } });
}

// ---------- eventos ----------
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault(); $('login-error').textContent = ''; $('login-btn').disabled = true;
  try { apply(await window.pulse.login($('login-email').value.trim(), $('login-password').value)); $('login-password').value = ''; }
  catch (err) { $('login-error').textContent = err.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
  $('login-btn').disabled = false;
});
$('origin-save').onclick = async () => { await window.pulse.setOrigin($('origin').value.trim() || 'https://altapulse.com.br'); toast('Endereço salvo.'); };
$('me-avatar').onclick = () => photoMenu();
// ---------- oportunidades de venda (radar) ----------
const fmtBRL = (c) => 'R$ ' + ((c || 0) / 100).toFixed(2).replace('.', ',');
// gestor: por padrão só as criadoras abertas aqui ou no turno dele (ver todas é opção); chatter: as dele
function oppScope() { try { return localStorage.getItem('alta-opp-scope') || 'minhas'; } catch { return 'minhas'; } }
function oppsVisible() {
  const list = S.opportunities || [];
  if (!S.user || S.user.role !== 'manager' || oppScope() === 'todas') return list;
  const mine = new Set([...(S.open || []), ...(S.creators || []).filter((c) => c.shift && c.shift.operator_id === S.user.id).map((c) => c.id)]);
  return list.filter((o) => mine.has(o.creator_id));
}
function renderOpps() {
  const all = S.opportunities || []; const list = oppsVisible(); const hot = list.filter((o) => o.hot).length; const el = $('my-opps');
  el.classList.toggle('hidden', !all.length);
  const minBtn = blkState('opps') === 'open' ? '<span class="blk-min" data-blk="opps" title="Minimizar">&#9662;</span>' : '';
  if (all.length && blkState('opps') === 'min') el.innerHTML = `<b>💰 ${list.length}</b><small>${hot ? `<span class="hot">${hot} quente${hot > 1 ? 's' : ''}</span>` : 'nenhuma quente'}</small>`;
  else if (all.length) el.innerHTML = `<b>💰 Oportunidades · ${list.length}</b><small>${hot ? `<span class="hot">${hot} quente${hot > 1 ? 's' : ''}</span> · ` : ''}${esc(fmtBRL(list.reduce((n, o) => n + (o.value_cents || 0), 0)))} em jogo${list.length !== all.length ? ` · ${all.length} em todas` : ''}</small>` + minBtn;
  const ic = $('btn-opps'); ic.querySelector('.dot').classList.toggle('hidden', !hot); ic.title = hot ? `Oportunidades: ${hot} quente${hot > 1 ? 's' : ''} de ${list.length}` : `Oportunidades · ${list.length}`;
}
const oppOpenGroups = new Set();
// filtros da lista (ficam salvos neste computador): criadora, tipo, plataforma, só quentes, busca pelo nome do fã e ordem
const OPP_F0 = { creator: '', kind: '', platform: '', hot: false, q: '', sort: 'valor' };
let oppF = (() => { try { return { ...OPP_F0, ...JSON.parse(localStorage.getItem('alta-opp-filtros') || '{}'), q: '' }; } catch { return { ...OPP_F0 }; } })();
const saveOppF = () => { try { localStorage.setItem('alta-opp-filtros', JSON.stringify({ ...oppF, q: '' })); } catch {} };
function oppFiltered(list) {
  const q = oppF.q.trim().toLowerCase();
  let out = list.filter((o) => (!oppF.creator || o.creator_id === oppF.creator) && (!oppF.kind || o.kind === oppF.kind) && (!oppF.platform || (o.platform || 'privacy') === oppF.platform)
    && (!oppF.hot || o.hot) && (!q || String(o.fan_name || '').toLowerCase().includes(q)));
  const by = { valor: (a, b) => (b.hot - a.hot) || (b.value_cents || 0) - (a.value_cents || 0), recente: (a, b) => String(b.created_at).localeCompare(String(a.created_at)), vence: (a, b) => String(a.due_at).localeCompare(String(b.due_at)) };
  return out.sort(by[oppF.sort] || by.valor);
}
function oppDialog() {
  const base = oppsVisible(); const list = oppFiltered(base); const isMgr = S.user && S.user.role === 'manager';
  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  const count = (fn) => base.filter(fn).length;
  const creators = [...new Map(base.map((o) => [o.creator_id, o.creator_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const kinds = [...new Map(base.map((o) => [o.kind, o.label])).entries()];
  const plats = [...new Set(base.map((o) => o.platform || 'privacy'))];
  const plabel = (p) => (S.platforms && S.platforms[p] ? S.platforms[p].label : p);
  const filters = `<div class="opp-filters">
    <input id="of-q" placeholder="Buscar fã pelo nome" value="${esc(oppF.q)}">
    <select id="of-creator">${opt('', `Todas as criadoras (${base.length})`, oppF.creator)}${creators.map(([id, n]) => opt(id, `${n} (${count((o) => o.creator_id === id)})`, oppF.creator)).join('')}</select>
    <select id="of-kind">${opt('', 'Todos os tipos', oppF.kind)}${kinds.map(([k, l]) => opt(k, `${l} (${count((o) => o.kind === k)})`, oppF.kind)).join('')}</select>
    ${plats.length > 1 ? `<select id="of-plat">${opt('', 'Todas as plataformas', oppF.platform)}${plats.map((p) => opt(p, plabel(p), oppF.platform)).join('')}</select>` : ''}
    <select id="of-sort">${opt('valor', 'Ordem: quentes e maior valor', oppF.sort)}${opt('recente', 'Ordem: mais recentes', oppF.sort)}${opt('vence', 'Ordem: vencem antes', oppF.sort)}</select>
    <label><input type="checkbox" id="of-hot" ${oppF.hot ? 'checked' : ''}> Só quentes (pediu preço)</label>
    ${list.length !== base.length ? `<a href="#" id="of-clear">Limpar filtros · mostrando ${list.length} de ${base.length}</a>` : ''}
  </div>`;
  const byCreator = {}; for (const o of list) (byCreator[o.creator_name] = byCreator[o.creator_name] || []).push(o);
  const groups = Object.entries(byCreator).sort((a, b) => b[1].filter((o) => o.hot).length - a[1].filter((o) => o.hot).length || b[1].length - a[1].length);
  if (groups.length === 1 || oppF.creator) for (const g of groups) oppOpenGroups.add(g[0]);
  const scope = isMgr ? `<div class="opp-scope"><label><input type="radio" name="opp-scope" value="minhas" ${oppScope() !== 'todas' ? 'checked' : ''}> Abertas aqui / meu turno</label><label><input type="radio" name="opp-scope" value="todas" ${oppScope() === 'todas' ? 'checked' : ''}> Todas as criadoras (${(S.opportunities || []).length})</label></div>` : '';
  const item = (o) => `<div class="opp${o.hot ? ' hot' : ''}"><div class="opp-info"><b>${esc(o.fan_name || 'Fã sem nome')}</b><span class="opp-kind">${esc(o.label)}${o.platform && o.platform !== 'privacy' ? ` · ${esc(S.platforms && S.platforms[o.platform] ? S.platforms[o.platform].label : o.platform)}` : ''} · ${esc(fmtBRL(o.value_cents))}</span><small>${esc(o.reason)}</small></div><div class="opp-actions"><button class="primary" data-open="${esc(o.id)}">Abrir conversa</button><button class="ghost" data-done="${esc(o.id)}" title="Já falei com o fã">Feito</button><button class="ghost" data-skip="${esc(o.id)}" title="Não faz sentido agora">Dispensar</button></div></div>`;
  const body = `${scope}${filters}<div class="opp-list">${groups.map(([cn, items]) => { const hot = items.filter((o) => o.hot).length; const open = oppOpenGroups.has(cn);
    return `<div class="opp-group${open ? ' open' : ''}" data-g="${esc(cn)}"><span class="caret">${open ? '▾' : '▸'}</span> ${esc(cn)} <i>${items.length}${hot ? ` · <span class="hot">${hot} quente${hot > 1 ? 's' : ''}</span>` : ''} · ${esc(fmtBRL(items.reduce((n, o) => n + (o.value_cents || 0), 0)))}</i></div>${open ? items.map(item).join('') : ''}`; }).join('')
    || `<p class="muted">${base.length ? 'Nenhuma com esses filtros.' : isMgr && oppScope() !== 'todas' ? 'Nada nas criadoras abertas aqui. Marque "Todas as criadoras" para ver o resto.' : 'Nada agora. O radar olha a lista de conversas enquanto a plataforma está aberta.'}</p>`}</div><p class="muted">Uma por fã (a mais importante). Quando você responde ou manda oferta, ela é marcada sozinha. Venda em até 2 dias conta para você.</p>`;
  const p = dialog({ title: 'Oportunidades de venda', body, hideOk: true });
  const B = $('dialog-body');
  B.querySelectorAll('input[name=opp-scope]').forEach((r) => r.onchange = () => { try { localStorage.setItem('alta-opp-scope', r.value); } catch {} renderOpps(); $('dialog-cancel').onclick(); oppDialog(); });
  const redraw = () => { saveOppF(); $('dialog-cancel').onclick(); oppDialog(); };
  for (const [id, key] of [['of-creator', 'creator'], ['of-kind', 'kind'], ['of-plat', 'platform'], ['of-sort', 'sort']]) { const el = $(id); if (el) el.onchange = () => { oppF[key] = el.value; redraw(); }; }
  $('of-hot').onchange = (e) => { oppF.hot = e.target.checked; redraw(); };
  { let t; $('of-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { oppF.q = e.target.value; redraw(); setTimeout(() => { const i = $('of-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0); }, 350); }; }
  if ($('of-clear')) $('of-clear').onclick = (e) => { e.preventDefault(); oppF = { ...OPP_F0 }; redraw(); };
  B.querySelectorAll('.opp-group').forEach((g) => g.onclick = () => { const k = g.dataset.g; if (oppOpenGroups.has(k)) oppOpenGroups.delete(k); else oppOpenGroups.add(k); $('dialog-cancel').onclick(); oppDialog(); });
  B.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => {
    $('dialog-cancel').onclick();
    const r = await run(() => window.pulse.oppOpen(b.dataset.open));
    if (r && !r.found) toast(`Procure "${r.name || 'o fã'}" na lista de conversas: ainda não sei qual é a conversa dele.`, 6000);
  }));
  B.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', async () => { await run(() => window.pulse.oppAction(b.dataset.done, 'contacted')); b.closest('.opp').remove(); }));
  B.querySelectorAll('[data-skip]').forEach((b) => b.addEventListener('click', async () => { await run(() => window.pulse.oppAction(b.dataset.skip, 'dismissed')); b.closest('.opp').remove(); }));
  return p;
}
$('my-opps').onclick = () => oppDialog();
$('my-list').onclick = async () => {
  const list = (S.tasks || []).filter((t) => t.status === 'open');
  const body = `<div class="task-list">${list.map((t) => `<div class="task"><div><b>${esc(t.fan_name || 'Fã sem nome')}</b><small>${esc(t.creator_name)}${t.reason ? ' · ' + esc(t.reason) : ''} · por ${esc(t.assigned_by)}</small></div><button class="primary" data-task="${esc(t.id)}">Abrir</button></div>`).join('') || '<p class="muted">Nada pendente.</p>'}</div><p class="muted">Ao abrir, o cartão do fã aparece à direita; marque "contatado" depois de falar com ele.</p>`;
  const p = dialog({ title: 'Minha lista', body, hideOk: true });
  $('dialog-body').querySelectorAll('[data-task]').forEach((b) => b.addEventListener('click', async () => {
    $('dialog-cancel').onclick();
    const r = await run(() => window.pulse.taskOpen(b.dataset.task));
    if (r && !r.found) toast(`Procure "${r.name || 'o fã'}" na lista de conversas: ainda não sei qual é a conversa dele neste computador.`);
  }));
  await p;
};
$('me-photo').onchange = async (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return; try { const image = await shrinkImage(f); await run(() => window.pulse.setAvatar(image), 'Foto atualizada.'); } catch (err) { toast(err.message); } };
$('btn-logout').onclick = async () => {
  const mine = (S.creators || []).filter((c) => c.shift && c.shift.operator_id === S.user.id);
  const extra = mine.length ? `<p><b>Você ainda tem ${mine.length} turno${mine.length > 1 ? 's' : ''} aberto${mine.length > 1 ? 's' : ''}</b> (${esc(mine.map((c) => c.name).join(', '))}). Ao sair, ${mine.length > 1 ? 'eles serão encerrados' : 'ele será encerrado'} agora.</p>` : '';
  const ok = await dialog({ title: 'Sair', body: `${extra}<p>Sair do Alta Pulse neste computador? Os perfis abertos serão fechados. Os logins das plataformas continuam salvos.</p>`, okText: mine.length ? 'Encerrar e sair' : 'Sair' });
  if (!ok) return;
  for (const c of mine) { try { await window.pulse.shiftAction(c.shift.id, 'end'); } catch {} }
  run(() => window.pulse.logout());
};
// ↻ gira enquanto recarrega a página aberta e a lista (mínimo 0,6 s, para dar para ver)
$('btn-refresh').onclick = async () => {
  const b = $('btn-refresh'); if (b.classList.contains('spinning')) return;
  b.classList.add('spinning'); b.disabled = true; const t0 = Date.now();
  try { await Promise.all([window.pulse.reloadActive ? window.pulse.reloadActive() : null, run(() => window.pulse.getState())]); } catch {}
  setTimeout(() => { b.classList.remove('spinning'); b.disabled = false; }, Math.max(0, 600 - (Date.now() - t0)));
};
$('btn-new-group').onclick = newGroupDialog;
$('search').addEventListener('input', renderList);
$('sort').addEventListener('change', () => { saveSort(); renderList(); });
$('only-open').addEventListener('change', () => { renderList(); applyPanel(); });
$('btn-search').onclick = () => { setBlk('search', 'open'); setTimeout(() => $('search').focus(), 50); };
$('btn-filter').onclick = () => { $('only-open').checked = !$('only-open').checked; $('only-open').dispatchEvent(new Event('change')); };
$('btn-opps').onclick = () => oppDialog();
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); toggleFocus(); } });
if (window.pulse.onFocusMode) window.pulse.onFocusMode(toggleFocus);
$('list').addEventListener('click', (e) => {
  const gm = e.target.closest('.gmenu'); if (gm) { e.stopPropagation(); groupMenu(gm.dataset.g, gm); return; }
  const head = e.target.closest('.group-head'); if (!head) return;
  const gid = head.dataset.g; const g = head.parentElement; g.classList.toggle('closed');
  if (g.classList.contains('closed')) closedGroups.add(gid); else closedGroups.delete(gid);
  localStorage.setItem('closedGroups', JSON.stringify([...closedGroups]));
});
// zoom da página aberta (por plataforma, neste computador): menu ⋮, Ctrl +/−/0 e Ctrl + rodinha
function renderZoom() {
  const z = S && S.zoom; const pill = $('zoom-pill');
  $('zoom-pct').textContent = z ? `${z.pct}%` : '—';
  $('zoom-row').querySelector('.zr-label').textContent = z ? `Zoom · ${z.label}${z.auto ? ' (auto)' : ''}` : 'Zoom';
  $('zoom-row').querySelectorAll('[data-zoom="in"],[data-zoom="out"]').forEach((b) => { b.disabled = !z; });
  const show = z && !z.auto && z.pct !== 100;
  pill.classList.toggle('hidden', !show); if (show) pill.textContent = `${z.pct}%`;
}
$('zoom-row').addEventListener('click', async (e) => {
  e.stopPropagation(); const b = e.target.closest('[data-zoom]'); if (!b) return;
  if (b.dataset.zoom === 'full') { hideMenus(); return window.pulse.fullscreen(); }
  await run(() => window.pulse.zoom(b.dataset.zoom));
});
$('zoom-pill').onclick = () => run(() => window.pulse.zoom('reset'));
window.addEventListener('keydown', (e) => { if (e.key === 'F11') { e.preventDefault(); window.pulse.fullscreen(); } });
$('btn-menu').onclick = (e) => { const m = $('app-menu'); if (!m.classList.contains('hidden')) return hideMenus(); place(m, e.currentTarget); };
$('app-menu').addEventListener('click', async (e) => {
  const act = e.target.dataset.act; if (!act) return; hideMenus();
  if (act === 'panel') window.pulse.openExternal(`${S.origin}/criadoras`);
  if (act === 'tags') tagsDialog();
  if (act === 'hide') run(() => window.pulse.hideAll());
  if (act === 'panel-cfg') panelDialog();
  if (act === 'focus') toggleFocus();
  if (act === 'turn-start') turnAction('start');
  if (act === 'turn-end') turnAction('end');
  if (act === 'about') { const i = await window.pulse.appInfo(); dialog({ title: 'Alta Pulse desktop', body: `<p>Versão ${esc(i.version)}<br>Electron ${esc(i.electron)} · Chromium ${esc(i.chrome)}</p><p>Painel: ${esc(S.origin)}</p><p>Dados locais: ${esc(i.dataDir)}</p>`, hideOk: true }); }
});

window.pulse.onState(apply);
window.pulse.onToast(toast);
if (window.pulse.onPortableUpdate) window.pulse.onPortableUpdate(({ version, url, quick }) => {
  let bar = document.getElementById('portable-update');
  if (!bar) { bar = document.createElement('div'); bar.id = 'portable-update'; bar.className = 'portable-update'; document.body.prepend(bar); }
  bar.innerHTML = `<span>Nova versão ${esc(version)} disponível</span><button>${quick ? 'Atualizar' : 'Baixar'}</button>`;
  const btn = bar.querySelector('button');
  btn.onclick = async () => {
    if (!quick || !window.pulse.portableUpdate) return window.pulse.openExternal(url);
    btn.disabled = true; btn.textContent = 'Atualizando…';
    try { await window.pulse.portableUpdate(); bar.querySelector('span').textContent = 'Reiniciando o Alta Pulse…'; }
    catch (err) { btn.disabled = false; btn.textContent = 'Baixar'; btn.onclick = () => window.pulse.openExternal(url); toast(`Não deu para atualizar aqui: ${err.message}`, 7000); }
  };
});
window.pulse.snapshot().then(apply);
