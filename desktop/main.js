// Alta Pulse desktop — fase 1 (paridade com o Lauth)
//
// Uma janela: lateral de criadoras à esquerda e, à direita, um perfil isolado por criadora
// (cookies, login e cache separados). Fala com o painel altapulse.com.br pela mesma API da
// extensão Chrome (/api/extension/*). Nenhuma senha ou cookie da Privacy sai deste computador.
'use strict';
const { app, BaseWindow, WebContentsView, ipcMain, session, safeStorage, shell, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const CALIBRATION_SCRIPT = require('./calibration.js');
const READER_SCRIPT = require('./reader-page.js');
const { CreatorReader, parseDateLabel, at: msgAt } = require('./reader.js');
const SAMPLE_SCRIPT = require('./sample-page.js');
const EXTRATO = require('./extrato-page.js');
const SNAPSHOT = require('./snapshot-page.js');
const SUBS = require('./subscribers-page.js');
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
const SUBS_MS = 6 * 60 * 60 * 1000;     // bloco D: lista de assinantes a cada 6 h
const SAMPLE_MS = 30 * 60 * 1000;       // bloco E: no máximo uma amostra por conversa a cada 30 min
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
  return activeId && tabs.has(activeId) && tabs.get(activeId).size ? { x: SIDEBAR_WIDTH, y: 0, width, height: h } : { x: SIDEBAR_WIDTH, y: h - PEEK, width, height: 900 };
}

const dataDir = () => app.getPath('userData');
// calibrações: junto do código quando rodando da pasta (fácil de achar); no perfil do usuário quando instalado (asar é só leitura)
const calibDir = () => (app.isPackaged ? path.join(dataDir(), 'calibracoes') : path.join(__dirname, 'calibracoes'));
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
// chave compartilhada (servidor) para as referências de fã/venda; sem ela, cai na chave local deste computador
let hashKey = null;
const secretFor = () => hashKey || localSecret();
async function syncHashKey() {
  try {
    let { key } = await api('GET', '/extension/hash-key');
    if (!key && state.user && state.user.role === 'manager') ({ key } = await api('POST', '/extension/hash-key', { key: localSecret() }));
    if (key && key !== hashKey) {
      hashKey = key;
      for (const r of readers.values()) r.reader.secret = key;
      for (const x of extratos.values()) x.reader.secret = key;
    }
  } catch { /* painel antigo: segue com a chave local */ }
}
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
const probeInfo = new Map(); // diagnóstico da sonda de login

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
    state = { user: data.user, creators: data.creators, sla_minutes: data.sla_minutes, version: data.version, storage_allowed: !!data.storage_allowed, fan_names_allowed: !!data.fan_names_allowed, quality_ai_allowed: !!data.quality_ai_allowed };
    try { credentials = await api('GET', '/extension/credentials'); } catch { /* painel antigo sem cofre */ }
    if (!hashKey) await syncHashKey();
    await loadTasks();
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
const views = new Map(); // creatorId -> aba da PRIVACY (leitor, extrato e presença usam esta)
const tabs = new Map(); // creatorId -> Map(plataforma -> WebContentsView): uma aba por plataforma, mesmo perfil
const activeTab = new Map(); // creatorId -> plataforma em primeiro plano
let activeId = null;
const tabsOf = (id) => { if (!tabs.has(id)) tabs.set(id, new Map()); return tabs.get(id); };
const currentView = (id) => { const t = tabs.get(id); return t ? t.get(activeTab.get(id)) || [...t.values()][0] : null; };

function pushState() { if (sidebar && !sidebar.webContents.isDestroyed()) sidebar.webContents.send('state', publicState()); }
function publicState() {
  return {
    ...state,
    origin: config.origin,
    local,
    open: [...tabs.keys()].filter((id) => tabs.get(id).size),
    active: activeId,
    tabs: Object.fromEntries([...tabs].map(([id, t]) => [id, [...t.keys()]])),
    activeTab: Object.fromEntries(activeTab),
    urls: Object.fromEntries([...views].map(([id, v]) => [id, v.webContents.getURL()])),
    readers: Object.fromEntries([...readers].map(([id, r]) => [id, r.summary || null])),
    extratos: Object.fromEntries([...extratos].map(([id, x]) => [id, x.summary || null])),
    platforms: PLATFORMS,
    credentials: credentials.map((c) => ({ id: c.id, creator_id: c.creator_id, platform: c.platform, login: c.login, has_password: c.has_password })),
    loginPages: Object.fromEntries(loginPages),
    tasks: myTasks,
    probeInfo: Object.fromEntries(probeInfo),
  };
}

