// Alta Pulse desktop — fase 1 (paridade com o Lauth)
//
// Uma janela: lateral de criadoras à esquerda e, à direita, um perfil isolado por criadora
// (cookies, login e cache separados). Fala com o painel altapulse.com.br pela mesma API da
// extensão Chrome (/api/extension/*). Nenhuma senha ou cookie da Privacy sai deste computador.
'use strict';
const { app, BaseWindow, WebContentsView, ipcMain, session, safeStorage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const CALIBRATION_SCRIPT = require('./calibration.js');
const READER_SCRIPT = require('./reader-page.js');
const { CreatorReader } = require('./reader.js');
const EXTRATO = require('./extrato-page.js');
const SNAPSHOT = require('./snapshot-page.js');
const { ExtratoReader } = require('./extrato.js');
const { PLATFORMS, platformOf, allowedUrl, fillScript, LOGIN_PROBE } = require('./platforms.js');
const crypto = require('crypto');

// ---------- identificação do navegador ----------
// O Electron é um Chromium. Por padrão ele acrescenta "AppName/x Electron/y" ao user-agent e o
// firewall da Privacy bloqueia isso com 403 (comprovado na fase 0). Aqui ele se apresenta como o
// Chromium que de fato é, sem fingir outro navegador nem outro sistema.
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.userAgentFallback = UA;

// ---------- configuração ----------
const DEFAULT_ORIGIN = 'https://altapulse.com.br';
const PRIVACY_HOME = 'https://privacy.com.br/';
const SIDEBAR_WIDTH = 300;
const HEARTBEAT_MS = 15000;
const READ_MS = 10000;
const STATE_REFRESH_MS = 20000;
const EXTRATO_MS = 10 * 60 * 1000;      // leitura do extrato (aba oculta) a cada 10 min
const EXTRATO_FIRST_MS = 30 * 1000;     // primeira leitura 30 s depois de abrir a criadora
const SNAPSHOT_MS = 60 * 60 * 1000;     // retrato da criadora (Visão geral) a cada hora
const STATS_URL = 'https://privacy.com.br/myprivacystats';
// A aba oculta precisa de tela de desktop de verdade: fora da janela o Chromium recorta para 0 px e a
// Privacy monta o layout de celular (sem abas); recortada a uma faixa, a lista de transações não é
// renderizada (carregamento sob demanda quando entra na área visível). Então ela ocupa a MESMA área da
// criadora ativa, mas por baixo dela (índice 0): totalmente coberta e ainda assim "visível" para a página.
// Sem criadora ativa, encosta na borda de baixo da janela (aparece só uma faixa de 2 px).
// Detalhe do Windows: uma aba TOTALMENTE coberta por outra é tratada como "oculta" pelo Chromium
// (document.visibilityState = hidden) e a Privacy para de renderizar a lista. Por isso a aba da criadora
// deixa uma coluna de 2 px livre na borda direita, onde a aba do extrato aparece: isso basta para ela
// continuar "visível" e renderizar normalmente.
const PEEK = 2;
function hiddenBounds() {
  const [w, h] = win.getContentSize(); const width = Math.max(w - SIDEBAR_WIDTH, 1000);
  return activeId && views.has(activeId) ? { x: SIDEBAR_WIDTH, y: 0, width, height: h } : { x: SIDEBAR_WIDTH, y: h - PEEK, width, height: 900 };
}

const dataDir = () => app.getPath('userData');
const filePath = (name) => path.join(dataDir(), name);

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath(name), 'utf8')); } catch { return fallback; }
}
function writeJson(name, value) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(filePath(name), JSON.stringify(value, null, 2));
}

let config = readJson('config.json', { origin: DEFAULT_ORIGIN });
// grupos, etiquetas e anotações ficam locais nesta fase (vão para o servidor na fase 3)
let local = readJson('local.json', { groups: [], tags: [
  { id: 'vermelha', name: 'Prioridade', color: '#C41E3A' },
  { id: 'laranja', name: 'Nova', color: '#f28c28' },
  { id: 'verde', name: 'Ativa', color: '#3cb371' },
  { id: 'azul', name: 'Treinamento', color: '#4a90e2' },
  { id: 'roxa', name: 'Outro', color: '#9b6bd6' },
], creators: {} });
const saveLocal = () => writeJson('local.json', local);
// grupos são identificados pelo nome no servidor; localmente têm id
function groupIdFor(name) {
  let g = local.groups.find((x) => x.name === name);
  if (!g) { g = { id: 'g' + Date.now() + Math.random().toString(36).slice(2, 6), name }; local.groups.push(g); }
  return g.id;
}
function groupName(id) { const g = local.groups.find((x) => x.id === id); return g ? g.name : ''; }

