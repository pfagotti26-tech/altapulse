'use strict';
const $ = (id) => document.getElementById(id);
let S = null;               // último estado vindo do processo principal
const closedGroups = new Set(JSON.parse(localStorage.getItem('closedGroups') || '[]'));

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

function dialog({ title, body, okText = 'OK', onOk, hideOk = false }) {
  return new Promise((resolve) => {
    $('dialog-title').textContent = title; $('dialog-body').innerHTML = body;
    $('dialog-ok').textContent = okText; $('dialog-ok').classList.toggle('hidden', hideOk);
    $('dialog').classList.remove('hidden');
    const close = (v) => { $('dialog').classList.add('hidden'); $('dialog-ok').onclick = null; $('dialog-cancel').onclick = null; resolve(v); };
    $('dialog-ok').onclick = async () => { const v = onOk ? await onOk() : true; if (v !== false) close(v); };
    $('dialog-cancel').onclick = () => close(null);
    const first = $('dialog-body').querySelector('input, textarea'); if (first) first.focus();
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

function apply(state) {
  S = state;
  const logged = !!(S && S.user);
  $('login').classList.toggle('hidden', logged);
  $('main').classList.toggle('hidden', !logged);
  $('origin').value = S.origin || '';
  if (!logged) return;
  $('me-name').textContent = S.user.name;
  setAvatar($('me-avatar'), S.user.avatar, S.user.name);
  $('me-role').textContent = S.user.role === 'manager' ? 'Gestor' : 'Chatter';
  const warn = S.warning || (S.open.length && !S.storage_allowed ? 'Métricas desligadas no painel: ative "armazenamento" em Configurações para registrar tempo de resposta e vendas.' : '');
  $('warning').textContent = warn; $('warning').classList.toggle('hidden', !warn);
  const openTasks = (S.tasks || []).filter((t) => t.status === 'open');
  $('my-list').classList.toggle('hidden', !openTasks.length);
  if (openTasks.length) { const byReason = {}; for (const t of openTasks) byReason[t.reason || 'fãs'] = (byReason[t.reason || 'fãs'] || 0) + 1; $('my-list').innerHTML = `<b>Minha lista · ${openTasks.length}</b><small>${esc(Object.entries(byReason).map(([r, n]) => `${n} ${r.toLowerCase()}`).join(' · '))}</small>`; }
  renderList();
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
  rows.sort(by[sort] || by.az);

  const groups = [...S.local.groups.map((g) => ({ id: g.id, name: g.name })), { id: '', name: 'Sem grupo' }];
  const list = $('list'); list.innerHTML = '';
  if (!rows.length) { list.innerHTML = `<p class="empty">${S.creators.length ? 'Nenhuma criadora com esse filtro.' : 'Nenhuma criadora liberada para você. Cadastre no painel ou peça acesso ao gestor.'}</p>`; return; }
  for (const g of groups) {
    const items = rows.filter((c) => (localOf(c.id).group || '') === g.id);
    if (!items.length && g.id === '') continue;
    const el = document.createElement('div');
    el.className = 'group' + (closedGroups.has(g.id) ? ' closed' : '');
    el.innerHTML = `<div class="group-head" data-g="${esc(g.id)}"><span class="caret">▾</span><span>${esc(g.name)}</span><span class="count">${items.length}</span>${g.id ? `<button class="gmenu" data-g="${esc(g.id)}" title="Grupo">⋮</button>` : ''}</div><div class="cards"></div>`;
    const cards = el.querySelector('.cards');
    for (const c of items) cards.appendChild(card(c));
    list.appendChild(el);
  }
}

function card(c) {
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
  let chips = '';
  if (openTabs.length) chips = `<div class="chips">${openTabs.map((p) => `<span class="chip${p === cur && S.active === c.id ? ' on' : ''}${loginList.includes(p) ? ' login' : ''}" data-plat="${esc(p)}" title="${loginList.includes(p) ? (hasCred(p) ? 'Tela de login · use o botão Entrar com o acesso salvo' : 'Tela de login · sem acesso salvo no cofre') : 'Mostrar ' + esc(labelOf(p))}">${esc(labelOf(p))}<b class="chip-x" data-close="${esc(p)}" title="Fechar ${esc(labelOf(p))}">×</b></span>`).join('')}<span class="chip add" data-plat="+" title="Abrir outra plataforma neste perfil">+</span></div>`;
  const pi = S.probeInfo && S.probeInfo[c.id];
  if (!loginList.length && pi && S.user && S.user.role === 'manager' && S.open.includes(c.id)) queue += `<div class="queue" style="opacity:.5" title="${esc(JSON.stringify(pi))}">${pi.error ? 'sonda: erro' : pi.platform ? `${esc(pi.platform)} · ${pi.hasPassword ? 'login' : 'sem login'}` : 'fora das plataformas'}</div>`;
  for (const p of loginList) queue += hasCred(p) ? `<button class="vault-btn" data-vault="${esc(p)}" title="Preenche login e senha salvos pelo gestor (a senha não é exibida)">Entrar com o acesso salvo · ${esc(labelOf(p))}</button>` : `<div class="queue" title="Peça ao gestor para cadastrar o acesso no painel (ícone de chave no card da criadora)">${esc(labelOf(p))}: tela de login · sem acesso salvo</div>`;
  // botão de turno sempre à vista: "Iniciar turno" vira "Encerrar turno" (e "Pausar/Retomar") enquanto o turno é seu
  const mine = c.shift && c.shift.operator_id === S.user.id;
  let shiftBtn = '';
  if (!c.shift) shiftBtn = `<div class="shift-row"><button class="shift-btn start" data-shift="start">Iniciar turno</button></div>`;
  else if (mine) shiftBtn = `<div class="shift-row"><button class="shift-btn end" data-shift="end">Encerrar turno</button><button class="shift-btn pause" data-shift="${c.shift.paused ? 'resume' : 'pause'}" title="${c.shift.paused ? 'Voltar a atender' : 'Pausa rápida (banheiro, almoço)'}">${c.shift.paused ? 'Retomar' : 'Pausar'}</button></div>`;
  const el = document.createElement('div');
  el.className = 'card' + (S.open.includes(c.id) ? ' open' : '') + (S.active === c.id ? ' active' : '');
  el.dataset.id = c.id;
  const unread = rd && rd.waitingRecent ? rd.waitingRecent : 0;
  const bubble = unread ? `<span class="bubble" title="${unread} conversa${unread === 1 ? '' : 's'} sem resposta nas últimas 24 h">${unread > 99 ? '99+' : unread}</span>` : '';
  el.innerHTML = `<div class="avatar ${esc(c.color)}">${esc(initials(c.name))}${bubble}</div>
    <div class="info"><div class="name">${esc(c.name)}</div><div class="status ${st.cls}">${c.shift && c.shift.operator_avatar && /^data:image\//.test(c.shift.operator_avatar) ? `<img class="op-photo" src="${esc(c.shift.operator_avatar)}" alt="">` : ''}${esc(st.text)}</div>${chips}${queue}${shiftBtn}</div>
    ${tag ? `<span class="tagdot" style="background:${esc(tag.color)}" title="${esc(tag.name)}"></span>` : ''}
    <button class="cmenu" title="Opções">⋮</button>`;
  el.addEventListener('click', (e) => { if (e.target.closest('.cmenu') || e.target.closest('.vault-btn') || e.target.closest('.chip') || e.target.closest('.shift-btn')) return; openCreator(c); });
  el.querySelectorAll('.shift-btn').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); shiftClick(c, b.dataset.shift); }));
  el.querySelectorAll('.vault-btn').forEach((vb) => vb.addEventListener('click', (e) => { e.stopPropagation(); vaultLogin(c, vb.dataset.vault); }));
  el.querySelectorAll('.chip').forEach((ch) => ch.addEventListener('click', (e) => {
    e.stopPropagation();
    const x = e.target.closest('.chip-x'); if (x) return run(() => window.pulse.closeTab(c.id, x.dataset.close));
    const p = ch.dataset.plat; if (p === '+') return platformDialog(c);
    run(() => window.pulse.showProfile(c.id, p));
  }));
  el.querySelector('.cmenu').addEventListener('click', (e) => { e.stopPropagation(); creatorMenu(c, e.currentTarget); });
  return el;
}