// ---------- painel do fã (à direita da aba da Privacy) ----------
const FAN_W = 290, FAN_MIN = 30;
let fanView = null;
let fanUi = readJson('painel-fa.json', { mode: 'auto', collapsed: false }); // auto: aberto em tela larga; em notebook abre só para fã importante
if (!fanUi.mode) fanUi.mode = 'auto';
// zoom da Privacy: com a lateral e o cartão, a aba fica estreita e a Privacy troca para o layout de celular
// (lista OU conversa). Reduzir o zoom faz a página "ver" uma largura de desktop e manter lista + conversa.
const PRIVACY_CSS_WIDTH = 1460, ZOOM_MIN = 0.7;
let zoomPref = readJson('zoom.json', { manual: null }); // manual: fator escolhido com Ctrl +/−
const WIDE_SCREEN = 1700;
function fanImportant() { const c = fan.card; return !!(c && (c.tier === 'baleia' || c.task || (c.tags || []).some((t) => ['esfriando', 'novo_sem_compra', 'assinatura_inativa'].includes(t)) || (c.pending_offers || []).length)); }
function fanCollapsed() {
  if (fanUi.mode === 'manual') return !!fanUi.collapsed;
  const [w] = win ? win.getContentSize() : [1920];
  return w < WIDE_SCREEN && !fanImportant();
}
function privacyZoom(viewWidth) {
  if (zoomPref.manual) return zoomPref.manual;
  return Math.max(ZOOM_MIN, Math.min(1, Math.floor((viewWidth / PRIVACY_CSS_WIDTH) * 20) / 20));
}
function applyZoom(view, width) { try { const z = privacyZoom(width); if (Math.abs(view.webContents.getZoomFactor() - z) > 0.01) view.webContents.setZoomFactor(z); } catch {} }
let fan = { creatorId: null, fanRef: null, name: null, cid: null, card: null, loading: false, error: null, fetchedAt: 0 };
let myTasks = [];
let fanCids = readJson('fa-conversas.json', {}); // creatorId -> { fanRef: cid } (só neste computador, para abrir a conversa pela lista)
function fanPanelWidth() {
  if (!state.user || !activeId || activeTab.get(activeId) !== 'privacy' || !tabs.has(activeId)) return 0;
  return fanCollapsed() ? FAN_MIN : FAN_W;
}
function pushFan() {
  if (!fanView || fanView.webContents.isDestroyed()) return;
  const creator = (state.creators || []).find((c) => c.id === fan.creatorId);
  fanView.webContents.send('fan', { ...fan, creatorName: creator ? creator.name : '', collapsed: fanCollapsed(), important: fanImportant(), active: fan.creatorId === activeId, sla: state.sla_minutes || 5, user: state.user ? { id: state.user.id, role: state.user.role } : null });
}
async function loadFanCard(force = false) {
  if (!fan.creatorId || !fan.fanRef) return;
  if (!force && fan.card && Date.now() - fan.fetchedAt < 60000) return;
  const want = `${fan.creatorId}|${fan.fanRef}`; fan.loading = true; pushFan();
  try {
    const card = await api('GET', `/extension/fan?creator_id=${encodeURIComponent(fan.creatorId)}&fan_ref=${fan.fanRef}`);
    if (`${fan.creatorId}|${fan.fanRef}` === want) { const before = fanCollapsed(); fan.card = card; fan.error = null; fan.fetchedAt = Date.now(); if (fanCollapsed() !== before) layout(); }
  } catch (error) { fan.error = /404|Not Found/i.test(error.message) ? 'O painel ainda não tem o cartão do fã (publicação pendente).' : error.message; }
  fan.loading = false; pushFan();
}
function setFanFromChat(id, open) {
  if (!open || !open.name) {
    if (fan.creatorId !== id || fan.fanRef) { const before = fanCollapsed(); fan = { creatorId: id, fanRef: null, name: null, cid: null, card: null, loading: false, error: null, fetchedAt: 0 }; if (fanCollapsed() !== before) layout(); pushFan(); }
    return;
  }
  const ref = readerFor(id).reader.roomKey(open.name);
  if (open.cid && !String(open.cid).startsWith('n:')) { fanCids[id] = fanCids[id] || {}; if (fanCids[id][ref] !== open.cid) { fanCids[id][ref] = open.cid; writeJson('fa-conversas.json', fanCids); } }
  // fã que mandou mensagem hoje/ontem está com acesso ao chat: não mostrar "assinatura inativa" da lista antiga
  const chatting = (open.msgs || []).some((m) => !m.ours && /^(hoje|ontem)$/i.test(String(m.date || '').trim()));
  // subAtiva: true/false vindo do aviso da Privacy ("não poderá responder, pois não é seu assinante"); null enquanto carrega
  const subAtiva = open.skeleton || !(open.msgs || []).length ? null : !open.notSub;
  // esperando resposta: da primeira mensagem do fã depois da nossa última até agora
  let waitSince = null;
  { const ms = open.msgs || []; let i = ms.length - 1; while (i >= 0 && !ms[i].ours) i -= 1;
    const first = ms[i + 1]; if (first && !first.ours && first.date) { const t = msgAt(first.date, first.time, new Date()); if (t) waitSince = t.toISOString(); } }
  if (fan.creatorId !== id || fan.fanRef !== ref) { fan = { creatorId: id, fanRef: ref, name: open.name, cid: open.cid, chatting, subAtiva, waitSince, card: null, loading: false, error: null, fetchedAt: 0 }; loadFanCard(true); }
  else {
    let ch = false;
    if (fan.chatting !== chatting) { fan.chatting = chatting; ch = true; }
    if (subAtiva != null && fan.subAtiva !== subAtiva) { fan.subAtiva = subAtiva; ch = true; }
    if (!open.skeleton && fan.waitSince !== waitSince) { const was = fan.waitSince; fan.waitSince = waitSince; ch = true; if (was && !waitSince) fan.fetchedAt = 0; }
    if (ch) pushFan(); loadFanCard();
  }
}
// troca de conversa: atualiza o cartão em ~1 s, sem esperar a próxima leitura geral (10 s)
async function quickFan(id) {
  const view = views.get(id); if (!view || id !== activeId || view.webContents.isDestroyed()) return;
  try { const data = await view.webContents.executeJavaScript(READER_SCRIPT, true); setFanFromChat(id, data && data.page === 'chat' ? data.open : null); } catch {}
}
async function loadTasks() {
  try { myTasks = await api('GET', '/extension/fan-tasks'); } catch { myTasks = []; }
}

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const pw = fanPanelWidth();
  sidebar.setBounds({ x: 0, y: 0, width: SIDEBAR_WIDTH, height: h });
  for (const [id, t] of tabs) for (const [platform, v] of t) {
    const vw = Math.max(w - SIDEBAR_WIDTH - PEEK - pw, 200);
    v.setBounds({ x: SIDEBAR_WIDTH, y: 0, width: vw, height: h });
    v.setVisible(id === activeId && platform === activeTab.get(id));
    if (platform === 'privacy') applyZoom(v, vw);
  }
  // a faixa de 2 px da aba oculta do extrato fica ENTRE a Privacy e o painel do fã (não coberta)
  if (fanView) { fanView.setBounds({ x: w - pw, y: 0, width: pw, height: h }); fanView.setVisible(pw > 0); }
  for (const x of extratos.values()) if (x.view && !x.shown && !x.view.webContents.isDestroyed()) x.view.setBounds(hiddenBounds());
}