// ---------- token ----------
function readToken() {
  try {
    const raw = fs.readFileSync(filePath('token.bin'));
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
  } catch { return null; }
}
function writeToken(token) {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (!token) { try { fs.unlinkSync(filePath('token.bin')); } catch {} return; }
  fs.writeFileSync(filePath('token.bin'), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(token, 'utf8'));
}

// segredo local para os hashes de referência (nunca sai do computador)
function localSecret() {
  try { const raw = fs.readFileSync(filePath('secret.bin')); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8'); }
  catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(filePath('secret.bin'), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(secret) : Buffer.from(secret, 'utf8'));
    return secret;
  }
}

// ---------- API do painel (chamada só pelo processo principal, nunca pela página da Privacy) ----------
let token = null; // lido só depois do app ficar pronto (safeStorage depende disso no Windows)
let state = { user: null, creators: [], sla_minutes: 5, version: null, storage_allowed: false };
let credentials = []; // acessos salvos (sem senha) das criadoras do usuário
const loginPages = new Map(); // creatorId -> plataforma cuja tela de login está aberta

async function api(method, route, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${config.origin}/api${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (error) {
    throw new Error('Sem conexão com o painel Alta Pulse. Verifique a internet.');
  }
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    if (response.status === 401) { token = null; writeToken(null); state = { ...state, user: null, creators: [] }; }
    let detail = data && data.detail;
    if (Array.isArray(detail)) detail = detail.map((d) => (d && d.msg ? `${(d.loc || []).slice(-1)[0] || ''}: ${d.msg}` : JSON.stringify(d))).join('; ').slice(0, 300);
    throw new Error(detail || `Erro ${response.status} no painel.`);
  }
  return data;
}

async function refreshState() {
  if (!token) return state;
  try {
    const data = await api('GET', '/extension/state');
    state = { user: data.user, creators: data.creators, sla_minutes: data.sla_minutes, version: data.version, storage_allowed: !!data.storage_allowed, fan_names_allowed: !!data.fan_names_allowed };
    try { credentials = await api('GET', '/extension/credentials'); } catch { /* painel antigo sem cofre */ }
    // grupo/etiqueta/anotações: o servidor é a fonte quando o painel já tem esses campos
    let changed = false;
    for (const c of data.creators) {
      if (c.group === undefined) continue; // painel antigo, sem os campos: fica só local
      const l = local.creators[c.id] || {};
      const gid = c.group ? groupIdFor(c.group) : '';
      if (l.group !== gid || l.tag !== (c.tag || '') || l.notes !== (c.notes || '')) { local.creators[c.id] = { ...l, group: gid, tag: c.tag || '', notes: c.notes || '' }; changed = true; }
    }
    if (changed) saveLocal();
  } catch (error) {
    if (!token) state = { ...state, user: null, creators: [] };
    else state = { ...state, warning: error.message };
  }
  pushState();
  return state;
}

// ---------- janela, lateral e perfis ----------
let win, sidebar;
const views = new Map(); // creatorId -> WebContentsView
let activeId = null;

function pushState() { if (sidebar && !sidebar.webContents.isDestroyed()) sidebar.webContents.send('state', publicState()); }
function publicState() {
  return {
    ...state,
    origin: config.origin,
    local,
    open: [...views.keys()],
    active: activeId,
    urls: Object.fromEntries([...views].map(([id, v]) => [id, v.webContents.getURL()])),
    readers: Object.fromEntries([...readers].map(([id, r]) => [id, r.summary || null])),
    extratos: Object.fromEntries([...extratos].map(([id, x]) => [id, x.summary || null])),
    platforms: PLATFORMS,
    credentials: credentials.map((c) => ({ id: c.id, creator_id: c.creator_id, platform: c.platform, login: c.login, has_password: c.has_password })),
    loginPages: Object.fromEntries(loginPages),
  };
}

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  sidebar.setBounds({ x: 0, y: 0, width: SIDEBAR_WIDTH, height: h });
  for (const [id, v] of views) {
    v.setBounds({ x: SIDEBAR_WIDTH, y: 0, width: Math.max(w - SIDEBAR_WIDTH - PEEK, 200), height: h });
    v.setVisible(id === activeId);
  }
  for (const x of extratos.values()) if (x.view && !x.shown && !x.view.webContents.isDestroyed()) x.view.setBounds(hiddenBounds());
}