async function vaultLogin(c, platform) {
  if (platform) await run(() => window.pulse.showProfile(c.id, platform));
  const r = await run(() => window.pulse.vaultUse(c.id, platform));
  if (r && r.ok) toast(r.clicked ? 'Login preenchido e enviado. Se a plataforma pedir código (2FA), digite na tela.' : 'Login e senha preenchidos. Clique em Entrar na tela.');
}
async function openCreator(c, platform) {
  if (S.open.includes(c.id) && !platform) return run(() => window.pulse.showProfile(c.id));
  if (c.shift && c.shift.operator_id !== S.user.id) {
    const ok = await dialog({ title: 'Criadora em atendimento', body: `<p>${esc(c.shift.operator_name)} está com o turno ativo de <b>${esc(c.name)}</b>. Abrir mesmo assim só para acompanhar? Você não vai conseguir iniciar turno enquanto o dele estiver ativo.</p>`, okText: 'Abrir' });
    if (!ok) return;
  }
  await run(() => window.pulse.openProfile(c.id, platform || 'privacy'));
  if (!c.shift && !platform) offerShift(c);
}
async function platformDialog(c) {
  const plats = S.platforms || {}; const creds = (S.credentials || []).filter((x) => x.creator_id === c.id);
  const body = `<p>Abrir no perfil isolado de <b>${esc(c.name)}</b>:</p><div class="plat-list">${Object.keys(plats).map((id) => `<button class="plat" data-plat="${esc(id)}">${esc(plats[id].label)}${creds.some((x) => x.platform === id) ? ' <span class="plat-ok" title="acesso salvo no cofre">🔑</span>' : ''}</button>`).join('')}</div>`;
  const p = dialog({ title: 'Abrir plataforma', body, hideOk: true });
  $('dialog-body').querySelectorAll('.plat').forEach((b) => b.addEventListener('click', () => { $('dialog-cancel').onclick(); openCreator(c, b.dataset.plat); }));
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
  const ok = await dialog({ title: 'Iniciar turno?', body: `<p>Registrar que você está atendendo <b>${esc(c.name)}</b> a partir de agora. O gestor vê presença e horário; nada da conversa é enviado.</p>`, okText: 'Iniciar turno' });
  if (ok) run(() => window.pulse.startShift(c.id), 'Turno iniciado.');
}