function partitionFor(creatorId) { return `persist:creator-${creatorId}`; }

// ---------- abas abertas sobrevivem ao reinício ----------
function saveOpenTabs() {
  writeJson('abas-abertas.json', { tabs: Object.fromEntries([...tabs].map(([id, t]) => [id, [...t.keys()]])), activeTab: Object.fromEntries(activeTab), active: activeId });
}
let restored = false;
function restoreOpenTabs() {
  if (restored || !state.user) return; restored = true;
  const saved = readJson('abas-abertas.json', null); if (!saved || !saved.tabs) return;
  const known = new Set((state.creators || []).map((c) => c.id));
  for (const [id, platforms] of Object.entries(saved.tabs)) {
    if (!known.has(id)) continue;
    for (const platform of platforms) openProfile(id, platform, { quiet: true });
    if (saved.activeTab && saved.activeTab[id]) activeTab.set(id, saved.activeTab[id]);
  }
  activeId = saved.active && tabs.has(saved.active) ? saved.active : null;
  layout(); pushState();
}

function openProfile(creatorId, platform = 'privacy', opts = {}) {
  if (!PLATFORMS[platform]) platform = 'privacy';
  const t = tabsOf(creatorId);
  if (t.has(platform)) { activeId = creatorId; activeTab.set(creatorId, platform); layout(); pushState(); return; }
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
  if (platform === 'privacy') {
    view.webContents.on('did-finish-load', () => layout());
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
      const k = input.key; let z = view.webContents.getZoomFactor();
      if (k === '=' || k === '+') z = Math.min(1.5, z + 0.05); else if (k === '-') z = Math.max(0.5, z - 0.05); else if (k === '0') { zoomPref = { manual: null }; writeJson('zoom.json', zoomPref); layout(); event.preventDefault(); return; } else return;
      event.preventDefault(); zoomPref = { manual: Math.round(z * 100) / 100 }; writeJson('zoom.json', zoomPref);
      for (const pv of views.values()) pv.webContents.setZoomFactor(zoomPref.manual);
      if (sidebar) sidebar.webContents.send('toast', `Zoom da Privacy: ${Math.round(zoomPref.manual * 100)}% (Ctrl+0 volta ao automático)`);
    });
  }
  view.webContents.on('did-navigate-in-page', () => { pushState(); if (platform === 'privacy') setTimeout(() => quickFan(creatorId), 1200); });
  view.webContents.on('did-fail-load', (_e, code, description, url, isMain) => {
    if (isMain && sidebar) sidebar.webContents.send('toast', `Falha ao abrir ${PLATFORMS[platform].label} (${code} ${description}).`);
  });
  win.contentView.addChildView(view);
  t.set(platform, view);
  if (platform === 'privacy') views.set(creatorId, view);
  activeId = creatorId; activeTab.set(creatorId, platform);
  layout();
  view.webContents.loadURL(PLATFORMS[platform].home, { userAgent: UA });
  watchBlank(view);
  if (!opts.quiet) { pushState(); saveOpenTabs(); }
  if (platform === 'privacy') scheduleExtrato(creatorId, EXTRATO_FIRST_MS);
}

// Página que fica em branco no primeiro carregamento (acontece em instalação nova): recarrega sozinho até 3 vezes.
function watchBlank(view, tries = 0) {
  setTimeout(async () => {
    if (!view || view.webContents.isDestroyed() || tries >= 3) return;
    if (view.webContents.isLoading() && tries < 2) return watchBlank(view, tries + 1);
    const n = await runJs(view, `(document.body ? document.body.innerText.trim().length + document.body.querySelectorAll('*').length : 0)`, 4000).catch(() => 0);
    if (!n || n < 5) { view.webContents.reload(); watchBlank(view, tries + 1); }
  }, 12000);
}