function partitionFor(creatorId) { return `persist:creator-${creatorId}`; }

function openProfile(creatorId, platform = 'privacy') {
  const home = (PLATFORMS[platform] || PLATFORMS.privacy).home;
  if (views.has(creatorId)) {
    activeId = creatorId; layout(); pushState();
    const v = views.get(creatorId);
    if (platform && platformOf(v.webContents.getURL()) !== platform) v.webContents.loadURL(home, { userAgent: UA });
    return;
  }
  const ses = session.fromPartition(partitionFor(creatorId));
  ses.setUserAgent(UA);
  const view = new WebContentsView({
    webPreferences: { partition: partitionFor(creatorId), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  view.webContents.setUserAgent(UA);
  // pop-ups do próprio site (login social, por exemplo) abrem na mesma sessão isolada
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url) && allowedUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: partitionFor(creatorId), contextIsolation: true, sandbox: true } } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  view.webContents.on('did-navigate', () => pushState());
  view.webContents.on('did-navigate-in-page', () => pushState());
  view.webContents.on('did-fail-load', (_e, code, description, url, isMain) => {
    if (isMain && sidebar) sidebar.webContents.send('toast', `Falha ao abrir a Privacy (${code} ${description}).`);
  });
  win.contentView.addChildView(view);
  views.set(creatorId, view);
  activeId = creatorId;
  layout();
  view.webContents.loadURL(home, { userAgent: UA });
  pushState();
  scheduleExtrato(creatorId, EXTRATO_FIRST_MS);
}

function closeProfile(creatorId) {
  const view = views.get(creatorId);
  if (!view) return;
  win.contentView.removeChildView(view);
  view.webContents.close();
  views.delete(creatorId);
  closeStatsView(creatorId);
  if (activeId === creatorId) activeId = views.size ? [...views.keys()].at(-1) : null;
  layout();
  pushState();
}

async function clearProfileData(creatorId, what) {
  const ses = session.fromPartition(partitionFor(creatorId));
  if (what === 'cache' || what === 'tudo') await ses.clearCache();
  if (what === 'cookies' || what === 'tudo') await ses.clearStorageData();
  const view = views.get(creatorId);
  if (view) view.webContents.loadURL(PRIVACY_HOME, { userAgent: UA });
}

// ---------- leitor (fase 2) ----------
const readers = new Map(); // creatorId -> { reader, summary, lastError }
function readerFor(id) {
  if (!readers.has(id)) {
    const store = readJson(`reader-${id}.json`, null);
    readers.set(id, { reader: new CreatorReader(id, localSecret(), store, { fanNames: !!state.fan_names_allowed }), summary: null, lastError: null });
  }
  return readers.get(id);
}
async function readAll() {
  if (!state.user) return;
  for (const [id, view] of views) {
    const r = readerFor(id); r.reader.options.fanNames = !!state.fan_names_allowed;
    // tela de login de alguma plataforma? (para oferecer "Entrar com o acesso salvo")
    try {
      const url = view.webContents.getURL(); const platform = platformOf(url);
      const hasPassword = platform ? await view.webContents.executeJavaScript(LOGIN_PROBE, true) : false;
      if (hasPassword && platform) loginPages.set(id, platform); else loginPages.delete(id);
    } catch { loginPages.delete(id); }
    let data;
    try { data = await view.webContents.executeJavaScript(READER_SCRIPT, true); } catch { continue; }
    if (!data || data.page !== 'chat') { r.summary = { waiting: 0, oldestWaitMin: null, page: data ? data.page : 'other', readAt: new Date().toISOString() }; continue; }
    let { events, summary } = r.reader.process(data, new Date());
    r.summary = summary;
    writeJson(`reader-${id}.json`, r.reader.s);
    const creator = state.creators.find((c) => c.id === id);
    const shift = creator && creator.shift;
    const mine = shift && shift.operator_id === state.user.id && !shift.paused;
    // com o extrato funcionando para esta criadora, a venda inferida pela lista de conversas não é
    // enviada (o extrato traz a mesma venda com hora, produto e situação exatos; evita contar em dobro)
    if (extratoHealthy(id)) events = events.filter((e) => e.kind !== 'sale');
    if (!events.length) continue;
    if (!mine || !state.storage_allowed) { r.summary.dropped = (r.summary.dropped || 0) + events.length; continue; }
    try {
      const out = await api('POST', '/extension/observations', { events: events.slice(0, 200) });
      r.summary.accepted = out.accepted; r.lastError = null;
    } catch (error) { r.lastError = error.message; r.summary.error = error.message; }
  }
  pushState();
}