// ---------- menu da criadora ----------
function creatorMenu(c, anchor) {
  const m = $('creator-menu'); const isOpen = S.open.includes(c.id);
  const mine = c.shift && c.shift.operator_id === S.user.id;
  const items = [];
  items.push(isOpen ? ['Mostrar', () => window.pulse.showProfile(c.id)] : ['Abrir perfil', () => openCreator(c)]);
  if (isOpen) { items.push(['Recarregar', () => window.pulse.reloadProfile(c.id)]); items.push(['Voltar', () => window.pulse.backProfile(c.id)]); }
  items.push(['Abrir plataforma…', () => platformDialog(c)]);
  for (const lp of (S.loginPages && S.loginPages[c.id]) || []) if ((S.credentials || []).some((x) => x.creator_id === c.id && x.platform === lp)) items.push([`Entrar com o acesso salvo · ${S.platforms && S.platforms[lp] ? S.platforms[lp].label : lp}`, () => vaultLogin(c, lp)]);
  items.push('-');
  if (!c.shift) items.push(['Iniciar turno', () => run(() => window.pulse.startShift(c.id), 'Turno iniciado.')]);
  if (mine && !c.shift.paused) items.push(['Pausar turno', () => run(() => window.pulse.shiftAction(c.shift.id, 'pause'), 'Turno pausado.')]);
  if (mine && c.shift.paused) items.push(['Retomar turno', () => run(() => window.pulse.shiftAction(c.shift.id, 'resume'), 'Turno retomado.')]);
  if (mine || (c.shift && S.user.role === 'manager')) items.push(['Encerrar turno', () => run(() => window.pulse.shiftAction(c.shift.id, 'end'), 'Turno encerrado.')]);
  items.push('-');
  items.push(['Anotações', () => notesDialog(c)]);
  items.push(['Mover para grupo', () => groupDialog(c)]);
  items.push(['Etiqueta', () => tagDialog(c)]);
  items.push('-');
  if (isOpen || S.user.role === 'manager') items.push(['Ler extrato de vendas agora', () => run(() => window.pulse.readExtrato(c.id), 'Extrato lido.')]);
  if (isOpen && S.user.role === 'manager') items.push(['Mostrar/esconder aba do extrato (diagnóstico)', () => window.pulse.toggleExtrato(c.id)]);
  if (isOpen) items.push(['Capturar estrutura da tela (calibração)', () => calibrate(c)]);
  if (S.user.role === 'manager') items.push(['Capturar Meu Privacy → Assinantes (calibração)', async () => { const r = await run(() => window.pulse.calibrateStats(c.id, 'assinantes')); if (r && r.ok) toast(`Estrutura salva (${r.size} caracteres): ${r.file}`); }]);
  items.push(['Limpar cache', () => run(() => window.pulse.clearProfile(c.id, 'cache'), 'Cache limpo.')]);
  items.push(['Sair da conta da Privacy (limpar cookies)', async () => { const ok = await dialog({ title: 'Sair da conta', body: `<p>Isso apaga o login da Privacy de <b>${esc(c.name)}</b> neste computador. Vai ser preciso entrar de novo.</p>`, okText: 'Limpar' }); if (ok) run(() => window.pulse.clearProfile(c.id, 'cookies'), 'Sessão apagada.'); }, 'danger']);
  if (isOpen) items.push([((S.tabs && S.tabs[c.id]) || []).length > 1 ? 'Fechar todas as abas' : 'Fechar perfil', () => run(() => window.pulse.closeProfile(c.id))]);
  m.innerHTML = '';
  for (const it of items) {
    if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button'); b.textContent = it[0]; if (it[2]) b.className = it[2];
    b.onclick = () => { hideMenus(); it[1](); }; m.appendChild(b);
  }
  place(m, anchor);
}
function place(m, anchor) {
  const r = anchor.getBoundingClientRect(); m.classList.remove('hidden');
  const top = Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 8);
  m.style.top = `${Math.max(8, top)}px`; m.style.left = `${Math.min(r.left, window.innerWidth - m.offsetWidth - 8)}px`;
}

