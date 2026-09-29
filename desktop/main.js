// Alta Pulse desktop — fase 1 (paridade com o Lauth)
//
// Uma janela: lateral de criadoras à esquerda e, à direita, um perfil isolado por criadora
// (cookies, login e cache separados). Fala com o painel altapulse.com.br pela mesma API da
// extensão Chrome (/api/extension/*). Nenhuma senha ou cookie da Privacy sai deste computador.
'use strict';
const { app, BaseWindow, WebContentsView, ipcMain, session, safeStorage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

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
const STATE_REFRESH_MS = 20000;

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

// ---------- API do painel (chamada só pelo processo principal, nunca pela página da Privacy) ----------
let token = readToken();
let state = { user: null, creators: [], sla_minutes: 5, version: null };

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
    throw new Error((data && data.detail) || `Erro ${response.status} no painel.`);
  }
  return data;
}

async function refreshState() {
  if (!token) return state;
  try {
    const data = await api('GET', '/extension/state');
    state = { user: data.user, creators: data.creators, sla_minutes: data.sla_minutes, version: data.version };
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
  };
}

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  sidebar.setBounds({ x: 0, y: 0, width: SIDEBAR_WIDTH, height: h });
  for (const [id, v] of views) {
    v.setBounds({ x: SIDEBAR_WIDTH, y: 0, width: Math.max(w - SIDEBAR_WIDTH, 200), height: h });
    v.setVisible(id === activeId);
  }
}

function partitionFor(creatorId) { return `persist:creator-${creatorId}`; }

function openProfile(creatorId) {
  if (views.has(creatorId)) { activeId = creatorId; layout(); pushState(); return; }
  const ses = session.fromPartition(partitionFor(creatorId));
  ses.setUserAgent(UA);
  const view = new WebContentsView({
    webPreferences: { partition: partitionFor(creatorId), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  view.webContents.setUserAgent(UA);
  // pop-ups do próprio site (login social, por exemplo) abrem na mesma sessão isolada
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([a-z0-9-]+\.)*privacy\.com\.br\//i.test(url) || /^https:\/\/accounts\.google\.com\//i.test(url) || /^https:\/\/appleid\.apple\.com\//i.test(url)) {
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
  view.webContents.loadURL(PRIVACY_HOME, { userAgent: UA });
  pushState();
}

function closeProfile(creatorId) {
  const view = views.get(creatorId);
  if (!view) return;
  win.contentView.removeChildView(view);
  view.webContents.close();
  views.delete(creatorId);
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
      await api('POST', '/extension/heartbeat', { creator_id: id, page: /\/chat/i.test(url) ? 'chat' : 'other', observation_state: 'no_data' });
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

ipcMain.handle('profile:open', (_e, id) => { openProfile(id); return publicState(); });
ipcMain.handle('profile:show', (_e, id) => { if (views.has(id)) { activeId = id; layout(); pushState(); } return publicState(); });
ipcMain.handle('profile:close', (_e, id) => { closeProfile(id); return publicState(); });
ipcMain.handle('profile:reload', (_e, id) => { const v = views.get(id); if (v) v.webContents.reload(); return true; });
ipcMain.handle('profile:back', (_e, id) => { const v = views.get(id); if (v && v.webContents.canGoBack()) v.webContents.goBack(); return true; });
ipcMain.handle('profile:clear', async (_e, { id, what }) => { await clearProfileData(id, what); return true; });
ipcMain.handle('profile:hideAll', () => { activeId = null; layout(); pushState(); return publicState(); });

ipcMain.handle('shift:start', async (_e, creatorId) => { await api('POST', '/extension/shifts', { creator_id: creatorId }); return refreshState().then(publicState); });
ipcMain.handle('shift:action', async (_e, { shiftId, action }) => { await api('POST', `/extension/shifts/${shiftId}/action`, { action }); return refreshState().then(publicState); });

ipcMain.handle('local:setCreator', (_e, { id, patch }) => { local.creators[id] = { ...(local.creators[id] || {}), ...patch }; saveLocal(); pushState(); return local; });
ipcMain.handle('local:setGroups', (_e, groups) => { local.groups = groups; saveLocal(); pushState(); return local; });
ipcMain.handle('local:setTags', (_e, tags) => { local.tags = tags; saveLocal(); pushState(); return local; });

ipcMain.handle('config:setOrigin', (_e, origin) => {
  config.origin = String(origin || DEFAULT_ORIGIN).replace(/\/+$/, '');
  writeJson('config.json', config); pushState(); return config;
});
ipcMain.handle('external:open', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, dataDir: dataDir() }));

// ---------- ciclo de vida ----------
app.whenReady().then(async () => {
  win = new BaseWindow({ width: 1440, height: 900, minWidth: 1000, minHeight: 600, title: 'Alta Pulse', backgroundColor: '#1d1f22' });
  win.setMenuBarVisibility(false);
  sidebar = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.contentView.addChildView(sidebar);
  sidebar.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('resize', layout);
  layout();

  await refreshState();
  setInterval(refreshState, STATE_REFRESH_MS);
  setInterval(heartbeats, HEARTBEAT_MS);
});

app.on('window-all-closed', () => app.quit());