// ---------- extrato (bloco A) ----------
// Para cada criadora aberta, uma aba OCULTA do mesmo perfil carrega "Meu Privacy → Extratos" a cada
// 10 min e lê as transações. Não toca na aba de chat do chatter nem marca conversa como lida.
// As vendas vão com o instante exato do extrato; a atribuição ao turno é feita pelo painel.
const extratos = new Map(); // creatorId -> { view, reader, summary, timer, busy }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extratoHealthy(id) {
  const x = extratos.get(id); const at = x && x.summary && x.summary.readAt && !x.summary.error ? Date.parse(x.summary.readAt) : 0;
  return at && Date.now() - at < 3 * EXTRATO_MS;
}
function extratoFor(id) {
  if (!extratos.has(id)) {
    const store = readJson(`extrato-${id}.json`, null);
    extratos.set(id, { view: null, reader: new ExtratoReader(id, localSecret(), store, { fanNames: !!state.fan_names_allowed }), summary: null, timer: null, busy: false });
  }
  return extratos.get(id);
}
function statsView(id) {
  const x = extratoFor(id);
  if (x.view && !x.view.webContents.isDestroyed()) return x.view;
  const view = new WebContentsView({ webPreferences: { partition: partitionFor(id), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  view.webContents.setUserAgent(UA);
  view.webContents.setAudioMuted(true);
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // fica por BAIXO das outras abas (índice 0) e com tamanho de tela de desktop: com uma janela minúscula
  // a Privacy montava o layout de celular (sem as abas) e com setVisible(false) não terminava de carregar
  win.contentView.addChildView(view, 0);
  view.setBounds(hiddenBounds());
  x.view = view;
  return view;
}
function closeStatsView(id) {
  const x = extratos.get(id); if (!x) return;
  clearTimeout(x.timer); x.timer = null;
  if (x.view && !x.view.webContents.isDestroyed()) { win.contentView.removeChildView(x.view); x.view.webContents.close(); }
  x.view = null;
}
function scheduleExtrato(id, ms) {
  const x = extratoFor(id); clearTimeout(x.timer);
  x.timer = setTimeout(() => readExtrato(id).catch(() => {}), ms);
}
async function loadStats(view) {
  await new Promise((resolve) => {
    const done = () => { view.webContents.removeListener('did-finish-load', done); view.webContents.removeListener('did-fail-load', done); resolve(); };
    view.webContents.once('did-finish-load', done); view.webContents.once('did-fail-load', done);
    view.webContents.loadURL(STATS_URL, { userAgent: UA });
    setTimeout(done, 25000);
  });
  await sleep(4000); // SPA termina de montar
}
async function readExtrato(id) {
  const x = extratoFor(id);
  if (!views.has(id) || !state.user || x.busy) return;
  x.busy = true;
  try {
    x.reader.options.fanNames = !!state.fan_names_allowed;
    const view = statsView(id);
    const run = (action) => view.webContents.executeJavaScript(EXTRATO.script(action), true);
    if (!/myprivacystats/i.test(view.webContents.getURL())) await loadStats(view);
    let info = await run('tab');
    if (!info.onStats) { await loadStats(view); info = await run('tab'); }
    // a página monta aos poucos: espera a aba "Extratos" aparecer (até ~30 s)
    for (let i = 0; i < 12 && !info.hadTab; i++) { await sleep(2500); info = await run('tab'); }
    if (!info.hadTab) { // sem login na Privacy nesta aba, ou o layout mudou
      const url = view.webContents.getURL();
      x.summary = { error: (/login|entrar|auth/i.test(url) || info.loggedOut ? 'login' : 'sem aba Extratos') + ` (${url.slice(0, 80)}) ${JSON.stringify(info).slice(0, 200)}`, readAt: new Date().toISOString(), rows: 0 };
      return;
    }
    let data = await run('read');
    for (let i = 0; i < 8 && !(data.rows || []).length; i++) { await sleep(2500); data = await run('read'); }
    // primeira leitura desta criadora: carrega o histórico do período (até 15 "ver mais")
    if (!x.reader.s.backfilled) {
      for (let i = 0; i < 15 && data.hasMore; i++) { await run('more'); await sleep(1800); data = await run('read'); }
      x.reader.s.backfilled = true;
    }
    const { events, summary } = x.reader.process(data.rows || [], new Date());
    x.summary = { ...summary, period: data.period, sent: 0, dbg: JSON.stringify({ tabActive: data.tabActive, ...(data.dbg || {}) }) };
    if (events.length && state.storage_allowed) {
      const accepted = [];
      for (let i = 0; i < events.length; i += 150) {
        const out = await api('POST', '/extension/observations', { events: events.slice(i, i + 150) });
        for (const r of out.results || []) if (r.ok) accepted.push(r.event_ref);
        const rejected = (out.results || []).filter((r) => !r.ok);
        if (rejected.length) x.summary.rejected = (x.summary.rejected || 0) + rejected.length, x.summary.lastReject = rejected[0].detail;
      }
      x.reader.markSent(accepted); x.summary.sent = accepted.length;
    } else x.reader.markSent([]);
    if (!state.storage_allowed) x.summary.dropped = events.length;
    // bloco B: retrato da criadora (Visão geral) a cada hora, na mesma aba oculta
    if (state.storage_allowed && (!x.snapshotAt || Date.now() - x.snapshotAt > SNAPSHOT_MS)) {
      try {
        const t = await view.webContents.executeJavaScript(SNAPSHOT.script('tab'), true);
        if (t.hadTab) {
          await sleep(3500);
          let snap = await view.webContents.executeJavaScript(SNAPSHOT.script('read'), true);
          for (let i = 0; i < 4 && !snap.ok; i++) { await sleep(2500); snap = await view.webContents.executeJavaScript(SNAPSHOT.script('read'), true); }
          if (snap.ok) { await api('POST', '/extension/snapshots', { creator_id: id, taken_at: snap.readAt, period: snap.period || null, data: snap }); x.snapshotAt = Date.now(); x.summary.snapshot = snap.readAt; }
          else x.summary.snapshotError = 'sem dados na Visão geral';
        }
      } catch (error) { x.summary.snapshotError = error.message.slice(0, 120); }
    }
    writeJson(`extrato-${id}.json`, x.reader.s);
  } catch (error) {
    const old = /Extra inputs are not permitted/.test(error.message);
    x.summary = { ...(x.summary || {}), error: old ? 'painel desatualizado: publique a versão nova do Alta Pulse' : error.message, readAt: new Date().toISOString() };
  } finally {
    x.busy = false; pushState();
    if (views.has(id)) scheduleExtrato(id, EXTRATO_MS);
  }
}
ipcMain.handle('extrato:read', async (_e, id) => { await readExtrato(id); return publicState(); });
// diagnóstico: mostra/esconde a aba oculta do extrato no lugar da aba da criadora
ipcMain.handle('extrato:toggle', (_e, id) => {
  const x = extratos.get(id); if (!x || !x.view || x.view.webContents.isDestroyed()) return false;
  const [w, h] = win.getContentSize(); const show = !x.shown;
  x.view.setBounds(show ? { x: SIDEBAR_WIDTH, y: 0, width: Math.max(w - SIDEBAR_WIDTH, 200), height: h } : hiddenBounds());
  if (show) { for (const v of views.values()) v.setVisible(false); x.shown = true; } else { x.shown = false; layout(); }
  return show;
});

// ---------- presença (heartbeat) ----------
// Só para criadoras abertas aqui cujo turno ativo é do usuário logado. Nada da página é lido:
// vai apenas "aba aberta", "está no chat ou não" e "sem leitura de dados" (leitor chega na fase 2).
async function heartbeats() {
  if (!token || !state.user) return;
  for (const [id, view] of views) {
    const creator = state.creators.find((c) => c.id === id);
    const shift = creator && creator.shift;
    if (!shift || shift.operator_id !== state.user.id) continue;
    const url = view.webContents.getURL();
    try {
      const r = readers.get(id); const onChat = /\/chat/i.test(url);
      await api('POST', '/extension/heartbeat', { creator_id: id, source: 'desktop', page: onChat ? 'chat' : 'other', observation_state: onChat && r && r.summary && !shift.paused ? 'partial' : 'no_data' });
    } catch {}
  }
}

// ---------- IPC ----------
ipcMain.handle('auth:login', async (_e, { email, password }) => {
  token = null;
  const data = await api('POST', '/extension/login', { email, password, device_name: `Alta Pulse desktop (${require('os').hostname()})` });
  token = data.token; writeToken(token);
  await refreshState();
  return publicState();
});
ipcMain.handle('auth:logout', async () => {
  try { if (token) await api('POST', '/extension/logout'); } catch {}
  token = null; writeToken(null);
  for (const id of [...views.keys()]) closeProfile(id);
  state = { user: null, creators: [], sla_minutes: 5, version: null };
  pushState();
  return publicState();
});
ipcMain.handle('state:get', async () => { await refreshState(); return publicState(); });
ipcMain.handle('state:snapshot', () => publicState());

ipcMain.handle('profile:open', (_e, id, platform) => { openProfile(id, platform || 'privacy'); return publicState(); });
// cofre: pede login/senha ao painel (auditado) e preenche o formulário da plataforma aberta. A senha
// não passa pela lateral: vai do painel para o processo principal e daí para a página, e é descartada.
ipcMain.handle('vault:use', async (_e, creatorId) => {
  const view = views.get(creatorId); if (!view) throw new Error('Abra a criadora primeiro.');
  const url = view.webContents.getURL(); const platform = platformOf(url);
  if (!platform) throw new Error('A aba não está numa plataforma conhecida.');
  const cred = credentials.find((c) => c.creator_id === creatorId && c.platform === platform);
  if (!cred) throw new Error(`Não há acesso salvo de ${PLATFORMS[platform].label} para esta criadora. Peça ao gestor para cadastrar no painel.`);
  const data = await api('POST', `/extension/credentials/${cred.id}/use`, {});
  let result;
  try { result = await view.webContents.executeJavaScript(fillScript(data.login, data.password), true); } finally { data.password = null; }
  if (!result || !result.ok) throw new Error('Não encontrei o formulário de login nesta tela (' + ((result && result.reason) || 'sem resposta') + ').');
  loginPages.delete(creatorId); pushState();
  return { ok: true, clicked: result.clicked, user: result.user };
});
ipcMain.handle('profile:show', (_e, id) => { if (views.has(id)) { activeId = id; layout(); pushState(); } return publicState(); });
ipcMain.handle('profile:close', (_e, id) => { closeProfile(id); return publicState(); });
ipcMain.handle('profile:reload', (_e, id) => { const v = views.get(id); if (v) v.webContents.reload(); return true; });
ipcMain.handle('profile:back', (_e, id) => { const v = views.get(id); if (v && v.webContents.canGoBack()) v.webContents.goBack(); return true; });
ipcMain.handle('profile:clear', async (_e, { id, what }) => { await clearProfileData(id, what); return true; });
ipcMain.handle('profile:hideAll', () => { activeId = null; layout(); pushState(); return publicState(); });

// Calibração (fase 2): envia ao painel só o esqueleto da tela aberta (tags, classes, horários),
// com nomes e textos mascarados, para escrever a leitura de tempo de resposta e vendas.
ipcMain.handle('profile:calibrate', async (_e, id) => {
  const view = views.get(id);
  if (!view) throw new Error('Abra a criadora primeiro.');
  const url = view.webContents.getURL();
  if (!/privacy\.com\.br/i.test(url)) throw new Error('Abra uma conversa da Privacy antes de capturar.');
  const outline = await view.webContents.executeJavaScript(CALIBRATION_SCRIPT, true);
  if (!outline || outline.length < 200) throw new Error('A tela ainda não carregou. Espere aparecerem as mensagens e tente de novo.');
  // cópia local (mesmo conteúdo mascarado) para análise sem depender do banco do painel
  const dir = path.join(dataDir(), 'calibracoes'); fs.mkdirSync(dir, { recursive: true }); // fora do pacote (asar é só leitura)
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
  fs.writeFileSync(file, `<!-- ${url} -->\n${outline}`);
  let sent = true;
  try { await api('POST', '/extension/calibration', { platform: 'privacy', url_path: new URL(url).pathname.slice(0, 300), outline }); } catch { sent = false; }
  return { ok: true, size: outline.length, file, sent };
});

ipcMain.handle('shift:start', async (_e, creatorId) => { await api('POST', '/extension/shifts', { creator_id: creatorId }); return refreshState().then(publicState); });
ipcMain.handle('shift:action', async (_e, { shiftId, action }) => { await api('POST', `/extension/shifts/${shiftId}/action`, { action }); return refreshState().then(publicState); });

ipcMain.handle('local:setCreator', async (_e, { id, patch }) => {
  local.creators[id] = { ...(local.creators[id] || {}), ...patch }; saveLocal(); pushState();
  const meta = {};
  if ('group' in patch) meta.group = groupName(patch.group);
  if ('tag' in patch) meta.tag = patch.tag || '';
  if ('notes' in patch) meta.notes = patch.notes || '';
  if (Object.keys(meta).length && token) {
    try { await api('PATCH', `/extension/creators/${id}/meta`, meta); }
    catch (error) { if (sidebar) sidebar.webContents.send('toast', /404|Not Found/i.test(error.message) ? 'Salvo só neste computador (painel ainda sem sincronização).' : `Salvo aqui, mas o painel recusou: ${error.message}`); }
  }
  return local;
});
ipcMain.handle('local:setGroups', async (_e, groups) => {
  const renamed = groups.filter((g) => { const old = local.groups.find((x) => x.id === g.id); return old && old.name !== g.name; });
  local.groups = groups; saveLocal(); pushState();
  for (const g of renamed) for (const [id, l] of Object.entries(local.creators)) if (l.group === g.id && token) { try { await api('PATCH', `/extension/creators/${id}/meta`, { group: g.name }); } catch {} }
  return local;
});
ipcMain.handle('local:setTags', (_e, tags) => { local.tags = tags; saveLocal(); pushState(); return local; });

ipcMain.handle('config:setOrigin', (_e, origin) => {
  config.origin = String(origin || DEFAULT_ORIGIN).replace(/\/+$/, '');
  writeJson('config.json', config); pushState(); return config;
});
ipcMain.handle('external:open', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, dataDir: dataDir() }));

// ---------- ciclo de vida ----------
app.whenReady().then(async () => {
  win = new BaseWindow({ width: 1440, height: 900, minWidth: 1000, minHeight: 600, title: 'Alta Pulse', backgroundColor: '#111113', icon: path.join(__dirname, 'ui', 'brand', 'favicon.ico') });
  win.setMenuBarVisibility(false);
  sidebar = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.contentView.addChildView(sidebar);
  sidebar.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('resize', layout);
  layout();

  token = readToken();
  await refreshState();
  setupAutoUpdate();
  setInterval(refreshState, STATE_REFRESH_MS);
  setInterval(heartbeats, HEARTBEAT_MS);
  setInterval(readAll, READ_MS);
});

app.on('window-all-closed', () => app.quit());

// ---------- atualização automática (instalador) ----------
// O app instalado pelo AltaPulse-Setup.exe busca versões novas nas releases do GitHub do projeto
// (electron-updater). Baixa em silêncio e instala ao fechar o app; a lateral avisa quando está pronta.
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => { if (sidebar && !sidebar.webContents.isDestroyed()) sidebar.webContents.send('toast', `Atualização ${info.version} pronta: será instalada quando você fechar o Alta Pulse.`); });
  autoUpdater.on('error', () => {});
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 20000); setInterval(check, 6 * 60 * 60 * 1000);
}