async function calibrate(c) {
  const ok = await dialog({ title: 'Capturar estrutura da tela', body: `<p>Com uma <b>conversa aberta</b> na Privacy de ${esc(c.name)} (espere as mensagens carregarem), o app envia ao painel só o esqueleto da tela: caixas, classes e horários.</p><p>Nomes de fãs e o texto das mensagens <b>não</b> são enviados.</p>`, okText: 'Capturar' });
  if (!ok) return;
  toast('Capturando...');
  const r = await run(() => window.pulse.calibrate(c.id));
  if (r && r.ok) toast(r.sent ? '✓ Estrutura enviada ao painel e salva localmente.' : '✓ Estrutura salva localmente (painel indisponível).', 6000);
}

// ---------- diálogos ----------
function notesDialog(c) {
  const cur = localOf(c.id).notes || '';
  dialog({ title: `Anotações · ${c.name}`, body: `<textarea id="dlg-notes">${esc(cur)}</textarea><p>Ficam só neste computador nesta fase.</p>`, okText: 'Salvar',
    onOk: () => window.pulse.setCreatorLocal(c.id, { notes: $('dlg-notes').value }) });
}
function groupDialog(c) {
  const cur = localOf(c.id).group || '';
  const opts = [{ id: '', name: 'Sem grupo' }, ...S.local.groups].map((g) => `<button class="ghost choice ${g.id === cur ? 'sel' : ''}" data-g="${esc(g.id)}">${esc(g.name)}</button>`).join('');
  dialog({ title: `Grupo · ${c.name}`, body: opts || '<p>Crie um grupo primeiro.</p>', hideOk: true }).then(() => {});
  $('dialog-body').querySelectorAll('.choice').forEach((b) => b.onclick = async () => { await window.pulse.setCreatorLocal(c.id, { group: b.dataset.g }); $('dialog').classList.add('hidden'); });
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
  const m = $('creator-menu'); m.innerHTML = '';
  const add = (label, fn, cls) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = () => { hideMenus(); fn(); }; m.appendChild(b); };
  add('Renomear grupo', () => dialog({ title: 'Renomear grupo', body: `<input id="dlg-group" value="${esc(g.name)}" maxlength="40">`, okText: 'Salvar',
    onOk: async () => { const name = $('dlg-group').value.trim(); if (!name) return false; await window.pulse.setGroups(S.local.groups.map((x) => x.id === gid ? { ...x, name } : x)); } }));
  add('Excluir grupo (criadoras ficam sem grupo)', async () => {
    const ok = await dialog({ title: 'Excluir grupo', body: `<p>Excluir <b>${esc(g.name)}</b>? As criadoras não são apagadas, só perdem o grupo.</p>`, okText: 'Excluir' });
    if (!ok) return;
    for (const [id, l] of Object.entries(S.local.creators || {})) if (l.group === gid) await window.pulse.setCreatorLocal(id, { group: '' });
    await window.pulse.setGroups(S.local.groups.filter((x) => x.id !== gid));
  }, 'danger');
  place(m, anchor);
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
$('btn-refresh').onclick = () => run(() => window.pulse.getState());
$('btn-new-group').onclick = newGroupDialog;
$('search').addEventListener('input', renderList);
$('sort').addEventListener('change', renderList);
$('only-open').addEventListener('change', renderList);
$('list').addEventListener('click', (e) => {
  const gm = e.target.closest('.gmenu'); if (gm) { e.stopPropagation(); groupMenu(gm.dataset.g, gm); return; }
  const head = e.target.closest('.group-head'); if (!head) return;
  const gid = head.dataset.g; const g = head.parentElement; g.classList.toggle('closed');
  if (g.classList.contains('closed')) closedGroups.add(gid); else closedGroups.delete(gid);
  localStorage.setItem('closedGroups', JSON.stringify([...closedGroups]));
});
$('btn-menu').onclick = (e) => { const m = $('app-menu'); if (!m.classList.contains('hidden')) return hideMenus(); place(m, e.currentTarget); };
$('app-menu').addEventListener('click', async (e) => {
  const act = e.target.dataset.act; if (!act) return; hideMenus();
  if (act === 'panel') window.pulse.openExternal(`${S.origin}/criadoras`);
  if (act === 'tags') tagsDialog();
  if (act === 'hide') run(() => window.pulse.hideAll());
  if (act === 'about') { const i = await window.pulse.appInfo(); dialog({ title: 'Alta Pulse desktop', body: `<p>Versão ${esc(i.version)}<br>Electron ${esc(i.electron)} · Chromium ${esc(i.chrome)}</p><p>Painel: ${esc(S.origin)}</p><p>Dados locais: ${esc(i.dataDir)}</p>`, hideOk: true }); }
});

window.pulse.onState(apply);
window.pulse.onToast(toast);
window.pulse.snapshot().then(apply);