function closeTab(creatorId, platform) {
  const t = tabs.get(creatorId); const view = t && t.get(platform);
  if (!view) return;
  win.contentView.removeChildView(view);
  view.webContents.close();
  t.delete(platform);
  if (platform === 'privacy') { views.delete(creatorId); closeStatsView(creatorId); readers.delete(creatorId); }
  if (activeTab.get(creatorId) === platform) activeTab.set(creatorId, [...t.keys()][0] || null);
  if (!t.size) { tabs.delete(creatorId); activeTab.delete(creatorId); if (activeId === creatorId) activeId = [...tabs.keys()].at(-1) || null; }
  layout();
  pushState(); saveOpenTabs();
}
function closeProfile(creatorId) {
  for (const platform of [...(tabs.get(creatorId) || new Map()).keys()]) closeTab(creatorId, platform);
}

async function clearProfileData(creatorId, what) {
  const ses = session.fromPartition(partitionFor(creatorId));
  if (what === 'cache' || what === 'tudo') await ses.clearCache();
  if (what === 'cookies' || what === 'tudo') await ses.clearStorageData();
  for (const [platform, view] of (tabs.get(creatorId) || new Map())) view.webContents.loadURL(PLATFORMS[platform].home, { userAgent: UA });
}

// ---------- leitor (fase 2) ----------
const readers = new Map(); // creatorId -> { reader, summary, lastError }
function readerFor(id) {
  if (!readers.has(id)) {
    const store = readJson(`reader-${id}.json`, null);
    readers.set(id, { reader: new CreatorReader(id, secretFor(), store, { fanNames: !!state.fan_names_allowed }), summary: null, lastError: null });
    // uma vez: ofertas marcadas como enviadas antes da correção podem ter sido descartadas; reenvia (o painel deduplica)
    const s = readers.get(id).reader.s;
    if (s && s.sent && !s.offersV2) { for (const k of Object.keys(s.sent)) if (s.sent[k] === 'offer:sent') delete s.sent[k]; s.offersV2 = true; }
  }
  return readers.get(id);
}
// executeJavaScript numa aba em segundo plano pode nunca responder; sem limite, a leitura inteira travava
function runJs(view, code, ms = 5000) {
  return Promise.race([view.webContents.executeJavaScript(code, true), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}
let reading = false, readStartedAt = 0;
async function readAll() {
  if (!state.user) return;
  if (reading && Date.now() - readStartedAt < 60000) return;
  reading = true; readStartedAt = Date.now();
  try { await readAllNow(); }
  catch (error) { try { fs.appendFileSync(path.join(app.isPackaged ? dataDir() : __dirname, 'erros-leitura.log'), `${new Date().toISOString()} readAll erro ${error && error.stack}\n`); } catch {} }
  finally { reading = false; }
}
async function readAllNow() {
  // tela de login em alguma aba? (para oferecer "Entrar com o acesso salvo")
  for (const [id, t] of tabs) {
    const found = [];
    for (const [platform, view] of t) {
      try { if (!view.webContents.isDestroyed() && await runJs(view, LOGIN_PROBE, 3000)) found.push(platform); } catch {}
    }
    if (found.length) loginPages.set(id, found); else loginPages.delete(id);
  }
  for (const [id, view] of views) {
    const r = readerFor(id); r.reader.options.fanNames = !!state.fan_names_allowed;
    let data;
    try { if (view.webContents.isDestroyed()) continue; data = await runJs(view, READER_SCRIPT, 8000); } catch { continue; }
    if (id === activeId) setFanFromChat(id, data && data.page === 'chat' ? data.open : null);
    // fora da tela de chat: mantém o último balão conhecido (o chatter pode estar no feed por um instante)
    if (!data || data.page !== 'chat') { const prev = r.summary || {}; r.summary = { waiting: 0, waitingRecent: prev.waitingRecent || 0, oldestWaitMin: null, page: data ? data.page : 'other', readAt: new Date().toISOString() }; continue; }
    let events, summary;
    try { ({ events, summary } = r.reader.process(data, new Date())); }
    catch (error) { try { fs.appendFileSync(path.join(app.isPackaged ? dataDir() : __dirname, 'erros-leitura.log'), `${new Date().toISOString()} process erro ${id.slice(0, 6)} ${error && error.stack}\n`); } catch {} continue; }
    r.summary = summary;
    writeJson(`reader-${id}.json`, r.reader.s);
    const creator = state.creators.find((c) => c.id === id);
    const shift = creator && creator.shift;
    const mine = shift && shift.operator_id === state.user.id && !shift.paused;
    // com o extrato funcionando para esta criadora, a venda inferida pela lista de conversas não é
    // enviada (o extrato traz a mesma venda com hora, produto e situação exatos; evita contar em dobro)
    if (extratoHealthy(id)) events = events.filter((e) => e.kind !== 'sale');
    // bloco E: amostra anonimizada da conversa aberta, só no turno do próprio usuário e com a opção ligada
    if (mine && state.storage_allowed && state.quality_ai_allowed && data.open && data.open.cid) sampleConversation(id, view, r, data.open).catch(() => {});
    if (!events.length) continue;
    // evento não enviado (sem turno próprio ou falha) volta a ficar pendente: é reenviado na próxima leitura
    // (antes ficava marcado como enviado e a oferta/espera se perdia para sempre)
    const unmark = () => { for (const e of events) delete r.reader.s.sent[e.event_ref]; writeJson(`reader-${id}.json`, r.reader.s); };
    if (!mine || !state.storage_allowed) { r.summary.dropped = (r.summary.dropped || 0) + events.length; unmark(); continue; }
    try {
      const out = await api('POST', '/extension/observations', { events: events.slice(0, 200) });
      r.summary.accepted = out.accepted; r.lastError = null;
      const failed = new Set((out.results || []).filter((x) => !x.ok && x.status !== 422).map((x) => x.event_ref));
      if (failed.size) { for (const ref of failed) delete r.reader.s.sent[ref]; writeJson(`reader-${id}.json`, r.reader.s); }
      if (id === fan.creatorId && events.some((e) => e.kind === 'offer')) loadFanCard(true);
    } catch (error) { r.lastError = error.message; r.summary.error = error.message; unmark(); }
  }
  pushState();
}

// ---------- amostras de conversa (bloco E) ----------
const samples = new Map(); // creatorId|cid -> { at, count }
async function sampleConversation(id, view, r, open) {
  const key = `${id}|${open.cid}`; const last = samples.get(key);
  const count = (open.msgs || []).length;
  if (last && (Date.now() - last.at < SAMPLE_MS || last.count === count)) return;
  samples.set(key, { at: Date.now(), count });
  const data = await view.webContents.executeJavaScript(SAMPLE_SCRIPT, true);
  if (!data || !data.msgs || data.msgs.length < 3) return;
  const now = new Date();
  const when = (m) => { if (!m.date || !m.time) return null; const d = parseDateLabel(m.date, now); if (!d) return null; const [h, mi] = m.time.split(':').map(Number); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi).toISOString(); };
  const fan = r.reader.fan(data.name); if (!fan.fan_ref) return;
  await api('POST', '/extension/samples', { creator_id: id, fan_ref: fan.fan_ref, captured_at: now.toISOString(), messages: data.msgs.map((m) => ({ ours: !!m.ours, at: when(m), text: m.text })) });
  r.summary.sampled = (r.summary.sampled || 0) + 1;
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
    extratos.set(id, { view: null, reader: new ExtratoReader(id, secretFor(), store, { fanNames: !!state.fan_names_allowed }), summary: null, timer: null, busy: false });
  }
  return extratos.get(id);
}
function statsView(id) {
  const x = extratoFor(id);
  if (x.view && !x.view.webContents.isDestroyed()) return x.view;
  const view = new WebContentsView({ webPreferences: { partition: partitionFor(id), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  view.webContents.setUserAgent(UA);
  view.webContents.setAudioMuted(true);
  view.webContents.setBackgroundThrottling(false); // sem isso a aba oculta pode não renderizar a SPA
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
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      const wc = view.webContents; // a aba pode já ter sido fechada quando o timeout dispara
      if (wc && !wc.isDestroyed()) { wc.removeListener('did-finish-load', done); wc.removeListener('did-fail-load', done); }
      resolve();
    };
    view.webContents.once('did-finish-load', done); view.webContents.once('did-fail-load', done);
    view.webContents.loadURL(STATS_URL, { userAgent: UA });
    timer = setTimeout(done, 25000);
  });
  await sleep(4000); // SPA termina de montar
}
// Leituras em fila, uma por vez: duas abas ocultas com os mesmos limites se cobrem, e a de baixo vira
// "hidden" para o Chromium. A aba em leitura é trazida ao topo da camada oculta (ainda sob as criadoras).
let extratoChain = Promise.resolve();
function readExtrato(id, opts = {}) {
  const p = extratoChain.then(() => readExtratoNow(id, opts)).catch(() => {});
  extratoChain = p; return p;
}
function raiseStatsView(view) {
  const n = [...extratos.values()].filter((x) => x.view && !x.view.webContents.isDestroyed()).length;
  win.contentView.removeChildView(view); win.contentView.addChildView(view, Math.max(0, n - 1));
  view.setBounds(hiddenBounds());
}
async function hasPrivacySession(id) {
  try { const cookies = await session.fromPartition(partitionFor(id)).cookies.get({ url: 'https://privacy.com.br' }); return cookies.length > 0; } catch { return false; }
}
async function readExtratoNow(id, opts = {}) {
  const x = extratoFor(id);
  if (!state.user || x.busy) return;
  if (!views.has(id) && !opts.background) return;
  x.busy = true;
  try {
    x.reader.options.fanNames = !!state.fan_names_allowed;
    const view = statsView(id); raiseStatsView(view);
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
    // histórico do período (o extrato mostra 30 dias): clica "ver mais" enquanto a lista crescer.
    // v2: refaz para quem ficou só com a 1ª página (antes era marcado como feito mesmo sem linhas)
    if ((x.reader.s.backfillV || 0) < 2 && (data.rows || []).length) {
      let prev = data.rows.length, pages = 0;
      for (let i = 0; i < 80 && data.hasMore; i++) {
        await run('more'); let grew = false;
        for (let w = 0; w < 8; w++) { await sleep(1500); data = await run('read'); if ((data.rows || []).length > prev) { grew = true; break; } }
        if (!grew) break; prev = data.rows.length; pages += 1;
      }
      x.reader.s.backfillV = 2; x.reader.s.backfilled = true; x.backfillPages = pages;
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
    // bloco D: lista de assinantes (situação e preço da assinatura) a cada 6 h, na mesma aba oculta
    if (state.storage_allowed && (!x.reader.s.subsAt || x.reader.s.subsV !== 2 || Date.now() - x.reader.s.subsAt > SUBS_MS)) {
      try {
        const runS = (a) => view.webContents.executeJavaScript(SUBS.script(a), true);
        let t = await runS('tab');
        for (let i = 0; i < 8 && t.hadTab && !t.tabActive; i++) { await sleep(2000); t = await runS('tab'); }
        if (t.tabActive) {
          await sleep(3000);
          let d = await runS('read');
          for (let i = 0; i < 5 && !d.rows.length; i++) { await sleep(2000); d = await runS('read'); }
          for (let i = 0; i < 25 && d.hasMore; i++) { await runS('more'); await sleep(1500); d = await runS('read'); }
          // a lista tem uma linha por ASSINATURA (a antiga inativa e a atual ativa aparecem separadas):
          // agrupa por fã e fica com a ativa; só é "inativa" se nenhuma linha dele estiver ativa
          const isActive = (st) => /ativ|vigent|em dia/i.test(st) && !/inativ|expir|cancel|venc|encerr/i.test(st);
          const byFan = new Map();
          for (const r of d.rows) {
            const f = x.reader.fan(r.name); if (!f.fan_ref) continue;
            const row = { ...f, status: r.status.slice(0, 40), price_cents: r.price_cents, duration: r.duration.slice(0, 40) };
            const cur = byFan.get(f.fan_ref);
            if (!cur || (isActive(row.status) && !isActive(cur.status))) byFan.set(f.fan_ref, row);
          }
          const rows = [...byFan.values()];
          if (rows.length) {
            const out = await api('POST', '/extension/subscribers', { creator_id: id, taken_at: new Date().toISOString(), total_label: (d.count || '').slice(0, 40), revenue_cents: d.revenue_cents, rows: rows.slice(0, 3000) });
            x.reader.s.subsAt = Date.now(); x.reader.s.subsV = 2; x.summary.subscribers = out.saved;
          } else x.summary.subsError = 'lista de assinantes vazia';
        } else x.summary.subsError = 'sem aba Assinantes';
      } catch (error) { x.summary.subsError = error.message.slice(0, 120); x.reader.s.subsAt = Date.now() - SUBS_MS + 30 * 60 * 1000; } // falhou: tenta de novo em 30 min
    }
    writeJson(`extrato-${id}.json`, x.reader.s);
  } catch (error) {
    const old = /Extra inputs are not permitted/.test(error.message);
    x.summary = { ...(x.summary || {}), error: old ? 'painel desatualizado: publique a versão nova do Alta Pulse' : error.message, readAt: new Date().toISOString() };
  } finally {
    x.busy = false; pushState();
    if (views.has(id)) scheduleExtrato(id, EXTRATO_MS);
    else if (!x.shown) closeStatsView(id); // leitura de fundo: libera a memória até a próxima rodada
  }
}
// Vigia (gestor): a cada 10 min lê o extrato de TODAS as criadoras com sessão da Privacy salva neste
// computador, mesmo sem aba aberta. Assim nenhuma venda fica sem registro quando ninguém está atendendo.
let vigiaTimer = null;
async function vigia() {
  if (!state.user || state.user.role !== 'manager') return;
  for (const c of state.creators || []) {
    if (views.has(c.id)) continue; // aberta: já tem a própria rotina
    if (!(await hasPrivacySession(c.id))) continue;
    await readExtrato(c.id, { background: true });
  }
}
function startVigia() { stopVigia(); if (state.user && state.user.role === 'manager') { vigiaTimer = setInterval(() => vigia().catch(() => {}), EXTRATO_MS); setTimeout(() => vigia().catch(() => {}), EXTRATO_FIRST_MS * 2); } }
function stopVigia() { clearInterval(vigiaTimer); vigiaTimer = null; }
ipcMain.handle('fan:collapse', (_e, collapsed) => { if (collapsed === 'auto') fanUi = { mode: 'auto', collapsed: false }; else fanUi = { mode: 'manual', collapsed: !!collapsed }; writeJson('painel-fa.json', fanUi); layout(); pushFan(); return true; });
ipcMain.handle('fan:refresh', async () => { await loadFanCard(true); return true; });

// ---------- Alta Ajuda (sugestões da Grok, só quando o chatter pede) ----------
// Só o texto que o chatter escreve vai ao painel, que chama a API da xAI. Nada da conversa com o fã.
const assistCache = new Map(); // creatorId -> { at, data }
ipcMain.handle('assist:status', async (_e, force) => {
  const id = fan.creatorId; if (!id) return null;
  const c = assistCache.get(id);
  if (!force && c && Date.now() - c.at < 60000) return c.data;
  try { const data = await api('GET', `/extension/assist/status?creator_id=${encodeURIComponent(id)}`); assistCache.set(id, { at: Date.now(), data }); return data; }
  catch (error) { return { enabled: false, error: /404|Not Found/i.test(error.message) ? 'O painel ainda não tem a Alta Ajuda (publicação pendente).' : error.message }; }
});
ipcMain.handle('assist:run', async (_e, { level, draft }) => {
  // só o rascunho escrito pelo chatter; a conversa com o fã não é lida nem enviada
  const id = fan.creatorId; if (!id) throw new Error('Abra a conversa de uma criadora primeiro.');
  const out = await api('POST', '/extension/assist', { creator_id: id, fan_ref: fan.fanRef || null, level, draft: String(draft || '').slice(0, 1000) });
  const c = assistCache.get(id); if (c && out && out.remaining != null) c.data = { ...c.data, remaining: out.remaining };
  return out;
});
// "Usar": coloca o texto na caixa de mensagem da Privacy (o chatter confere e envia) e copia para a área de transferência
const FILL_SCRIPT = (text) => `(() => {
  const roots = []; (function walk(r, d) { if (d > 6) return; roots.push(r); for (const el of r.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, d + 1); })(document, 0);
  let ta = null; for (const r of roots) { ta = r.querySelector('textarea.ce-textarea, .vac-room-footer textarea'); if (ta) break; }
  if (!ta) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true, composed: true })); ta.focus();
  return true;
})()`;
ipcMain.handle('assist:use', async (_e, text) => {
  const t = String(text || '').slice(0, 2000); clipboard.writeText(t);
  const view = fan.creatorId && views.get(fan.creatorId);
  let filled = false;
  if (view && !view.webContents.isDestroyed()) { try { filled = !!(await runJs(view, FILL_SCRIPT(t), 4000)); if (filled) view.webContents.focus(); } catch {} }
  return { filled };
});
ipcMain.handle('fan:note:add', async (_e, text) => {
  if (!fan.creatorId || !fan.fanRef) throw new Error('Abra uma conversa primeiro.');
  await api('POST', '/extension/fan/notes', { creator_id: fan.creatorId, fan_ref: fan.fanRef, text: String(text || '').slice(0, 300) });
  await loadFanCard(true); return true;
});
ipcMain.handle('fan:note:del', async (_e, noteId) => { await api('DELETE', `/extension/fan/notes/${encodeURIComponent(noteId)}`); await loadFanCard(true); return true; });
ipcMain.handle('fan:contacted', async (_e, taskId) => { await api('POST', `/extension/fan-tasks/${encodeURIComponent(taskId)}/contacted`, {}); await loadTasks(); await loadFanCard(true); pushState(); return true; });
ipcMain.handle('task:open', async (_e, taskId) => {
  const t = myTasks.find((x) => x.id === taskId); if (!t) throw new Error('Tarefa não encontrada.');
  openProfile(t.creator_id, 'privacy');
  const view = views.get(t.creator_id); const cid = fanCids[t.creator_id] && fanCids[t.creator_id][t.fan_ref];
  if (view) view.webContents.loadURL(cid ? `https://privacy.com.br/chat?cid=${encodeURIComponent(cid)}` : 'https://privacy.com.br/chat', { userAgent: UA });
  return { found: !!cid, name: t.fan_name };
});
ipcMain.handle('extrato:read', async (_e, id) => { await readExtrato(id, { background: true }); return publicState(); });
// diagnóstico (gestor): esqueleto mascarado de uma aba do Meu Privacy (ex.: Assinantes) na aba oculta
ipcMain.handle('extrato:calibrate', async (_e, id, tour) => {
  const x = extratoFor(id); const view = statsView(id); raiseStatsView(view);
  if (!/myprivacystats/i.test(view.webContents.getURL())) await loadStats(view);
  const tabScript = `(() => { const roots = []; (function walk(r, d) { if (d > 6) return; roots.push(r); for (const el of r.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, d + 1); })(document, 0);
    let b = null; for (const r of roots) { b = r.querySelector('.seg-btn[data-tour="tour-${tour}"]'); if (b) break; }
    if (!b) return { found: false, tabs: roots.flatMap((r) => [...r.querySelectorAll('.seg-btn')]).map((x) => x.getAttribute('data-tour')) };
    const active = b.classList.contains('active'); if (!active) b.click(); return { found: true, active }; })()`;
  let clicked = null; // como no extrato: a SPA só aceita o clique depois de montar; insiste até a aba ficar ativa
  for (let i = 0; i < 12; i++) { clicked = await view.webContents.executeJavaScript(tabScript, true); if (clicked && clicked.active) break; await sleep(2500); }
  await sleep(4000);
  const outline = await view.webContents.executeJavaScript(CALIBRATION_SCRIPT, true);
  const dir = calibDir(); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `stats-${tour}-${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
  fs.writeFileSync(file, `<!-- ${view.webContents.getURL()} clicked=${JSON.stringify(clicked)} -->\n${outline}`);
  if (!views.has(id) && !x.shown) closeStatsView(id);
  return { ok: true, file, clicked, size: outline.length };
});
// diagnóstico: mostra/esconde a aba oculta do extrato no lugar da aba da criadora
ipcMain.handle('extrato:toggle', (_e, id) => {
  const x = extratos.get(id); if (!x || !x.view || x.view.webContents.isDestroyed()) return false;
  const [w, h] = win.getContentSize(); const show = !x.shown;
  x.view.setBounds(show ? { x: SIDEBAR_WIDTH, y: 0, width: Math.max(w - SIDEBAR_WIDTH, 200), height: h } : hiddenBounds());
  if (show) { for (const t of tabs.values()) for (const v of t.values()) v.setVisible(false); x.shown = true; } else { x.shown = false; layout(); }
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
  restoreOpenTabs(); startVigia();
  return publicState();
});
ipcMain.handle('auth:logout', async () => {
  try { if (token) await api('POST', '/extension/logout'); } catch {}
  token = null; writeToken(null);
  const keep = readJson('abas-abertas.json', null);
  for (const id of [...tabs.keys()]) closeProfile(id);
  if (keep) writeJson('abas-abertas.json', keep); // ao entrar de novo, volta como estava
  restored = false; stopVigia();
  state = { user: null, creators: [], sla_minutes: 5, version: null };
  pushState();
  return publicState();
});
ipcMain.handle('state:get', async () => { await refreshState(); return publicState(); });
ipcMain.handle('profile:reload-active', () => { const v = activeId && currentView(activeId); if (v && !v.webContents.isDestroyed()) { v.webContents.reload(); watchBlank(v); } return true; });
ipcMain.handle('me:avatar', async (_e, image) => {
  if (image) await api('PUT', '/extension/avatar', { image }); else await api('DELETE', '/extension/avatar');
  await refreshState(); return publicState();
});
ipcMain.handle('state:snapshot', () => publicState());

ipcMain.handle('profile:open', (_e, id, platform) => { openProfile(id, platform || 'privacy'); return publicState(); });
// cofre: pede login/senha ao painel (auditado) e preenche o formulário da plataforma aberta. A senha
// não passa pela lateral: vai do painel para o processo principal e daí para a página, e é descartada.
ipcMain.handle('vault:use', async (_e, creatorId, platformArg) => {
  const t = tabs.get(creatorId); const platform = platformArg || activeTab.get(creatorId);
  const view = t && t.get(platform); if (!view) throw new Error('Abra a criadora primeiro.');
  const cred = credentials.find((c) => c.creator_id === creatorId && c.platform === platform);
  if (!cred) throw new Error(`Não há acesso salvo de ${PLATFORMS[platform].label} para esta criadora. Peça ao gestor para cadastrar no painel.`);
  const data = await api('POST', `/extension/credentials/${cred.id}/use`, {});
  let result;
  try { result = await view.webContents.executeJavaScript(fillScript(data.login, data.password), true); } finally { data.password = null; }
  if (!result || !result.ok) throw new Error('Não encontrei o formulário de login nesta tela (' + ((result && result.reason) || 'sem resposta') + ').');
  loginPages.set(creatorId, (loginPages.get(creatorId) || []).filter((p) => p !== platform)); if (!loginPages.get(creatorId).length) loginPages.delete(creatorId); pushState();
  return { ok: true, clicked: result.clicked, user: result.user };
});
ipcMain.handle('profile:show', (_e, id, platform) => { if (tabs.has(id) && tabs.get(id).size) { activeId = id; if (platform && tabs.get(id).has(platform)) activeTab.set(id, platform); layout(); pushState(); saveOpenTabs(); pushFan(); quickFan(id); } return publicState(); });
ipcMain.handle('profile:closeTab', (_e, id, platform) => { closeTab(id, platform); return publicState(); });
ipcMain.handle('profile:close', (_e, id) => { closeProfile(id); return publicState(); });
ipcMain.handle('profile:reload', (_e, id) => { const v = currentView(id); if (v) v.webContents.reload(); return true; });
ipcMain.handle('profile:back', (_e, id) => { const v = currentView(id); if (v && v.webContents.canGoBack()) v.webContents.goBack(); return true; });
ipcMain.handle('profile:clear', async (_e, { id, what }) => { await clearProfileData(id, what); return true; });
ipcMain.handle('profile:hideAll', () => { activeId = null; layout(); pushState(); return publicState(); });

// Calibração (fase 2): envia ao painel só o esqueleto da tela aberta (tags, classes, horários),
// com nomes e textos mascarados, para escrever a leitura de tempo de resposta e vendas.
ipcMain.handle('profile:calibrate', async (_e, id) => {
  const view = views.get(id) || currentView(id);
  if (!view) throw new Error('Abra a criadora primeiro.');
  const url = view.webContents.getURL();
  if (!/privacy\.com\.br/i.test(url)) throw new Error('Abra uma conversa da Privacy antes de capturar.');
  const outline = await view.webContents.executeJavaScript(CALIBRATION_SCRIPT, true);
  if (!outline || outline.length < 200) throw new Error('A tela ainda não carregou. Espere aparecerem as mensagens e tente de novo.');
  // cópia local (mesmo conteúdo mascarado) para análise sem depender do banco do painel
  const dir = calibDir(); fs.mkdirSync(dir, { recursive: true }); // fora do pacote (asar é só leitura)
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
if (!app.requestSingleInstanceLock()) app.quit(); // dois cliques no Iniciar não abrem duas cópias
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(async () => {
  win = new BaseWindow({ width: 1440, height: 900, minWidth: 1000, minHeight: 600, title: 'Alta Pulse', backgroundColor: '#111113', icon: path.join(__dirname, 'ui', 'brand', 'favicon.ico') });
  win.setMenuBarVisibility(false);
  sidebar = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.contentView.addChildView(sidebar);
  sidebar.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
  fanView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.contentView.addChildView(fanView);
  fanView.webContents.loadFile(path.join(__dirname, 'ui', 'fan.html'));
  fanView.webContents.on('did-finish-load', pushFan);
  win.on('resize', layout);
  layout();

  token = readToken();
  await refreshState();
  restoreOpenTabs(); startVigia();
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
