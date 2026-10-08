// Alta Pulse desktop
//
// Uma janela: lateral de criadoras à esquerda e, à direita, um perfil isolado por criadora
// (cookies, login e cache separados). Fala com o painel altapulse.com.br pela mesma API da
// extensão Chrome (/api/extension/*). Nenhuma senha ou cookie da Privacy sai deste computador.
'use strict';
const { app, BaseWindow, WebContentsView, ipcMain, session, safeStorage, shell, dialog, clipboard, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const CALIBRATION_SCRIPT = require('./calibration.js');
const READER_SCRIPT = require('./reader-page.js');
const { CreatorReader, parseDateLabel, at: msgAt, listAt } = require('./reader.js');
const SAMPLE_SCRIPT = require('./sample-page.js');
const EXTRATO = require('./extrato-page.js');
const SNAPSHOT = require('./snapshot-page.js');
const SUBS = require('./subscribers-page.js');
const { ExtratoReader } = require('./extrato.js');
const FF = require('./fatalfans-page.js');
const { FatalFansReader, SalesReader } = require('./fatalfans.js');
const CF = require('./closefans-page.js');
const OF = require('./onlyfans-page.js');
const AVATAR_SCRIPT = require('./avatar-page.js').script;
const OF_CHAT_SCRIPT = require('./onlyfans-chat-page.js');
const FF_CHAT_SCRIPT = require('./fatalfans-chat-page.js');
const { PLATFORMS, platformOf, allowedUrl, fillScript, LOGIN_PROBE } = require('./platforms.js');
const plantaoApp = require('./plantao-app.js');
const crypto = require('crypto');

// ---------- identificação do navegador ----------
// O Electron é um Chromium. Por padrão ele acrescenta "AppName/x Electron/y" ao user-agent e o
// firewall da Privacy bloqueia isso com 403 (comprovado na fase 0). Aqui ele se apresenta como o
// Chromium que de fato é, sem fingir outro navegador nem outro sistema.
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
// idioma das páginas das plataformas sempre em português (num Windows em espanhol a Privacy abria em espanhol e o botão virava "Ingresar")
const LANG = 'pt-BR,pt;q=0.9,en;q=0.5';
try { app.commandLine.appendSwitch('lang', 'pt-BR'); } catch {}
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
const SUBS_MS = 6 * 60 * 60 * 1000;
const FF_URL = 'https://fatalfans.com/creator/dashboard'; // FatalFans → Minhas vendas
const CF_URL = 'https://close.fans/sales-report';       // CloseFans → Vendas
const OF_URL = 'https://onlyfans.com/my/statements/earnings'; // OnlyFans → Extratos → Renda (US$)     // bloco D: lista de assinantes a cada 6 h
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
const calibDir = () => (!app.isPackaged ? path.join(__dirname, 'calibracoes') : isPortable() ? path.join(path.dirname(process.execPath), 'calibracoes') : path.join(dataDir(), 'calibracoes'));
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
      for (const x of ffs.values()) x.reader.secret = key;
      for (const x of cfs.values()) x.reader.secret = key;
      for (const x of ofs.values()) x.reader.secret = key;
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
      const names = Array.isArray(c.groups) ? c.groups : (c.group ? [c.group] : []);
      const gids = names.map(groupIdFor);
      if (JSON.stringify(l.groups || []) !== JSON.stringify(gids) || l.tag !== (c.tag || '') || l.notes !== (c.notes || '')) { local.creators[c.id] = { ...l, groups: gids, group: gids[0] || '', tag: c.tag || '', notes: c.notes || '' }; changed = true; }
    }
    if (changed) saveLocal();
  } catch (error) {
    if (!token) state = { ...state, user: null, creators: [] };
    else state = { ...state, warning: error.message };
  }
  pushState();
  return state;
}

// ---------- relógio do turno (10h–19h e 19h–03h) ----------
// 5 min depois do fim previsto pelo painel (ends_at), pergunta por cima de tudo: "Vai continuar?".
// Sim → "Até que horas?" (o turno passa a terminar nesse horário). Não, ou 1 min sem resposta em qualquer
// das duas perguntas → encerra os turnos de TODAS as criadoras do chatter. App fechado: o painel encerra sozinho.
const ASK_AFTER_MS = 5 * 60e3, ANSWER_MS = 60e3;
let shiftPrompt = null, shiftView = null, shiftTimer = null, shiftBusy = false;
function myShifts() { return state.user ? (state.creators || []).filter((c) => c.shift && c.shift.active !== false && c.shift.operator_id === state.user.id) : []; }
function shiftEnds(list) { const t = list.map((c) => Date.parse(c.shift.ends_at || '')).filter(Number.isFinite); return t.length ? Math.min(...t) : null; }
function pushShiftPrompt() { if (shiftView && !shiftView.webContents.isDestroyed() && shiftPrompt) shiftView.webContents.send('shiftclock:prompt', { ...shiftPrompt, total: ANSWER_MS }); }
function toast(text) { if (sidebar && !sidebar.webContents.isDestroyed()) sidebar.webContents.send('toast', text); }
function checkShiftClock() {
  if (shiftPrompt && !shiftBusy && !myShifts().length) closeShiftPrompt(); // o gestor encerrou pelo painel
  if (shiftPrompt || shiftBusy || !win) return;
  const mine = myShifts(); const ends = shiftEnds(mine);
  if (!mine.length || ends == null || Date.now() < ends + ASK_AFTER_MS) return;
  shiftPrompt = { stage: 'ask', deadline: Date.now() + ANSWER_MS, endsAt: new Date(ends).toISOString(), creators: mine.map((c) => c.name), error: '' };
  api('POST', '/extension/shifts/prompt', {}).catch(() => {}); // o painel espera a resposta antes de encerrar sozinho
  shiftView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  shiftView.setBackgroundColor('#00000000');
  win.contentView.addChildView(shiftView); // por último: fica por cima das abas e do cartão do fã
  shiftView.webContents.loadFile(path.join(__dirname, 'ui', 'shift.html'));
  layout();
  try { if (win.isMinimized()) win.restore(); win.show(); win.focus(); win.flashFrame(true); } catch {}
  try { if (Notification.isSupported()) new Notification({ title: 'Alta Pulse · fim do turno', body: `Seu turno terminou. Você vai continuar trabalhando? Responda em 1 minuto.` }).show(); } catch {}
  clearInterval(shiftTimer);
  shiftTimer = setInterval(() => { if (shiftPrompt && Date.now() >= shiftPrompt.deadline) endMyShifts('sem_resposta'); }, 1000);
}
function closeShiftPrompt() {
  clearInterval(shiftTimer); shiftTimer = null; shiftPrompt = null;
  if (shiftView) { try { win.contentView.removeChildView(shiftView); shiftView.webContents.close(); } catch {} shiftView = null; }
  try { win.flashFrame(false); } catch {}
}
async function endMyShifts(reason) {
  if (shiftBusy) return; shiftBusy = true; closeShiftPrompt();
  try {
    const out = await api('POST', '/extension/shifts/end-mine', { reason });
    const names = (out && out.ended) || [];
    toast(names.length ? `Turno encerrado${reason === 'sem_resposta' ? ' automaticamente (sem resposta)' : ''}: ${names.join(', ')}.` : 'Nenhum turno ativo para encerrar.');
  } catch (error) { toast(`Não consegui encerrar agora (${error.message}). O painel encerra sozinho em alguns minutos.`); }
  finally { shiftBusy = false; await refreshState(); }
}
function untilFrom(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); if (!m) return null;
  const d = new Date(); d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); // 02:00 digitado às 23h = amanhã
  return d;
}
ipcMain.handle('shiftclock:answer', async (_e, a) => {
  if (!shiftPrompt) return false;
  if (a.answer === 'ready') { pushShiftPrompt(); return true; }
  if (a.answer === 'no') { await endMyShifts('nao'); return true; }
  if (a.answer === 'yes') { shiftPrompt = { ...shiftPrompt, stage: 'until', deadline: Date.now() + ANSWER_MS, error: '' }; pushShiftPrompt(); return true; }
  if (a.answer === 'until') {
    const until = untilFrom(a.time);
    if (!until) { shiftPrompt.error = 'Informe o horário (ex.: 21:30).'; pushShiftPrompt(); return false; }
    if (until.getTime() - Date.now() > 12 * 3600e3) { shiftPrompt.error = 'No máximo 12 horas a partir de agora.'; pushShiftPrompt(); return false; }
    try {
      const out = await api('POST', '/extension/shifts/extend', { until: until.toISOString() });
      for (const c of myShifts()) c.shift.ends_at = out.ends_at; // evita perguntar de novo antes do próximo refresh
      closeShiftPrompt(); toast(`Turno continua até ${a.time}. Vou perguntar de novo 5 min depois.`); refreshState();
      return true;
    } catch (error) { shiftPrompt.error = error.message; pushShiftPrompt(); return false; }
  }
  return false;
});

// ---------- janela, lateral e perfis ----------
let win, sidebar;
const views = new Map(); // creatorId -> aba da PRIVACY (leitor, extrato e presença usam esta)
const tabs = new Map(); // creatorId -> Map(plataforma -> WebContentsView): uma aba por plataforma, mesmo perfil
const activeTab = new Map(); // creatorId -> plataforma em primeiro plano
let activeId = null;
const tabsOf = (id) => { if (!tabs.has(id)) tabs.set(id, new Map()); return tabs.get(id); };
const currentView = (id) => { const t = tabs.get(id); return t ? t.get(activeTab.get(id)) || [...t.values()][0] : null; };

function hideSidebarMenus() { if (sidebar && !sidebar.webContents.isDestroyed()) sidebar.webContents.send('menus:hide'); }
function pushState() { try { if (sidebar && !sidebar.webContents.isDestroyed()) sidebar.webContents.send('state', publicState()); } catch { /* app fechando: abas já destruídas */ } }
function publicState() {
  return {
    ...state,
    origin: config.origin,
    urlbar: !!urlbarPref.show,
    local,
    open: [...tabs.keys()].filter((id) => tabs.get(id).size),
    active: activeId,
    tabs: Object.fromEntries([...tabs].map(([id, t]) => [id, [...t.keys()]])),
    activeTab: Object.fromEntries(activeTab),
    zoom: (() => { try { const p = activeId && activeTab.get(activeId); const v = p && tabs.get(activeId) && tabs.get(activeId).get(p); return v && !v.webContents.isDestroyed() ? { platform: p, label: PLATFORMS[p] ? PLATFORMS[p].label : p, pct: Math.round(v.webContents.getZoomFactor() * 100), auto: p === 'privacy' && !zoomPref.privacy } : null; } catch { return null; } })(),
    fullscreen: (() => { try { return !!(win && !win.isDestroyed() && win.isFullScreen()); } catch { return false; } })(),
    urls: Object.fromEntries([...views].map(([id, v]) => [id, v.webContents.getURL()])),
    readers: Object.fromEntries([...readers].map(([id, r]) => [id, r.summary || null])),
    extratos: Object.fromEntries([...extratos].map(([id, x]) => [id, x.summary || null])),
    fatalfans: Object.fromEntries([...ffs].map(([id, x]) => [id, x.summary || null])),
    closefans: Object.fromEntries([...cfs].map(([id, x]) => [id, x.summary || null])),
    onlyfans: Object.fromEntries([...ofs].map(([id, x]) => [id, x.summary || null])),
    platforms: PLATFORMS,
    credentials: credentials.map((c) => ({ id: c.id, creator_id: c.creator_id, platform: c.platform, login: c.login, has_password: c.has_password })),
    loginPages: Object.fromEntries(loginPages),
    entering: Object.fromEntries(entering),
    vaultErrors: Object.fromEntries(vaultErrors),
    tasks: myTasks,
    opportunities,
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
// zoom por plataforma, neste computador: { privacy: 0.9, onlyfans: 1.1 } (sem valor: Privacy no automático, as outras 100%)
let zoomPref = readJson('zoom.json', {});
if ('manual' in zoomPref) zoomPref = zoomPref.manual ? { privacy: zoomPref.manual } : {}; // formato antigo (só Privacy)
const ZOOM_STEPS = [0.5, 0.6, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const WIDE_SCREEN = 1700;
function fanImportant() { const c = fan.card; return !!(c && (c.tier === 'baleia' || c.task || (c.tags || []).some((t) => ['esfriando', 'novo_sem_compra', 'assinatura_inativa'].includes(t)) || (c.pending_offers || []).length)); }
function fanCollapsed() {
  if (fanUi.mode === 'manual') return !!fanUi.collapsed;
  const [w] = win ? win.getContentSize() : [1920];
  return w < WIDE_SCREEN && !fanImportant();
}
function zoomFor(platform, viewWidth) {
  if (zoomPref[platform]) return zoomPref[platform];
  if (platform !== 'privacy') return 1;
  return Math.max(ZOOM_MIN, Math.min(1, Math.floor((viewWidth / PRIVACY_CSS_WIDTH) * 20) / 20));
}
function applyZoom(view, width, platform = 'privacy') { try { const z = zoomFor(platform, width); if (Math.abs(view.webContents.getZoomFactor() - z) > 0.01) view.webContents.setZoomFactor(z); } catch {} }
// muda o zoom da plataforma (todas as criadoras abertas nela, neste computador): 'in' | 'out' | 'reset'
function changeZoom(platform, dir) {
  if (!PLATFORMS[platform]) return null;
  const sample = [...tabs.values()].map((t) => t.get(platform)).find(Boolean);
  const cur = sample ? sample.webContents.getZoomFactor() : (zoomPref[platform] || 1);
  if (dir === 'reset') delete zoomPref[platform];
  else {
    const next = dir === 'in' ? ZOOM_STEPS.find((z) => z > cur + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.001);
    if (!next) return Math.round(cur * 100);
    zoomPref[platform] = next;
  }
  writeJson('zoom.json', zoomPref); layout(); pushState();
  const after = Math.round((zoomPref[platform] || (sample ? sample.webContents.getZoomFactor() : 1)) * 100);
  if (sidebar) sidebar.webContents.send('toast', `Zoom ${PLATFORMS[platform].label}: ${dir === 'reset' ? (platform === 'privacy' ? 'automático' : '100%') : `${after}%`}${dir === 'reset' ? '' : ' · Ctrl+0 volta ao normal'}`);
  return after;
}
function zoomKeys(view, platform) {
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && win) { event.preventDefault(); win.setFullScreen(!win.isFullScreen()); setTimeout(() => { layout(); pushState(); }, 300); return; }
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    if (input.shift && String(input.key).toLowerCase() === 'm') { event.preventDefault(); if (sidebar && !sidebar.webContents.isDestroyed()) sidebar.webContents.send('focus-mode'); return; } // Ctrl+Shift+M: modo foco da lateral
    const k = input.key; const dir = k === '=' || k === '+' ? 'in' : k === '-' ? 'out' : k === '0' ? 'reset' : null;
    if (!dir) return; event.preventDefault(); changeZoom(platform, dir);
  });
  // Ctrl + rodinha do mouse (e pinça no touchpad)
  view.webContents.on('zoom-changed', (_e, direction) => changeZoom(platform, direction === 'in' ? 'in' : 'out'));
}
let fan = { creatorId: null, fanRef: null, name: null, cid: null, card: null, loading: false, error: null, fetchedAt: 0 };
let myTasks = [];
let fanCids = readJson('fa-conversas.json', {}); // creatorId -> { fanRef: cid } (só neste computador, para abrir a conversa pela lista)
function fanPanelWidth() {
  if (!state.user || !activeId || !['privacy', 'onlyfans', 'fatalfans'].includes(activeTab.get(activeId)) || !tabs.has(activeId)) return 0;
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
function setFanFromChat(id, open, platform = 'privacy') {
  if (!open || !open.name) {
    if (fan.creatorId !== id || fan.fanRef) { const before = fanCollapsed(); fan = { creatorId: id, fanRef: null, name: null, cid: null, card: null, loading: false, error: null, fetchedAt: 0 }; if (fanCollapsed() !== before) layout(); pushFan(); }
    return;
  }
  // OnlyFans: mesma referência das vendas do extrato de Renda (para o cartão juntar as compras do fã)
  const ref = platform === 'onlyfans' ? ofFor(id).reader.ref('fan', open.name) : platform === 'fatalfans' ? ffFor(id).reader.ref('fan', open.name) : readerFor(id).reader.roomKey(open.name);
  if (platform === 'privacy' && open.cid && !String(open.cid).startsWith('n:')) { fanCids[id] = fanCids[id] || {}; if (fanCids[id][ref] !== open.cid) { fanCids[id][ref] = open.cid; writeJson('fa-conversas.json', fanCids); } }
  // fã que mandou mensagem hoje/ontem está com acesso ao chat: não mostrar "assinatura inativa" da lista antiga
  const chatting = (open.msgs || []).some((m) => !m.ours && /^(hoje|ontem)$/i.test(String(m.date || '').trim()));
  // subAtiva: true/false vindo do aviso da Privacy ("não poderá responder, pois não é seu assinante"); null enquanto carrega
  const subAtiva = platform !== 'privacy' || open.skeleton || !(open.msgs || []).length ? null : !open.notSub;
  // esperando resposta: da primeira mensagem do fã depois da nossa última até agora
  let waitSince = null;
  if (!open.otherCreator) { const ms = open.msgs || []; let i = ms.length - 1; while (i >= 0 && !ms[i].ours) i -= 1;
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
  if (id === activeId && (activeTab.get(id) === 'onlyfans' || activeTab.get(id) === 'fatalfans')) return quickFanOF(id);
  const view = views.get(id); if (!view || id !== activeId || view.webContents.isDestroyed()) return;
  try { const data = await view.webContents.executeJavaScript(READER_SCRIPT, true); setFanFromChat(id, data && data.page === 'chat' ? data.open : null); } catch {}
}
// Cartão do fã no OnlyFans: conversa aberta na aba OnlyFans da criadora ativa
async function quickFanOF(id) {
  const platform = activeTab.get(id) === 'fatalfans' ? 'fatalfans' : 'onlyfans';
  const t = tabs.get(id); const view = t && t.get(platform); if (!view || view.webContents.isDestroyed()) return;
  try { const data = await runJs(view, platform === 'fatalfans' ? FF_CHAT_SCRIPT : OF_CHAT_SCRIPT, 5000); setFanFromChat(id, data && data.page === 'chat' ? data.open : null, platform); if (data && data.page === 'chat' && data.open && data.open.cid) sampleConversation(id, view, null, data.open, platform).catch(() => {}); } catch {}
}
// ---------- radar de oportunidades ----------
// a lista de conversas vai ao painel no máximo a cada 90 s por criadora, e só se mudou (sem texto de mensagem)
const radarSent = new Map(); const RADAR_MS = 90000;
async function sendRadar(id, rows, platform = 'privacy') {
  if (!token || !state.storage_allowed || !rows || !rows.length) return;
  const known = platform === 'privacy' ? (fanCids[id] || {}) : {};
  const list = rows.filter((x) => x.fan_ref).map((x) => ({ ...x, cid: x.cid || known[x.fan_ref] || null })).slice(0, 500);
  const sig = JSON.stringify(list.map((x) => [x.fan_ref, x.spent_cents, x.last_from, x.last_at, x.unread, x.intent, x.cid]));
  const key = `${id}|${platform}`; const prev = radarSent.get(key);
  if (prev && (prev.sig === sig || Date.now() - prev.at < RADAR_MS) && !list.some((x) => x.intent && x.last_from === 'fan' && !(prev.intents || []).includes(x.fan_ref))) return;
  radarSent.set(key, { sig, at: Date.now(), intents: list.filter((x) => x.intent && x.last_from === 'fan').map((x) => x.fan_ref) });
  try { await api('POST', '/extension/radar', { creator_id: id, platform, rows: list }); await loadOpportunities(); }
  catch (error) { radarSent.delete(key); }
}
// FatalFans: a lista de conversas de cada aba aberta (sem abrir chats); mesma referência de fã do extrato de vendas
async function radarFatalFans() {
  if (!token || !state.storage_allowed) return;
  for (const [id, t] of tabs) {
    const view = t.get('fatalfans'); if (!view || view.webContents.isDestroyed() || !/fatalfans\.com\/chat/.test(view.webContents.getURL())) continue;
    let data; try { data = await runJs(view, FF_CHAT_SCRIPT, 5000); } catch { continue; }
    if (!data || !data.rooms || !data.rooms.length) continue;
    const reader = ffFor(id).reader; reader.options.fanNames = !!state.fan_names_allowed; const now = new Date();
    const rows = data.rooms.map((r) => { const at = listAt(r.when, now); return { ...reader.fan(r.name), cid: 'ff:' + r.name.slice(0, 77), spent_cents: null, last_from: r.ours ? 'us' : 'fan', last_at: at ? at.toISOString() : null, unread: r.unread || 0, intent: !!r.intent }; });
    sendRadar(id, rows, 'fatalfans').catch(() => {});
  }
}
let opportunities = []; const oppSeen = new Set(); let oppFirst = true;
async function loadOpportunities() {
  if (!token || !state.user) return;
  try { opportunities = await api('GET', '/extension/opportunities'); } catch { return; }
  // alerta na hora só para o que é quente (pediu preço) nas criadoras do turno de quem está logado
  const mineIds = new Set((state.creators || []).filter((c) => c.shift && c.shift.operator_id === state.user.id && !c.shift.paused).map((c) => c.id));
  const fresh = opportunities.filter((o) => o.hot && !oppSeen.has(o.id) && mineIds.has(o.creator_id));
  for (const o of opportunities) oppSeen.add(o.id);
  if (!oppFirst && fresh.length) {
    const o = fresh[0]; const who = o.fan_name || 'Um fã';
    const msg = `${o.creator_name}: ${who} perguntou preço ou pediu conteúdo${fresh.length > 1 ? ` (+${fresh.length - 1})` : ''}`;
    if (sidebar) sidebar.webContents.send('toast', `💰 ${msg}`);
    try { const n = new Notification({ title: 'Oportunidade de venda', body: msg, silent: false }); n.on('click', () => { if (win) { win.show(); win.focus(); } openOpportunity(o.id).catch(() => {}); }); n.show(); } catch {}
  }
  oppFirst = false; pushState();
}
// abre a conversa de um fã no perfil isolado da criadora (Privacy pelo id da conversa; FatalFans clicando no nome)
async function openConversation(creatorId, platform, cid, name, fanRef) {
  if (platform === 'fatalfans') {
    openProfile(creatorId, 'fatalfans');
    const t = tabs.get(creatorId); const v = t && t.get('fatalfans'); const nm = String(cid || '').replace(/^ff:/, '') || name;
    if (!v || !nm) return { found: false, name };
    if (!/fatalfans\.com\/chat/.test(v.webContents.getURL())) { await v.webContents.loadURL('https://fatalfans.com/chat', { userAgent: UA }); await new Promise((r) => setTimeout(r, 2500)); }
    // clica no item da lista com esse nome (o mesmo que o chatter faria)
    const ok = await runJs(v, `(() => { const n = ${JSON.stringify(nm)}; const it = [...document.querySelectorAll('div.min-h-18.cursor-pointer')].find((r) => { const h = r.querySelector('h3'); return h && h.textContent.replace(/\\s+/g, ' ').trim() === n; }); if (it) { it.click(); return true; } return false; })()`, 4000).catch(() => false);
    return { found: !!ok, name: name || nm };
  }
  openProfile(creatorId, 'privacy');
  const view = views.get(creatorId); const id = cid || (fanRef && fanCids[creatorId] && fanCids[creatorId][fanRef]);
  if (!view) return { found: false, name };
  const rawId = id && !/^(n:|ff:)/.test(String(id)) ? String(id) : null;
  const chatUrl = rawId ? `https://privacy.com.br/chat?cid=${encodeURIComponent(rawId)}` : 'https://privacy.com.br/chat';
  await view.webContents.loadURL(chatUrl, { userAgent: UA }).catch(() => {});
  // caiu na tela de login (sessão da criadora venceu)? entra com o acesso salvo, como o chip "Entrar" faria, e volta ao chat
  await sleep(1200);
  if (!view.webContents.isDestroyed() && await probeLogin(view) && credentials.some((c) => c.creator_id === creatorId && c.platform === 'privacy') && !entering.has(creatorId)) {
    setLogin(creatorId, 'privacy', true); entering.set(creatorId, 'privacy'); pushState();
    try {
      await vaultFill(creatorId, 'privacy', view);
      for (let i = 0; i < 15; i++) { await sleep(700); if (view.webContents.isDestroyed()) break; if (!(await probeLogin(view))) { setLogin(creatorId, 'privacy', false); vaultErrors.delete(creatorId); break; } }
    } catch (error) { vaultErrors.set(creatorId, { platform: 'privacy', reason: error.message }); }
    finally { entering.delete(creatorId); pushState(); }
    if (view.webContents.isDestroyed()) return { found: false, name };
    if (await probeLogin(view)) { if (sidebar) sidebar.webContents.send('toast', 'Privacy ainda na tela de login: entre na criadora e tente de novo.'); return { found: true, name, how: 'login' }; }
    if (!/privacy\.com\.br\/chat/.test(view.webContents.getURL())) await view.webContents.loadURL(chatUrl, { userAgent: UA }).catch(() => {});
  }
  // confere se a conversa certa abriu; se não, faz o que o chatter faria: acha o fã na lista (usando a busca da Privacy, se houver) e clica
  const want = String(name || (id && String(id).replace(/^n:/, '')) || '').trim();
  if (!want) return { found: !!rawId, name };
  // o chat da Privacy fica dentro de shadow roots (<privacy-web-chat>): toda busca atravessa os roots, refeitos a cada tentativa
  const PICK = `(async () => {
    const norm = (t) => String(t || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const want = ${JSON.stringify(want)}; const w = norm(want);
    const roots = () => { const out = []; (function walk(root, depth) { if (depth > 6) return; out.push(root); for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, depth + 1); })(document, 0); return out; };
    const qs = (sel) => { for (const r of roots()) { const e = r.querySelector(sel); if (e) return e; } return null; };
    const qsa = (sel) => roots().flatMap((r) => [...r.querySelectorAll(sel)]);
    const header = () => norm((qs('.vac-room-header .vac-list-name .vac-text-ellipsis') || qs('.vac-room-header .vac-list-name') || {}).textContent);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const rooms = () => qsa('.vac-room-list .vac-room-item, .vac-room-item');
    const nameOf = (r) => norm((r.querySelector('.name, .vac-room-name, .vac-text-ellipsis') || r).textContent);
    const find = () => rooms().find((r) => nameOf(r) === w) || rooms().find((r) => nameOf(r).startsWith(w));
    const search = () => qs('.vac-box-search input, .vac-room-list input, input[placeholder*="esquis" i], input[placeholder*="uscar" i], input[type="search"]');
    // a lista demora a montar: espera até 20 s a conversa certa, a lista ou a busca aparecerem
    for (let i = 0; i < 50; i++) { if (header() === w) return 'ja'; if (rooms().length || search()) break; await sleep(400); }
    let it = find();
    if (!it) {
      const box = search();
      if (!box) return rooms().length ? 'sem-busca' : 'sem-lista';
      box.focus(); box.click();
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(box, want);
      box.dispatchEvent(new Event('input', { bubbles: true })); box.dispatchEvent(new Event('change', { bubbles: true }));
      box.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
      for (let i = 0; i < 25 && !(it = find()); i++) await sleep(400);
      if (!it) return 'nao:' + rooms().length;
    }
    it.click();
    for (let i = 0; i < 15; i++) { await sleep(400); if (header() === w) return 'ok'; }
    return 'clicou';
  })()`;
  await new Promise((r) => setTimeout(r, 800));
  const r = await runJs(view, PICK, 45000).catch((e) => 'erro:' + (e && e.message));
  const found = r === 'ja' || r === 'ok' || r === 'clicou';
  if (!found && sidebar && !sidebar.webContents.isDestroyed()) sidebar.webContents.send('toast', `Não consegui abrir a conversa de "${want}" (${r}). Procure na lista.`);
  return { found: true, name, how: r }; // a lateral já avisou; evita dois avisos
}
async function openOpportunity(oppId) {
  const o = opportunities.find((x) => x.id === oppId); if (!o) throw new Error('Oportunidade não encontrada.');
  return openConversation(o.creator_id, o.platform || 'privacy', o.cid, o.fan_name, o.fan_ref);
}
// link do painel "Abrir no app": altapulse://abrir?c=<criadora>&p=<plataforma>&cid=<conversa>&n=<nome do fã>&f=<ref>
async function handleDeepLink(url) {
  let u; try { u = new URL(url); } catch { return; }
  if (u.protocol !== 'altapulse:') return;
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  const q = u.searchParams; const creatorId = q.get('c');
  if (!creatorId) return;
  if (!state.user) { if (sidebar) sidebar.webContents.send('toast', 'Entre no Alta Pulse para abrir a conversa.'); return; }
  if (!(state.creators || []).some((c) => c.id === creatorId)) { if (sidebar) sidebar.webContents.send('toast', 'Esta criadora não está liberada para você neste app.'); return; }
  const r = await openConversation(creatorId, q.get('p') || 'privacy', q.get('cid'), q.get('n'), q.get('f')).catch(() => null);
  if (r && !r.found && sidebar) sidebar.webContents.send('toast', `Procure "${r.name || 'o fã'}" na lista de conversas: ainda não sei qual é a conversa dele.`);
}
let pendingLink = process.argv.find((a) => /^altapulse:\/\//i.test(a)) || null;
ipcMain.handle('opp:open', (_e, id) => openOpportunity(id));
// "N esperando" no card: abre a conversa de quem está esperando (mesmo que esteja lá no fim da lista da Privacy)
ipcMain.handle('wait:open', (_e, w) => {
  if (!w || !w.creator_id || !w.name || !(state.creators || []).some((c) => c.id === w.creator_id)) throw new Error('Conversa não encontrada.');
  return openConversation(w.creator_id, 'privacy', w.rid || null, String(w.name).slice(0, 120), readerFor(w.creator_id).reader.roomKey(w.name));
});
ipcMain.handle('opp:action', async (_e, { id, action, reason }) => { await api('POST', `/extension/opportunities/${encodeURIComponent(id)}/action`, { action, reason: reason || '' }); await loadOpportunities(); return publicState(); });
ipcMain.handle('opp:reload', async () => { await loadOpportunities(); return publicState(); });
async function loadTasks() {
  try { myTasks = await api('GET', '/extension/fan-tasks'); } catch { myTasks = []; }
}

// ---------- barra de endereço (como no Lauth): link da página aberta, Copiar e colar um link para abrir ----------
const URLBAR_H = 32;
let urlbarPref = readJson('barra-endereco.json', { show: true });
let urlView = null;
const activeView = () => { const t = activeId && tabs.get(activeId); const p = activeId && activeTab.get(activeId); return t && p ? t.get(p) || null : null; };
const urlbarOn = () => !!(urlbarPref.show && urlView && activeView());
function pushUrl() {
  if (!urlView || urlView.webContents.isDestroyed()) return;
  const v = activeView(); let url = '';
  try { url = v && !v.webContents.isDestroyed() ? v.webContents.getURL() : ''; } catch {}
  const p = activeId && activeTab.get(activeId); const c = (state.creators || []).find((x) => x.id === activeId);
  urlView.webContents.send('url', { url, label: [c && c.name, p && PLATFORMS[p] ? PLATFORMS[p].label : p].filter(Boolean).join(' · ') });
}
ipcMain.handle('url:copy', () => { const v = activeView(); const url = v && !v.webContents.isDestroyed() ? v.webContents.getURL() : ''; if (!/^https:\/\//i.test(url)) return false; clipboard.writeText(url); return true; });
// colar um link e Enter: abre no perfil da criadora que está na tela (a conversa é da conta dela).
// Link de outra plataforma abre na aba daquela plataforma da mesma criadora; link do app (altapulse://) usa a criadora do link.
ipcMain.handle('url:go', async (_e, text) => {
  let s = String(text || '').trim().slice(0, 2000);
  if (/^altapulse:\/\//i.test(s)) { await handleDeepLink(s); return { ok: true }; }
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u; try { u = new URL(s); } catch { return { ok: false, reason: 'Endereço inválido.' }; }
  if (u.protocol !== 'https:' || !allowedUrl(u.href)) return { ok: false, reason: 'Só abre links das plataformas do app (Privacy, OnlyFans, FatalFans…).' };
  if (!activeId) return { ok: false, reason: 'Abra primeiro a criadora dona da conversa.' };
  const platform = platformOf(u.href) || activeTab.get(activeId) || 'privacy';
  if (!tabsOf(activeId).has(platform)) openProfile(activeId, platform);
  else { activeTab.set(activeId, platform); layout(); pushState(); }
  const v = tabsOf(activeId).get(platform); if (!v || v.webContents.isDestroyed()) return { ok: false, reason: 'A aba não abriu.' };
  await v.webContents.loadURL(u.href).catch(() => {}); pushUrl();
  return { ok: true };
});
ipcMain.handle('urlbar:show', (_e, show) => { urlbarPref = { show: !!show }; writeJson('barra-endereco.json', urlbarPref); layout(); pushState(); return urlbarPref.show; });

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const pw = fanPanelWidth();
  sidebar.setBounds({ x: 0, y: 0, width: SIDEBAR_WIDTH, height: h });
  const bar = urlbarOn() ? URLBAR_H : 0; const vwAll = Math.max(w - SIDEBAR_WIDTH - PEEK - pw, 200);
  if (urlView) { urlView.setBounds({ x: SIDEBAR_WIDTH, y: 0, width: vwAll, height: URLBAR_H }); urlView.setVisible(bar > 0); if (bar) pushUrl(); }
  for (const [id, t] of tabs) for (const [platform, v] of t) {
    const vw = vwAll;
    v.setBounds({ x: SIDEBAR_WIDTH, y: bar, width: vw, height: h - bar });
    v.setVisible(id === activeId && platform === activeTab.get(id));
    applyZoom(v, vw, platform);
  }
  // a faixa de 2 px da aba oculta do extrato fica ENTRE a Privacy e o painel do fã (não coberta)
  if (fanView) { fanView.setBounds({ x: w - pw, y: 0, width: pw, height: h }); fanView.setVisible(pw > 0); }
  for (const x of extratos.values()) if (x.view && !x.shown && !x.view.webContents.isDestroyed()) x.view.setBounds(hiddenBounds());
  if (shiftView) shiftView.setBounds({ x: 0, y: 0, width: w, height: h });
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
  ses.setUserAgent(UA, LANG);
  const view = new WebContentsView({
    webPreferences: { partition: partitionFor(creatorId), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  view.webContents.setUserAgent(UA, LANG);
  // pop-ups do próprio site (login social, por exemplo) abrem na mesma sessão isolada
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url) && allowedUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: partitionFor(creatorId), contextIsolation: true, sandbox: true } } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  view.webContents.on('did-navigate', () => { pushState(); if (view === activeView()) pushUrl(); });
  view.webContents.on('did-finish-load', () => probeSoon(creatorId, platform, view));
  if (platform === 'privacy') {
    view.webContents.on('did-finish-load', () => layout());
  }
  zoomKeys(view, platform);
  // o Chromium guarda zoom por site; aqui quem manda é a escolha por plataforma
  view.webContents.on('did-finish-load', () => { const z = zoomFor(platform, view.getBounds().width); if (Math.abs(view.webContents.getZoomFactor() - z) > 0.01) view.webContents.setZoomFactor(z); });
  view.webContents.on('did-navigate-in-page', () => { pushState(); if (view === activeView()) pushUrl(); probeSoon(creatorId, platform, view); if (['privacy', 'onlyfans', 'fatalfans'].includes(platform)) setTimeout(() => quickFan(creatorId), 1200); });
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
  if (platform === 'fatalfans') scheduleFF(creatorId, EXTRATO_FIRST_MS);
  if (platform === 'closefans') scheduleCF(creatorId, EXTRATO_FIRST_MS);
  if (platform === 'onlyfans') scheduleOF(creatorId, EXTRATO_FIRST_MS);
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
  if (activeId && ['onlyfans', 'fatalfans'].includes(activeTab.get(activeId))) await quickFanOF(activeId);
  for (const [id, view] of views) {
    const r = readerFor(id); r.reader.options.fanNames = !!state.fan_names_allowed;
    let data;
    try { if (view.webContents.isDestroyed()) continue; data = await runJs(view, READER_SCRIPT, 8000); } catch { continue; }
    // foto da criadora: também pela aba da Privacy aberta (avatar no topo), sem esperar o extrato; uma vez por sessão
    if (!(state.creators || []).find((c) => c.id === id && c.avatar)) grabAvatar(id, view, 'privacy').catch(() => {});
    if (id === activeId && activeTab.get(id) === 'privacy') setFanFromChat(id, data && data.page === 'chat' ? data.open : null);
    if (data && data.page === 'chat') plantao.onRooms(id, data.rooms);
    // fora da tela de chat: mantém o último balão conhecido (o chatter pode estar no feed por um instante)
    if (!data || data.page !== 'chat') { const prev = r.summary || {}; r.summary = { waiting: 0, waitingRecent: prev.waitingRecent || 0, oldestWaitMin: null, page: data ? data.page : 'other', readAt: new Date().toISOString() }; continue; }
    let events, summary, radar;
    try { ({ events, summary, radar } = r.reader.process(data, new Date())); }
    catch (error) { try { fs.appendFileSync(path.join(app.isPackaged ? dataDir() : __dirname, 'erros-leitura.log'), `${new Date().toISOString()} process erro ${id.slice(0, 6)} ${error && error.stack}\n`); } catch {} continue; }
    r.summary = summary;
    writeJson(`reader-${id}.json`, r.reader.s);
    sendRadar(id, radar).catch(() => {});
    const creator = state.creators.find((c) => c.id === id);
    const shift = creator && creator.shift;
    const mine = shift && shift.operator_id === state.user.id && !shift.paused;
    // com o extrato funcionando para esta criadora, a venda inferida pela lista de conversas não é
    // enviada (o extrato traz a mesma venda com hora, produto e situação exatos; evita contar em dobro)
    if (extratoHealthy(id)) events = events.filter((e) => e.kind !== 'sale');
    // bloco E: amostra anonimizada da conversa aberta, só no turno do próprio usuário e com a opção ligada
    if (data.open && data.open.cid) sampleConversation(id, view, r, data.open, 'privacy').catch(() => {});
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
// Privacy, OnlyFans e FatalFans. Só no turno do próprio usuário e com a IA de qualidade ligada no painel.
// Cada tentativa fica registrada no diagnóstico enviado ao painel (Qualidade → Apps da equipe): nada falha em silêncio.
const SAMPLE_OTHER = require('./sample-other-page.js');
const samples = new Map(); // creatorId|cid -> { at, count }
const diag = { sample_ok_at: null, sample_error: '', sample_error_at: null, sample_skip: '', samples_sent: 0, day: '' };
function skip(reason) { if (diag.sample_skip !== reason) { diag.sample_skip = reason; } }
async function sampleConversation(id, view, r, open, platform = 'privacy') {
  if (!state.storage_allowed || !state.quality_ai_allowed) return skip('IA de qualidade desligada no painel');
  const creator = (state.creators || []).find((c) => c.id === id); const sh = creator && creator.shift;
  if (!sh || sh.operator_id !== (state.user && state.user.id)) return skip('sem turno próprio nesta criadora');
  if (sh.paused) return skip('turno pausado');
  const key = `${id}|${open.cid}`; const last = samples.get(key);
  const count = (open.msgs || []).length;
  if (last && (Date.now() - last.at < SAMPLE_MS || last.count === count)) return;
  samples.set(key, { at: Date.now(), count });
  try {
    const data = await runJs(view, platform === 'privacy' ? SAMPLE_SCRIPT : SAMPLE_OTHER[platform], 6000);
    if (!data || !data.msgs) return skip(`${platform}: conversa sem mensagens legíveis`);
    if (data.msgs.length < 3) return skip(`${platform}: conversa com menos de 3 mensagens`);
    const now = new Date();
    const when = (m) => { try { const t = m.date && m.time ? msgAt(m.date, m.time, now) : null; return t && !isNaN(t) ? t.toISOString() : null; } catch { return null; } };
    const fanRef = platform === 'onlyfans' ? ofFor(id).reader.ref('fan', data.name) : platform === 'fatalfans' ? ffFor(id).reader.ref('fan', data.name) : r.reader.fan(data.name).fan_ref;
    if (!fanRef) return skip(`${platform}: sem nome do fã no cabeçalho`);
    await api('POST', '/extension/samples', { creator_id: id, fan_ref: fanRef, platform, captured_at: now.toISOString(), messages: data.msgs.map((m) => ({ ours: !!m.ours, at: when(m), text: m.text })) });
    const today = now.toISOString().slice(0, 10); if (diag.day !== today) { diag.day = today; diag.samples_sent = 0; }
    diag.samples_sent += 1; diag.sample_ok_at = now.toISOString(); diag.sample_skip = '';
    if (r && r.summary) r.summary.sampled = (r.summary.sampled || 0) + 1;
  } catch (error) {
    samples.delete(key); // tenta de novo na próxima leitura
    diag.sample_error = `${platform}: ${String(error.message || error).slice(0, 240)}`; diag.sample_error_at = new Date().toISOString();
    sendDiag(true);
  }
}
let diagSentAt = 0;
async function sendDiag(force) {
  if (!token || !state.user || (!force && Date.now() - diagSentAt < 4 * 60 * 1000)) return;
  diagSentAt = Date.now();
  try { await api('POST', '/extension/diag', { version: app.getVersion(), quality_ai: !!state.quality_ai_allowed, storage: !!state.storage_allowed,
    sample_ok_at: diag.sample_ok_at, sample_error: diag.sample_error, sample_error_at: diag.sample_error_at, sample_skip: diag.sample_skip, samples_sent: diag.samples_sent }); } catch {}
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
  view.webContents.setUserAgent(UA, LANG);
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
// nenhuma leitura pode prender a fila: depois de 6 min a próxima segue (a travada termina sozinha ou morre com a aba)
const capped = (p) => Promise.race([p, sleep(6 * 60 * 1000)]);
function readExtrato(id, opts = {}) {
  const p = extratoChain.then(() => capped(readExtratoNow(id, opts))).catch(() => {});
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
    const run = (action) => runJs(view, EXTRATO.script(action), 15000);
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
    await grabAvatar(id, view, 'privacy');
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
        const t = await runJs(view, SNAPSHOT.script('tab'), 15000);
        if (t.hadTab) {
          await sleep(3500);
          let snap = await runJs(view, SNAPSHOT.script('read'), 15000);
          for (let i = 0; i < 4 && !snap.ok; i++) { await sleep(2500); snap = await runJs(view, SNAPSHOT.script('read'), 15000); }
          if (snap.ok) { await api('POST', '/extension/snapshots', { creator_id: id, taken_at: snap.readAt, period: snap.period || null, data: snap }); x.snapshotAt = Date.now(); x.summary.snapshot = snap.readAt; }
          else x.summary.snapshotError = 'sem dados na Visão geral';
        }
      } catch (error) { x.summary.snapshotError = error.message.slice(0, 120); }
    }
    // bloco D: lista de assinantes (situação e preço da assinatura) a cada 6 h, na mesma aba oculta
    if (state.storage_allowed && (!x.reader.s.subsAt || x.reader.s.subsV !== 2 || Date.now() - x.reader.s.subsAt > SUBS_MS)) {
      try {
        const runS = (a) => runJs(view, SUBS.script(a), 15000);
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
// ---------- foto da criadora: pega a foto de perfil na plataforma (aba oculta já logada) ----------
// Só quando a criadora ainda não tem foto no painel. Se não deu (página ainda carregando, aba escondida,
// download bloqueado), tenta de novo na próxima leitura, no máximo a cada 1 min e até 8 vezes por sessão.
const avatarTried = new Map(); // `${id}|${platform}` -> { n, at, done }
const avatarLog = {}; // diagnóstico por criadora (portátil)
async function grabAvatar(id, view, platform) {
  const key = `${id}|${platform}`;
  const c0 = (state.creators || []).find((x) => x.id === id);
  const step = (stage, extra) => {
    const t = avatarTried.get(key) || { n: 0 }; if (stage === 'ok' || stage === 'painel recusou') t.done = true; avatarTried.set(key, t);
    if (isPortable()) try { avatarLog[`${platform} · ${c0 ? c0.name : id.slice(0, 6)}`] = { at: new Date().toISOString(), stage, ...(extra || {}) }; fs.writeFileSync(path.join(calibDir(), 'fotos-etapas.json'), JSON.stringify(avatarLog, null, 1)); } catch {}
  };
  try {
    const c = c0;
    if (!c || c.avatar || !state.user) return;
    const t = avatarTried.get(key) || { n: 0, at: 0 };
    if (t.done || t.n >= 8 || Date.now() - (t.at || 0) < 60000) return;
    t.n += 1; t.at = Date.now(); avatarTried.set(key, t);
    const list = await runJs(view, AVATAR_SCRIPT, 8000);
    if (!Array.isArray(list) || !list.length) return step('sem foto na tela (ainda carregando?)');
    const [w] = win.getContentSize();
    let pick = null;
    if (platform === 'fatalfans') pick = list.filter((a) => a.y < 600).sort((a, b) => b.w - a.w)[0];               // card do perfil no painel da criadora
    else if (platform === 'onlyfans') pick = list.filter((a) => a.head).sort((a, b) => a.y - b.y || a.x - b.x)[0]; // avatar no topo da lateral
    else pick = list.filter((a) => a.head && a.y < 140).sort((a, b) => b.x - a.x)[0];                                // canto do cabeçalho (Privacy, CloseFans)
    if (!pick) pick = list.filter((a) => a.y < 700).sort((a, b) => b.w - a.w)[0];
    if (isPortable()) try { fs.writeFileSync(path.join(calibDir(), `foto-${platform}-candidatas.json`), JSON.stringify(list.map((a) => ({ ...a, src: a.src.slice(0, 60) })), null, 1)); } catch {}
    if (!pick) return step('sem candidata');
    // como o navegador: com a página de origem (Referer) e o mesmo navegador; sem isso a Privacy responde 403
    let origin = ''; try { origin = new URL(view.webContents.getURL()).origin + '/'; } catch {}
    const res = await session.fromPartition(partitionFor(id)).fetch(pick.src, { headers: { ...(origin ? { Referer: origin } : {}), 'User-Agent': UA, Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*' } });
    let img, buf = Buffer.alloc(0);
    if (res.ok) { buf = Buffer.from(await res.arrayBuffer()); img = nativeImage.createFromBuffer(buf); }
    else {
      // download bloqueado: "fotografa" a bolinha na própria tela (só funciona com a aba visível)
      try { const z = view.webContents.getZoomFactor() || 1; const shot = await view.webContents.capturePage({ x: Math.round(pick.x * z), y: Math.round(pick.y * z), width: Math.round(pick.w * z), height: Math.round(pick.h * z) }); if (!shot.isEmpty()) img = shot; } catch {}
      if (!img) return step('download falhou', { status: res.status });
    }
    // a Privacy entrega a foto em WebP, que o nativeImage não lê: converte na lateral (Chromium lê WebP) para PNG
    if (img.isEmpty() && buf.length && sidebar && !sidebar.webContents.isDestroyed()) {
      const mime = (res.headers.get('content-type') || 'image/webp').split(';')[0];
      const png = await runJs(sidebar, `new Promise((ok) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); ok(c.toDataURL('image/png')); }; i.onerror = () => ok(null); i.src = 'data:${mime};base64,${buf.toString('base64')}'; })`, 8000);
      if (png) img = nativeImage.createFromDataURL(png);
    }
    if (img.isEmpty()) return step('imagem ilegível', { type: res.headers.get('content-type'), bytes: buf.length });
    const { width, height } = img.getSize(); const side = Math.min(width, height);
    const square = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side }).resize({ width: 160, height: 160, quality: 'best' });
    const image = 'data:image/jpeg;base64,' + square.toJPEG(82).toString('base64');
    if (image.length > 118000) return step('grande demais', { size: image.length });
    if (isPortable()) try { fs.mkdirSync(calibDir(), { recursive: true }); fs.writeFileSync(path.join(calibDir(), `foto-${platform}-${c.name.replace(/[^\w]+/g, '_')}.jpg`), square.toJPEG(82)); } catch {}
    try { await api('POST', `/extension/creators/${id}/avatar`, { image }); } catch (error) { return step('painel recusou', { error: String(error.message).slice(0, 200) }); }
    c.avatar = image; pushState(); step('ok');
  } catch (error) { step('erro', { error: String(error && error.message).slice(0, 200) }); }
}

// ---------- FatalFans: Minhas vendas (transações e assinantes) ----------
// Mesma ideia do extrato da Privacy: aba oculta na sessão da criadora, lê Transações (todas as páginas
// na primeira vez; depois até achar vendas já conhecidas) e, a cada 6 h, a lista de Assinantes.
const ffs = new Map(); // creatorId -> { view, reader, summary, timer, busy }
function ffFor(id) {
  if (!ffs.has(id)) ffs.set(id, { view: null, reader: new FatalFansReader(id, secretFor(), readJson(`fatalfans-${id}.json`, null), { fanNames: !!state.fan_names_allowed }), summary: null, timer: null, busy: false });
  return ffs.get(id);
}
function ffView(id) {
  const x = ffFor(id);
  if (x.view && !x.view.webContents.isDestroyed()) return x.view;
  const view = new WebContentsView({ webPreferences: { partition: partitionFor(id), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  view.webContents.setUserAgent(UA, LANG); view.webContents.setAudioMuted(true); view.webContents.setBackgroundThrottling(false);
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.contentView.addChildView(view, 0); view.setBounds(hiddenBounds());
  x.view = view; return view;
}
function closeFFView(id) {
  const x = ffs.get(id); if (!x) return;
  if (x.view && !x.view.webContents.isDestroyed()) { win.contentView.removeChildView(x.view); x.view.webContents.close(); }
  x.view = null;
}
function scheduleFF(id, ms) { const x = ffFor(id); clearTimeout(x.timer); x.timer = setTimeout(() => readFF(id).catch(() => {}), ms); }
const ffStep = (o) => { if (isPortable()) try { fs.mkdirSync(calibDir(), { recursive: true }); fs.writeFileSync(path.join(calibDir(), 'fatalfans-progresso.json'), JSON.stringify({ at: new Date().toISOString(), ...o })); } catch {} };
function readFF(id, opts = {}) { ffStep({ stage: 'na fila', opts }); const p = ffChain.then(() => capped(readFFNow(id, opts))).catch(() => {}); ffChain = p; return p; }
let ffChain = Promise.resolve();
const ffTabOpen = (id) => !!(tabs.get(id) && tabs.get(id).has('fatalfans'));
async function hasFFSession(id) { try { return (await session.fromPartition(partitionFor(id)).cookies.get({ url: 'https://fatalfans.com' })).length > 0; } catch { return false; } }
async function loadFF(view) {
  await new Promise((resolve) => {
    let timer = null;
    const done = () => { clearTimeout(timer); const wc = view.webContents; if (wc && !wc.isDestroyed()) { wc.removeListener('did-finish-load', done); wc.removeListener('did-fail-load', done); } resolve(); };
    view.webContents.once('did-finish-load', done); view.webContents.once('did-fail-load', done);
    view.webContents.loadURL(FF_URL, { userAgent: UA }); timer = setTimeout(done, 25000);
  });
  await sleep(4000);
}
async function readFFNow(id, opts = {}) {
  const x = ffFor(id);
  if (!state.user || x.busy) return;
  if (!ffTabOpen(id) && !opts.background) return;
  x.busy = true;
  try {
    x.reader.options.fanNames = !!state.fan_names_allowed;
    const view = ffView(id);
    win.contentView.removeChildView(view); win.contentView.addChildView(view, 0); view.setBounds(hiddenBounds());
    const step = ffStep;
    const run = (a) => runJs(view, FF.script(a), 10000).catch((e) => ({ error: String(e && e.message || e), rows: [] }));
    step({ stage: 'carregando' });
    await loadFF(view);
    step({ stage: 'carregou', url: view.webContents.getURL() });
    await grabAvatar(id, view, 'fatalfans');
    let t = await run('tab:transacoes');
    for (let i = 0; i < 16 && !t.hadTab && !t.loggedOut; i++) { await sleep(2500); t = await run('tab:transacoes'); if (i === 8 && !t.hadTab) { await loadFF(view); } }
    if (!t.hadTab) { x.summary = { error: t.loggedOut ? 'login' : `sem aba Transações (${(t.url || '').slice(0, 80)})`, readAt: new Date().toISOString(), rows: 0 }; return; }
    // o Resumo também tem uma tabela de extrato (5 linhas, sem páginas): espera a aba Transações ficar ativa
    for (let i = 0; i < 8 && !t.tabActive; i++) { await sleep(1500); t = await run('tab:transacoes'); }
    await sleep(2500);
    let d = await run('transacoes');
    for (let i = 0; i < 8 && (!(d.rows || []).length || !d.tabActive); i++) { await sleep(2000); d = await run('transacoes'); }
    const diag = { tab: t, first: { rows: (d.rows || []).length, page: d.page, pages: d.pages, hasNext: d.hasNext, tabActive: d.tabActive, heads: d.heads } };
    const all = [...(d.rows || [])];
    const full = !x.reader.s.backfilled; let pages = 1;
    // primeira vez: todas as páginas (até 60); depois: avança enquanto a página tiver venda nova (até 6)
    while (d.hasNext && pages < (full ? 60 : 6) && (full || (d.rows || []).some((r) => !x.reader.known(r)))) {
      const before = d.page; await run('next'); let moved = false;
      for (let w = 0; w < 10; w++) { await sleep(1200); d = await run('transacoes'); if (d.page !== before) { moved = true; break; } }
      if (!moved) break; all.push(...(d.rows || [])); pages += 1; step({ stage: 'paginas', pages, rows: all.length });
    }
    const { events, summary } = x.reader.process(all, new Date());
    x.summary = { ...summary, pages, sent: 0 };
    if (isPortable()) try { const dir = calibDir(); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'fatalfans-ultima-leitura.json'), JSON.stringify({ at: new Date().toISOString(), diag, total: all.length, pages, events: events.length, sample: all.slice(0, 3).map((r) => ({ ...r, name: r.name ? '•••' : '' })) }, null, 1)); } catch {}
    if (events.length && state.storage_allowed) {
      const accepted = [];
      for (let i = 0; i < events.length; i += 150) {
        const out = await api('POST', '/extension/observations', { events: events.slice(i, i + 150) });
        for (const r of out.results || []) if (r.ok) accepted.push(r.event_ref);
        const rejected = (out.results || []).filter((r) => !r.ok);
        if (rejected.length) { x.summary.rejected = (x.summary.rejected || 0) + rejected.length; x.summary.lastReject = rejected[0].detail; }
      }
      x.reader.markSent(accepted); x.summary.sent = accepted.length;
      if (full && all.length) x.reader.s.backfilled = true;
    } else { x.reader.markSent([]); if (!state.storage_allowed) x.summary.dropped = events.length; }
    // assinantes a cada 6 h
    if (state.storage_allowed && (!x.reader.s.subsAt || Date.now() - x.reader.s.subsAt > SUBS_MS)) {
      try {
        let s = await run('tab:assinantes');
        for (let i = 0; i < 6 && s.hadTab && !s.tabActive; i++) { await sleep(2000); s = await run('tab:assinantes'); }
        await sleep(2500);
        let a = await run('assinantes');
        for (let i = 0; i < 6 && !(a.rows || []).length; i++) { await sleep(2000); a = await run('assinantes'); }
        const rows = [...(a.rows || [])]; let p = 1;
        while (a.hasNext && p < 80) {
          const before = a.page; await run('next'); let moved = false;
          for (let w = 0; w < 10; w++) { await sleep(1000); a = await run('assinantes'); if (a.page !== before) { moved = true; break; } }
          if (!moved) break; rows.push(...(a.rows || [])); p += 1;
        }
        const byFan = new Map();
        for (const r of rows) {
          const f = x.reader.fan(r.name); if (!f.fan_ref) continue;
          const m = (r.price || '').match(/([\d.]+,\d{2})/); const price = m ? Math.round(parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * 100) : null;
          const row = { ...f, status: (r.status || '').slice(0, 40), price_cents: price, duration: '' };
          const cur = byFan.get(f.fan_ref);
          if (!cur || (/^ativ/i.test(row.status) && !/^ativ/i.test(cur.status))) byFan.set(f.fan_ref, row);
        }
        const list = [...byFan.values()];
        if (list.length) {
          const label = a.cards && (a.cards.ativos || a.cards.total) ? `${a.cards.ativos || '?'} ativos de ${a.cards.total || '?'}` : '';
          const out = await api('POST', '/extension/subscribers', { creator_id: id, platform: 'fatalfans', taken_at: new Date().toISOString(), total_label: label.slice(0, 40), rows: list.slice(0, 3000) });
          x.reader.s.subsAt = Date.now(); x.summary.subscribers = out.saved;
        } else x.summary.subsError = 'lista de assinantes vazia';
      } catch (error) { x.summary.subsError = error.message.slice(0, 120); x.reader.s.subsAt = Date.now() - SUBS_MS + 30 * 60 * 1000; }
    }
    writeJson(`fatalfans-${id}.json`, x.reader.s);
  } catch (error) {
    x.summary = { ...(x.summary || {}), error: /Extra inputs are not permitted/.test(error.message) ? 'painel desatualizado: publique a versão nova do Alta Pulse' : error.message, readAt: new Date().toISOString() };
  } finally {
    x.busy = false; pushState();
    if (isPortable()) try { fs.writeFileSync(path.join(calibDir(), `fatalfans-resumo.json`), JSON.stringify({ at: new Date().toISOString(), creator: id, summary: x.summary }, null, 1)); } catch {}
    closeFFView(id); // libera a memória até a próxima rodada
    if (ffTabOpen(id)) scheduleFF(id, EXTRATO_MS);
  }
}
// ---------- CloseFans: Vendas (extrato do mês atual, todas as páginas) ----------
const cfs = new Map(); // creatorId -> { view, reader, summary, timer, busy }
function cfFor(id) {
  if (!cfs.has(id)) cfs.set(id, { view: null, reader: new SalesReader(id, secretFor(), readJson(`closefans-${id}.json`, null), { fanNames: !!state.fan_names_allowed }, 'closefans'), summary: null, timer: null, busy: false });
  return cfs.get(id);
}
function cfView(id) {
  const x = cfFor(id);
  if (x.view && !x.view.webContents.isDestroyed()) return x.view;
  const view = new WebContentsView({ webPreferences: { partition: partitionFor(id), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  view.webContents.setUserAgent(UA, LANG); view.webContents.setAudioMuted(true); view.webContents.setBackgroundThrottling(false);
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.contentView.addChildView(view, 0); view.setBounds(hiddenBounds());
  x.view = view; return view;
}
function closeCFView(id) { const x = cfs.get(id); if (!x) return; if (x.view && !x.view.webContents.isDestroyed()) { win.contentView.removeChildView(x.view); x.view.webContents.close(); } x.view = null; }
function scheduleCF(id, ms) { const x = cfFor(id); clearTimeout(x.timer); x.timer = setTimeout(() => readCF(id).catch(() => {}), ms); }
let cfChain = Promise.resolve();
// FatalFans, CloseFans e OnlyFans dividem uma fila (uma aba oculta por vez renderiza melhor)
function readCF(id, opts = {}) { const p = ffChain.then(() => capped(readCFNow(id, opts))).catch(() => {}); ffChain = p; return p; }
const cfTabOpen = (id) => !!(tabs.get(id) && tabs.get(id).has('closefans'));
async function hasCFSession(id) { try { return (await session.fromPartition(partitionFor(id)).cookies.get({ url: 'https://close.fans' })).length > 0; } catch { return false; } }
async function readCFNow(id, opts = {}) {
  const x = cfFor(id);
  if (!state.user || x.busy) return;
  if (!cfTabOpen(id) && !opts.background) return;
  x.busy = true;
  const diag = (o) => { if (isPortable()) try { fs.mkdirSync(calibDir(), { recursive: true }); fs.writeFileSync(path.join(calibDir(), 'closefans-ultima-leitura.json'), JSON.stringify({ at: new Date().toISOString(), ...o }, null, 1)); } catch {} };
  try {
    x.reader.options.fanNames = !!state.fan_names_allowed;
    const view = cfView(id);
    const run = (a) => runJs(view, CF.script(a), 10000).catch((e) => ({ error: String(e && e.message || e), rows: [] }));
    await new Promise((resolve) => {
      let timer = null;
      const done = () => { clearTimeout(timer); const wc = view.webContents; if (wc && !wc.isDestroyed()) { wc.removeListener('did-finish-load', done); wc.removeListener('did-fail-load', done); } resolve(); };
      view.webContents.once('did-finish-load', done); view.webContents.once('did-fail-load', done);
      view.webContents.loadURL(CF_URL, { userAgent: UA }); timer = setTimeout(done, 25000);
    });
    await sleep(4000);
    let d = await run('read');
    for (let i = 0; i < 10 && !(d.rows || []).length && !d.loggedOut; i++) { await sleep(2000); d = await run('read'); }
    if (d.ok) await grabAvatar(id, view, 'closefans');
    if (!d.ok) { x.summary = { error: d.loggedOut ? 'login' : `sem extrato (${(d.url || '').slice(0, 80)})`, readAt: new Date().toISOString(), rows: 0 }; diag({ summary: x.summary, d: { ...d, rows: undefined } }); return; }
    const all = [...(d.rows || [])]; let pages = 1; const first = { rows: all.length, page: d.page, pages: d.pages, hasNext: d.hasNext, heads: d.heads, count: d.count };
    while (d.hasNext && pages < 60 && (!x.reader.s.backfilled || (d.rows || []).some((r) => !x.reader.known(r)))) {
      const before = d.page; await run('next'); let moved = false;
      for (let w = 0; w < 10; w++) { await sleep(1200); d = await run('read'); if (d.page !== before) { moved = true; break; } }
      if (!moved) break; all.push(...(d.rows || [])); pages += 1;
    }
    const { events, summary } = x.reader.process(all, new Date());
    x.summary = { ...summary, pages, sent: 0 };
    diag({ first, total: all.length, pages, events: events.length, sample: all.slice(0, 3).map((r) => ({ ...r, name: r.name ? '•••' : '' })) });
    if (events.length && state.storage_allowed) {
      const accepted = [];
      for (let i = 0; i < events.length; i += 150) {
        const out = await api('POST', '/extension/observations', { events: events.slice(i, i + 150) });
        for (const r of out.results || []) if (r.ok) accepted.push(r.event_ref);
        const rejected = (out.results || []).filter((r) => !r.ok);
        if (rejected.length) { x.summary.rejected = (x.summary.rejected || 0) + rejected.length; x.summary.lastReject = rejected[0].detail; }
      }
      x.reader.markSent(accepted); x.summary.sent = accepted.length;
      if (all.length) x.reader.s.backfilled = true;
    } else { x.reader.markSent([]); if (!state.storage_allowed) x.summary.dropped = events.length; }
    writeJson(`closefans-${id}.json`, x.reader.s);
  } catch (error) {
    x.summary = { ...(x.summary || {}), error: /Extra inputs are not permitted/.test(error.message) ? 'painel desatualizado: publique a versão nova do Alta Pulse' : error.message, readAt: new Date().toISOString() };
    diag({ summary: x.summary });
  } finally {
    x.busy = false; pushState(); closeCFView(id);
    if (cfTabOpen(id)) scheduleCF(id, EXTRATO_MS);
  }
}
// ---------- OnlyFans: Extratos → Renda (em dólar; rola a lista para carregar o histórico) ----------
const ofs = new Map();
function ofFor(id) {
  if (!ofs.has(id)) ofs.set(id, { view: null, reader: new SalesReader(id, secretFor(), readJson(`onlyfans-${id}.json`, null), { fanNames: !!state.fan_names_allowed, currency: 'USD' }, 'onlyfans'), summary: null, timer: null, busy: false });
  return ofs.get(id);
}
function scheduleOF(id, ms) { const x = ofFor(id); clearTimeout(x.timer); x.timer = setTimeout(() => readOF(id).catch(() => {}), ms); }
let ofChain = Promise.resolve();
function readOF(id, opts = {}) { const p = ffChain.then(() => capped(readOFNow(id, opts))).catch(() => {}); ffChain = p; return p; }
const ofTabOpen = (id) => !!(tabs.get(id) && tabs.get(id).has('onlyfans'));
async function hasOFSession(id) { try { return (await session.fromPartition(partitionFor(id)).cookies.get({ url: 'https://onlyfans.com', name: 'auth_id' })).length > 0; } catch { return false; } }
async function readOFNow(id, opts = {}) {
  const x = ofFor(id);
  if (!state.user || x.busy) return;
  if (!ofTabOpen(id) && !opts.background) return;
  x.busy = true;
  const diag = (o) => { if (isPortable()) try { fs.mkdirSync(calibDir(), { recursive: true }); fs.writeFileSync(path.join(calibDir(), 'onlyfans-ultima-leitura.json'), JSON.stringify({ at: new Date().toISOString(), ...o }, null, 1)); } catch {} };
  let view = null;
  try {
    x.reader.options.fanNames = !!state.fan_names_allowed;
    view = new WebContentsView({ webPreferences: { partition: partitionFor(id), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    view.webContents.setUserAgent(UA, LANG); view.webContents.setAudioMuted(true); view.webContents.setBackgroundThrottling(false);
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.contentView.addChildView(view, 0); view.setBounds(hiddenBounds()); x.view = view;
    const run = (a) => runJs(view, OF.script(a), 10000).catch((e) => ({ error: String(e && e.message || e), rows: [] }));
    await new Promise((resolve) => {
      let timer = null;
      const done = () => { clearTimeout(timer); const wc = view.webContents; if (wc && !wc.isDestroyed()) { wc.removeListener('did-finish-load', done); wc.removeListener('did-fail-load', done); } resolve(); };
      view.webContents.once('did-finish-load', done); view.webContents.once('did-fail-load', done);
      view.webContents.loadURL(OF_URL, { userAgent: UA }); timer = setTimeout(done, 30000);
    });
    await sleep(5000);
    let d = await run('read');
    for (let i = 0; i < 10 && !(d.rows || []).length && !d.loggedOut; i++) { await sleep(2500); d = await run('read'); }
    if (d.ok) await grabAvatar(id, view, 'onlyfans');
    if (!d.ok) { x.summary = { error: d.loggedOut ? 'login' : `sem extrato (${(d.url || '').slice(0, 80)})`, readAt: new Date().toISOString(), rows: 0 }; diag({ summary: x.summary }); return; }
    // primeira vez: rola até ~90 dias (ou a lista parar de crescer); depois: só enquanto aparecer venda nova
    const full = !x.reader.s.backfilled; const limit = Date.now() - 90 * 86400e3; let scrolls = 0;
    const oldest = (rows) => { const t = rows.length ? require('./fatalfans.js').parseWhen(rows[rows.length - 1].when) : null; return t ? t.getTime() : Date.now(); };
    while (scrolls < (full ? 60 : 8) && (full ? oldest(d.rows) > limit : (d.rows || []).some((r) => !x.reader.known(r)))) {
      const before = d.rows.length; await run('more'); let grew = false;
      for (let w = 0; w < 8; w++) { await sleep(1500); d = await run('read'); if ((d.rows || []).length > before) { grew = true; break; } }
      if (!grew) break; scrolls += 1;
    }
    const all = d.rows || [];
    const { events, summary } = x.reader.process(all, new Date());
    x.summary = { ...summary, scrolls, sent: 0, currency: 'USD' };
    diag({ total: all.length, scrolls, events: events.length, sample: all.slice(0, 3).map((r) => ({ ...r, name: r.name ? '•••' : '' })) });
    if (events.length && state.storage_allowed) {
      const accepted = [];
      for (let i = 0; i < events.length; i += 150) {
        const out = await api('POST', '/extension/observations', { events: events.slice(i, i + 150) });
        for (const r of out.results || []) if (r.ok) accepted.push(r.event_ref);
        const rejected = (out.results || []).filter((r) => !r.ok);
        if (rejected.length) { x.summary.rejected = (x.summary.rejected || 0) + rejected.length; x.summary.lastReject = rejected[0].detail; }
      }
      x.reader.markSent(accepted); x.summary.sent = accepted.length;
      if (all.length) x.reader.s.backfilled = true;
    } else { x.reader.markSent([]); if (!state.storage_allowed) x.summary.dropped = events.length; }
    writeJson(`onlyfans-${id}.json`, x.reader.s);
  } catch (error) {
    x.summary = { ...(x.summary || {}), error: /Extra inputs are not permitted/.test(error.message) ? 'painel desatualizado: publique a versão nova do Alta Pulse' : error.message, readAt: new Date().toISOString() };
    diag({ summary: x.summary });
  } finally {
    x.busy = false; pushState();
    if (view && !view.webContents.isDestroyed()) { win.contentView.removeChildView(view); view.webContents.close(); } x.view = null;
    if (ofTabOpen(id)) scheduleOF(id, EXTRATO_MS);
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
  for (const c of state.creators || []) {
    if (ffTabOpen(c.id)) continue;
    if (await hasFFSession(c.id)) await readFF(c.id, { background: true });
  }
  for (const c of state.creators || []) {
    if (cfTabOpen(c.id)) continue;
    if (await hasCFSession(c.id)) await readCF(c.id, { background: true });
  }
  for (const c of state.creators || []) {
    if (ofTabOpen(c.id)) continue;
    if (await hasOFSession(c.id)) await readOF(c.id, { background: true });
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
ipcMain.handle('assist:profile', async () => {
  const id = fan.creatorId; if (!id) throw new Error('Abra a conversa de uma criadora primeiro.');
  try { return await api('GET', `/extension/assist/profile?creator_id=${encodeURIComponent(id)}`); }
  catch (error) { throw new Error(/404|Not Found/i.test(error.message) ? 'O painel ainda não tem a ficha da criadora (publicação pendente).' : error.message); }
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
// ---------- Sugerir resposta (só nas criadoras com a chave ligada na ficha) ----------
// Lê o texto das últimas mensagens da conversa ABERTA, só quando o chatter está nela e o fã falou por último.
// O painel mascara de novo e chama a xAI; a sugestão volta para o cartão do fã. O envio é sempre do chatter.
const READ_MSGS_SCRIPT = String.raw`(() => {
  const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
  const roots = []; (function walk(r, d) { if (d > 6) return; roots.push(r); for (const el of r.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, d + 1); })(document, 0);
  const qs = (sel) => { for (const r of roots) { const e = r.querySelector(sel); if (e) return e; } return null; };
  const name = txt(qs('.vac-room-header .vac-list-name .vac-text-ellipsis') || qs('.vac-room-header .vac-list-name'));
  const cont = qs('.vac-messages-container'); if (!cont) return { name, msgs: [] };
  const msgs = [];
  for (const el of cont.querySelectorAll('.vac-message-wrapper-msg')) {
    const parts = [...el.querySelectorAll('.vac-format-message-wrapper')].filter((x) => !x.closest('.vac-reply-message'));
    let t = parts.map(txt).join(' ').trim();
    const np = el.querySelector('.vac-text-not-paid');
    if (np) t = (t ? t + ' ' : '') + '[mídia paga enviada: ' + txt(np) + ']';
    else if (!t && el.querySelector('.vac-message-files-container, .vac-message-image, video, img')) t = '[mídia]';
    if (!t) continue;
    msgs.push({ ours: el.classList.contains('vac-offset-current'), text: t.slice(0, 1200) });
  }
  return { name, msgs: msgs.slice(-14) };
})()`;
// ---------- Termômetro de venda: lê as últimas mensagens da conversa aberta e dá uma nota (0–100) ----------
// Roda só no computador do chatter: o texto é avaliado aqui e descartado; nada é gravado nem enviado.
// faixas (no cartão): < 20 frio · < 45 morno · < 65 quente · 65+ hora de vender. Um pedido claro do fã já põe em "hora de vender".
const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const HEAT = [
  { k: 'preco', w: 70, why: 'perguntou preço', cat: null, rx: /\b(quanto|valor|preco|pix|custa|como (compro|faco pra (ver|comprar|ter))|ta quanto|qto)\b/ },
  { k: 'nude', w: 65, why: 'pediu pra ver ela pelada', cat: 'foto', rx: /(pelad|\bnua\b|nuazinha|nudes?\b|peitos?\b|seios|bunda|buceta|xota|xereca|tira (a|essa) roupa|sem roupa|mostra (tudo|mais|ai|os|a)|quero (te )?ver (vc|voce|tu|mais|tudo))/ },
  { k: 'acao', w: 65, why: 'quer ver ela em ação', cat: 'video', rx: /(gozando|gozar|se tocando|te tocando|masturb|siririca|squirt|\bvideos?\b|grava(r|ndo|ou)?\b|filma)/ },
  { k: 'dele', w: 65, why: 'quer mostrar o dele', cat: 'avaliacao', rx: /(meu (pau|pinto|cacete|caralho|pirocao|pau duro)|minha (rola|pica|piroca)|ver o meu|avalia(r|cao)?)/ },
  { k: 'custom', w: 65, why: 'pediu algo sob medida', cat: 'personalizado', rx: /(personaliz|com meu nome|fala meu nome|so pra mim|exclusiv|sob medida|do jeito que eu (quero|pedir))/ },
  { k: 'chamada', w: 50, why: 'falou em chamada', cat: 'chamada', rx: /(chamada|ao vivo|\bcam\b|\bcall\b|facetime|video ?chamada)/ },
  { k: 'tesao', w: 20, why: 'está excitado', cat: null, rx: /(\bduro\b|tesao|gostosa|safada|delicia|molhad|excitad|punheta|batendo uma|me deixa (louco|doido))/ },
  { k: 'obedece', w: 15, why: 'se ofereceu pra obedecer', cat: null, rx: /(obedec|faco (o que|tudo que) (vc|voce|tu) (mandar|quiser)|sou (seu|teu)\b|minha (deusa|dona|rainha|mestra)|sim senhora)/ },
];
const COLD = [
  { why: 'achou caro', rx: /(\bcaro\b|muito caro|salgado|nao (tenho|to com) (grana|dinheiro)|sem (grana|dinheiro)|ta puxado)/ },
  { why: 'deixou pra depois', rx: /(\bdepois\b|outro dia|amanha eu|mais tarde|vou ver|vou pensar)/ },
  { why: 'está saindo', rx: /(\btchau\b|vou dormir|boa noite|preciso ir|to indo|falou)/ },
];
function thermoScore(msgs, extra) {
  const extraRx = (extra || []).map((t) => fold(t).trim()).filter((t) => t.length > 1);
  let i = msgs.length - 1; let streak = 0; while (i >= 0 && !msgs[i].ours) { streak += 1; i -= 1; }
  const fanMsgs = msgs.map((m, idx) => ({ ...m, idx })).filter((m) => !m.ours).slice(-8);
  const lastIdx = msgs.length - 1;
  let score = 0; const why = []; const hits = {}; let cat = null; let cold = null;
  for (const m of fanMsgs) {
    const t = fold(m.text); const recent = lastIdx - m.idx <= 3 ? 1 : 0.5;
    for (const h of HEAT) if (h.rx.test(t) && !hits[h.k]) { hits[h.k] = 1; score += h.w * recent; if (!why.includes(h.why)) why.push(h.why); if (h.cat && (!cat || recent === 1)) cat = h.cat; }
    if (extraRx.some((x) => t.includes(x)) && !hits.extra) { hits.extra = 1; score += 20 * recent; why.push('usou um termo da ficha'); }
    if (lastIdx - m.idx <= 2) for (const c of COLD) if (c.rx.test(t) && cold !== 'achou caro') cold = c.why;
  }
  if (streak >= 2) { score += Math.min(15, (streak - 1) * 5); why.push(`${streak} mensagens seguidas`); }
  return { score: Math.round(score), why, cat, cold, hits: Object.keys(hits) };
}
ipcMain.handle('thermo:read', async (_e, { extra } = {}) => {
  const id = fan.creatorId; if (!id || !fan.fanRef) return null;
  const view = views.get(id); if (!view || view.webContents.isDestroyed()) return null;
  const fanAt = fan.fanRef;
  const read = await runJs(view, READ_MSGS_SCRIPT, 4000).catch(() => null);
  if (!read || !read.msgs || fan.fanRef !== fanAt || (fan.name && read.name && read.name !== fan.name)) return null;
  return { ...thermoScore(read.msgs, extra), fanRef: fanAt, n: read.msgs.length, lastOurs: !!(read.msgs.length && read.msgs[read.msgs.length - 1].ours) };
});
ipcMain.handle('assist:prices', async () => {
  if (!fan.creatorId) return { prices: [] };
  return api('GET', `/extension/assist/prices?creator_id=${encodeURIComponent(fan.creatorId)}`).catch(() => ({ prices: [] }));
});
ipcMain.handle('assist:used', async (_e, usageId) => { if (usageId) await api('POST', `/extension/assist/used/${encodeURIComponent(usageId)}`, {}).catch(() => {}); return true; });
ipcMain.handle('assist:suggest', async (_e, { style, level, mode, product, temp } = {}) => {
  const id = fan.creatorId; if (!id || !fan.fanRef) throw new Error('Abra a conversa de um fã primeiro.');
  const view = views.get(id); if (!view || view.webContents.isDestroyed()) throw new Error('Abra a conversa na Privacy.');
  const fanAt = fan.fanRef;
  const read = await runJs(view, READ_MSGS_SCRIPT, 4000).catch(() => null);
  const m = mode === 'followup' ? 'followup' : 'reply';
  if (!read || !read.msgs || (m === 'reply' && !read.msgs.length)) throw new Error('Não consegui ler a conversa. Tente de novo em alguns segundos.');
  if (fan.fanRef !== fanAt || (fan.name && read.name && read.name !== fan.name)) throw new Error('A conversa mudou.');
  if (m === 'reply' && read.msgs[read.msgs.length - 1].ours) return { skip: true };
  const body = { creator_id: id, fan_ref: fanAt, messages: read.msgs, style: style === 'vendedora' ? 'vendedora' : 'normal', mode: m };
  if (['leve', 'picante', 'explicito'].includes(level)) body.level = level;
  if (product) body.product = String(product).slice(0, 80);
  if (Number.isFinite(temp)) body.temp = Math.max(0, Math.min(100, Math.round(temp)));
  const out = await api('POST', '/extension/assist/suggest', body);
  const c = assistCache.get(id); if (c && out && out.remaining != null) c.data = { ...c.data, remaining: out.remaining };
  return { ...out, fanRef: fanAt };
});
// perfil do fã (Servo, Cuck, Baunilha…): o chatter classifica; vale para a equipe toda e orienta o Sugerir resposta
ipcMain.handle('fanseg:get', async () => {
  if (!fan.creatorId || !fan.fanRef) return { segment: '', fanRef: null };
  const r = await api('GET', `/extension/fan/segment?creator_id=${encodeURIComponent(fan.creatorId)}&fan_ref=${encodeURIComponent(fan.fanRef)}`).catch(() => ({ segment: '' }));
  return { ...r, fanRef: fan.fanRef };
});
ipcMain.handle('fanseg:set', async (_e, segment) => {
  if (!fan.creatorId || !fan.fanRef) throw new Error('Abra a conversa de um fã primeiro.');
  const r = await api('PUT', '/extension/fan/segment', { creator_id: fan.creatorId, fan_ref: fan.fanRef, segment: String(segment || '') });
  return { ...r, fanRef: fan.fanRef };
});
// ---------- Plantão (copiloto): fila de abordagens de quem tem a permissão; abrir a conversa e preencher o texto — o envio é da pessoa ----------
const plantao = plantaoApp.create({ api, log: (...a) => console.log('[plantao]', ...a), getState: () => state, roomKey: (id, name) => readerFor(id).reader.roomKey(name) });
ipcMain.handle('plantao:queue', async () => { if (Date.now() - (plantao.fetchedAt || 0) > 120000) await plantao.fetchConfigs(); return plantao.queue(); });
ipcMain.handle('plantao:refresh', async () => { await plantao.fetchConfigs(); return plantao.queue(); });
ipcMain.handle('plantao:prepare', async (_e, { creator_id, fan_ref, name, rid, text }) => {
  const t = String(text || '').slice(0, 400); if (!t) return { ok: false, reason: 'sem texto' };
  const r = await openConversation(creator_id, 'privacy', rid || null, name, fan_ref).catch((e) => ({ found: false, how: e.message }));
  if (!r || !['ja', 'ok', 'clicou'].includes(r.how)) return { ok: false, reason: (r && r.how) || 'não abriu' };
  await sleep(1200);
  const view = views.get(creator_id); let filled = false;
  if (view && !view.webContents.isDestroyed()) { try { filled = !!(await runJs(view, FILL_SCRIPT(t), 4000)); if (filled) view.webContents.focus(); } catch {} }
  if (filled) plantao.prepared(creator_id, fan_ref, name, t);
  return { ok: filled, reason: filled ? null : 'caixa de mensagem não encontrada' };
});
ipcMain.handle('plantao:cancel', (_e, { creator_id, fan_ref }) => { plantao.cancel(creator_id, fan_ref); return plantao.queue(); });
// (módulo autônomo removido — o plantão funciona só como copiloto: a pessoa é quem envia)
ipcMain.handle('fan:note:add', async (_e, text) => {
  if (!fan.creatorId || !fan.fanRef) throw new Error('Abra uma conversa primeiro.');
  await api('POST', '/extension/fan/notes', { creator_id: fan.creatorId, fan_ref: fan.fanRef, text: String(text || '').slice(0, 300) });
  await loadFanCard(true); return true;
});
// anotações da criadora (no painel, com autor e hora)
// zoom (botões − % + no menu ⋮) e tela cheia
ipcMain.handle('ui:focus', () => { try { if (sidebar && !sidebar.webContents.isDestroyed()) sidebar.webContents.focus(); } catch {} return true; });
ipcMain.handle('zoom:change', (_e, dir) => { const p = activeId && activeTab.get(activeId); if (!p) throw new Error('Abra uma criadora para ajustar o zoom.'); changeZoom(p, dir); return publicState(); });
ipcMain.handle('win:fullscreen', () => { if (win) { win.setFullScreen(!win.isFullScreen()); setTimeout(() => { layout(); pushState(); }, 300); } return true; });
ipcMain.handle('cnotes:list', async (_e, creatorId) => api('GET', `/extension/creators/${encodeURIComponent(creatorId)}/notes`));
ipcMain.handle('cnotes:add', async (_e, { creatorId, text, pinned }) => { const r = await api('POST', `/extension/creators/${encodeURIComponent(creatorId)}/notes`, { text: String(text || '').slice(0, 1000), pinned: !!pinned }); refreshState(); return r; });
ipcMain.handle('cnotes:del', async (_e, noteId) => { await api('DELETE', `/extension/creator-notes/${encodeURIComponent(noteId)}`); refreshState(); return true; });
ipcMain.handle('cnotes:pin', async (_e, { noteId, pinned }) => { await api('PATCH', `/extension/creator-notes/${encodeURIComponent(noteId)}`, { pinned: !!pinned }); return true; });
ipcMain.handle('fan:note:del', async (_e, noteId) => { await api('DELETE', `/extension/fan/notes/${encodeURIComponent(noteId)}`); await loadFanCard(true); return true; });
ipcMain.handle('fan:contacted', async (_e, taskId) => { await api('POST', `/extension/fan-tasks/${encodeURIComponent(taskId)}/contacted`, {}); await loadTasks(); await loadFanCard(true); pushState(); return true; });
ipcMain.handle('task:open', async (_e, taskId) => {
  const t = myTasks.find((x) => x.id === taskId); if (!t) throw new Error('Tarefa não encontrada.');
  openProfile(t.creator_id, 'privacy');
  const view = views.get(t.creator_id); const cid = fanCids[t.creator_id] && fanCids[t.creator_id][t.fan_ref];
  if (view) view.webContents.loadURL(cid ? `https://privacy.com.br/chat?cid=${encodeURIComponent(cid)}` : 'https://privacy.com.br/chat', { userAgent: UA });
  return { found: !!cid, name: t.fan_name };
});
ipcMain.handle('extrato:read', async (_e, id) => { await readExtrato(id, { background: true }); if (ffTabOpen(id) || await hasFFSession(id)) await readFF(id, { background: true }); if (cfTabOpen(id) || await hasCFSession(id)) await readCF(id, { background: true }); if (ofTabOpen(id) || await hasOFSession(id)) await readOF(id, { background: true }); return publicState(); });
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
  // presença no perfil: quais criadoras estão abertas aqui e qual está na tela (os outros veem "Fulano está neste perfil agora")
  try { await api('POST', '/extension/presence', { open: [...tabs.keys()], active: activeId || null }); } catch {}
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
// recarrega a página aberta e só responde quando ela termina de carregar (o ↻ da lateral gira até lá; no máximo 15 s)
ipcMain.handle('profile:reload-active', () => new Promise((resolve) => {
  const v = activeId && currentView(activeId);
  if (!v || v.webContents.isDestroyed()) return resolve(false);
  const wc = v.webContents; let done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(t); wc.removeListener('did-stop-loading', finish); resolve(true); };
  const t = setTimeout(finish, 15000);
  wc.once('did-stop-loading', finish);
  wc.reload(); watchBlank(v);
}));
ipcMain.handle('me:avatar', async (_e, image) => {
  if (image) await api('PUT', '/extension/avatar', { image }); else await api('DELETE', '/extension/avatar');
  await refreshState(); return publicState();
});
ipcMain.handle('state:snapshot', () => publicState());

ipcMain.handle('profile:open', (_e, id, platform) => { openProfile(id, platform || 'privacy'); return publicState(); });
// cofre: pede login/senha ao painel (auditado) e preenche o formulário da plataforma aberta. A senha
// não passa pela lateral: vai do painel para o processo principal e daí para a página, e é descartada.
// ---------- cofre: entrar com um clique ----------
// Preenche login e senha na tela de login da plataforma (a senha vem do painel, auditada, e é descartada).
const entering = new Map(); // creatorId -> plataforma em que está entrando agora (a lateral mostra "Entrando…")
const vaultErrors = new Map(); // creatorId -> { platform, reason } do último Entrar que não passou da tela de login
function setLogin(id, platform, on) {
  const list = (loginPages.get(id) || []).filter((p) => p !== platform); if (on) list.push(platform);
  if (list.length) loginPages.set(id, list); else loginPages.delete(id);
}
async function probeLogin(view) { try { return !!(await runJs(view, LOGIN_PROBE, 2500)); } catch { return false; } }
// sonda logo depois de carregar (o chip fica verde em ~1 s, sem esperar a varredura de 10 s)
function probeSoon(creatorId, platform, view) {
  setTimeout(async () => { if (view.webContents.isDestroyed()) return; const was = (loginPages.get(creatorId) || []).includes(platform); const on = await probeLogin(view); if (on !== was) { setLogin(creatorId, platform, on); pushState(); } }, 700);
}
// estado da tela de login depois do envio: ainda tem campo de senha? está vazio (a página recusou e limpou)?
const LOGIN_STATE = String.raw`(() => { const p = [...document.querySelectorAll('input[type="password"]')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); const err = [...document.querySelectorAll('[role="alert"], .error, .alert, [class*="error" i], [class*="erro" i]')].map((e) => (e.textContent || '').trim()).filter((t) => t && t.length < 160).slice(0, 3); return { login: !!p, empty: !!p && !p.value, url: location.href.split('?')[0], err, click: window.__altaLastClick || null }; })()`;
async function loginState(view) { try { return await runJs(view, LOGIN_STATE, 2500); } catch { return null; } }
// diagnóstico de cada "Entrar" vai para o registro de atividade do painel (o gestor enxerga o que aconteceu no PC do chatter)
function reportVault(creatorId, platform, info) { api('POST', '/extension/vault-result', { creator_id: creatorId, platform, ...info }).catch(() => {}); }
async function vaultFill(creatorId, platform, view) {
  const cred = credentials.find((c) => c.creator_id === creatorId && c.platform === platform);
  if (!cred) throw new Error(`Não há acesso salvo de ${PLATFORMS[platform].label} para esta criadora. Peça ao gestor para cadastrar no painel.`);
  const t0 = Date.now();
  const data = await api('POST', `/extension/credentials/${cred.id}/use`, {});
  const tApi = Date.now() - t0;
  let result, second = null;
  const attempt = async (mode) => {
    let r;
    try { r = await runJs(view, fillScript(data.login, data.password, mode), 4000); } catch { r = { ok: false, retry: true, reason: 'carregando o login' }; }
    // formulário atrás de um botão "Entrar" (CloseFans) ou em outra página (FatalFans): espera aparecer e preenche
    for (let i = 0; i < 16 && r && r.retry; i++) {
      await sleep(600);
      try { r = await runJs(view, fillScript(data.login, data.password, mode), 4000); } catch { r = { ok: false, retry: true, reason: 'carregando o login' }; }
      if (!r) r = { ok: false, retry: true, reason: 'carregando o login' };
    }
    return r;
  };
  try {
    result = await attempt('click');
    if (result && result.ok) {
      // a página recusou e devolveu o formulário vazio (ou o clique não enviou)? tenta de novo com Enter no campo de senha
      let st = null;
      for (let i = 0; i < 9; i++) { await sleep(1000); if (view.webContents.isDestroyed()) break; st = await loginState(view); if (!st || !st.login) break; }
      if (st && st.login && !view.webContents.isDestroyed()) {
        second = { before: st, result: await attempt('enter') };
        for (let i = 0; i < 6; i++) { await sleep(1000); if (view.webContents.isDestroyed()) break; second.after = await loginState(view); if (!second.after || !second.after.login) break; }
      }
    }
  } finally { data.password = null; }
  const size = (() => { try { const b = view.getBounds(); return [b.width, b.height]; } catch { return null; } })();
  reportVault(creatorId, platform, { ms_painel: tApi, ms_total: Date.now() - t0, result, second, view: size, screen: (() => { try { const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize; return [width, height]; } catch { return null; } })(), app: app.getVersion() });
  if (isPortable()) try { fs.mkdirSync(calibDir(), { recursive: true }); fs.writeFileSync(path.join(calibDir(), 'cofre-ultimo-entrar.json'), JSON.stringify({ at: new Date().toISOString(), creator: creatorId.slice(0, 6), platform, url: view.webContents.getURL().split('?')[0], ms_painel: tApi, ms_total: Date.now() - t0, result, second }, null, 2)); } catch {}
  if (!result || !result.ok) throw new Error('Não encontrei o formulário de login nesta tela (' + ((result && result.reason) || 'sem resposta') + ').');
  return result;
}
// depois de enviar: confere se saiu da tela de login; se não, avisa o motivo provável e libera o botão de novo
async function vaultCheck(creatorId, platform, view) {
  for (let i = 0; i < 12; i++) { await sleep(700); if (view.webContents.isDestroyed()) return; if (!(await probeLogin(view))) { setLogin(creatorId, platform, false); vaultErrors.delete(creatorId); pushState(); return; } }
  vaultErrors.set(creatorId, { platform, reason: 'continua na tela de login: senha recusada, verificação ou código pedido pela plataforma' });
  setLogin(creatorId, platform, true); pushState();
  if (sidebar) sidebar.webContents.send('toast', `${PLATFORMS[platform].label}: ainda na tela de login. Veja se a plataforma pediu código ou verificação.`);
}
// um clique: mostra a plataforma; se a página carregar na tela de login e houver acesso salvo, entra
ipcMain.handle('vault:enter', async (_e, creatorId, platformArg) => {
  const t = tabs.get(creatorId); const platform = platformArg || activeTab.get(creatorId) || 'privacy';
  const view = t && t.get(platform); if (!view) return { ok: false, reason: 'aba fechada' };
  if (!credentials.some((c) => c.creator_id === creatorId && c.platform === platform)) return { ok: false, reason: 'sem acesso salvo' };
  if (entering.has(creatorId)) return { ok: false, reason: 'já entrando' };
  // página pronta: uma sonda só (logada = só mostra, sem esperar). Carregando (aba recém-aberta): espera até ~8 s
  const fresh = view.webContents.isLoading() || !view.webContents.getURL();
  let login = false;
  for (let i = 0, after = 0; i < 60; i++) {
    if (view.webContents.isDestroyed()) return { ok: false };
    if (!view.webContents.isLoading()) { login = await probeLogin(view); after += 1; if (login || !fresh || after >= 15) break; }
    await sleep(200);
  }
  if (!login) { setLogin(creatorId, platform, false); pushState(); return { ok: true, already: true }; }
  setLogin(creatorId, platform, true);
  entering.set(creatorId, platform); pushState();
  try {
    const result = await vaultFill(creatorId, platform, view);
    vaultCheck(creatorId, platform, view).catch(() => {});
    return { ok: true, clicked: result.clicked, user: result.user };
  } catch (error) {
    vaultErrors.set(creatorId, { platform, reason: error.message });
    throw error;
  } finally { entering.delete(creatorId); pushState(); }
});
// compatibilidade (menu ⋮ "Entrar com o acesso salvo")
ipcMain.handle('vault:use', async (_e, creatorId, platformArg) => {
  const t = tabs.get(creatorId); const platform = platformArg || activeTab.get(creatorId);
  const view = t && t.get(platform); if (!view) throw new Error('Abra a criadora primeiro.');
  const result = await vaultFill(creatorId, platform, view);
  vaultCheck(creatorId, platform, view).catch(() => {});
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
  const view = currentView(id) || views.get(id);
  if (!view) throw new Error('Abra a criadora primeiro.');
  const url = view.webContents.getURL();
  const platform = platformOf(url);
  if (!platform || !['privacy', 'fatalfans', 'closefans', 'onlyfans'].includes(platform)) throw new Error('Abra a plataforma da criadora antes de capturar.');
  const outline = await view.webContents.executeJavaScript(CALIBRATION_SCRIPT, true);
  if (!outline || outline.length < 200) throw new Error('A tela ainda não carregou. Espere aparecerem as mensagens e tente de novo.');
  // cópia local (mesmo conteúdo mascarado) para análise sem depender do banco do painel
  const dir = calibDir(); fs.mkdirSync(dir, { recursive: true }); // fora do pacote (asar é só leitura)
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
  fs.writeFileSync(file, `<!-- ${url} -->\n${outline}`);
  let sent = true;
  try { await api('POST', '/extension/calibration', { platform, url_path: new URL(url).pathname.slice(0, 300), outline }); } catch { sent = false; }
  return { ok: true, size: outline.length, file, sent };
});

ipcMain.handle('shift:start', async (_e, creatorId) => { await api('POST', '/extension/shifts', { creator_id: creatorId }); return refreshState().then(publicState); });
ipcMain.handle('shift:action', async (_e, { shiftId, action }) => { await api('POST', `/extension/shifts/${shiftId}/action`, { action }); return refreshState().then(publicState); });

ipcMain.handle('local:setCreator', async (_e, { id, patch }) => {
  if ('groups' in patch) patch = { ...patch, group: patch.groups[0] || '' };
  local.creators[id] = { ...(local.creators[id] || {}), ...patch }; saveLocal(); pushState();
  const meta = {};
  if ('groups' in patch) meta.groups = patch.groups.map(groupName).filter(Boolean);
  else if ('group' in patch) meta.group = groupName(patch.group);
  if ('tag' in patch) meta.tag = patch.tag || '';
  if ('notes' in patch) meta.notes = patch.notes || '';
  if (Object.keys(meta).length && token) {
    try { await api('PATCH', `/extension/creators/${id}/meta`, meta); }
    catch (error) { if (sidebar) sidebar.webContents.send('toast', /404|Not Found/i.test(error.message) ? 'Salvo só neste computador (painel ainda sem sincronização).' : `Salvo aqui, mas o painel recusou: ${error.message}`); }
  }
  return local;
});
// ordem das criadoras (arrastar ou setas): salva no painel, por usuário; vale em qualquer computador
ipcMain.handle('order:set', async (_e, order) => {
  if (!state.user || !Array.isArray(order)) return false;
  state.user = { ...state.user, creator_order: order }; local.order = order; saveLocal(); pushState();
  try { const out = await api('PUT', '/extension/me/order', { order }); state.user.creator_order = out.creator_order; }
  catch (error) { toast(/404|Not Found/i.test(error.message) ? 'Ordem salva só neste computador (painel ainda sem essa opção).' : `Ordem salva aqui, mas o painel recusou: ${error.message}`); }
  return true;
});
ipcMain.handle('local:setGroups', async (_e, groups) => {
  const renamed = groups.filter((g) => { const old = local.groups.find((x) => x.id === g.id); return old && old.name !== g.name; });
  // grupo excluído: some das criadoras no mesmo passo (e do painel), para não voltar na próxima sincronização
  const removed = local.groups.filter((g) => !groups.some((x) => x.id === g.id)).map((g) => g.id);
  local.groups = groups;
  const touched = [];
  for (const [id, l] of Object.entries(local.creators)) { const gs = l.groups || (l.group ? [l.group] : []); if (gs.some((g) => removed.includes(g))) { const left = gs.filter((g) => !removed.includes(g)); local.creators[id] = { ...l, groups: left, group: left[0] || '' }; touched.push(id); } }
  saveLocal(); pushState();
  for (const id of touched) if (token) { try { await api('PATCH', `/extension/creators/${id}/meta`, { groups: (local.creators[id].groups || []).map(groupName).filter(Boolean) }); } catch {} }
  const groupsOfLocal = (l) => l.groups || (l.group ? [l.group] : []);
  for (const g of renamed) for (const [id, l] of Object.entries(local.creators)) if (groupsOfLocal(l).includes(g.id) && token) { try { await api('PATCH', `/extension/creators/${id}/meta`, { groups: groupsOfLocal(l).map(groupName).filter(Boolean) }); } catch {} }
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
app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  const link = (argv || []).find((a) => /^altapulse:\/\//i.test(a)); if (link) handleDeepLink(link);
});
// registra o endereço altapulse:// deste app (botão "Abrir no app" do painel)
try { if (app.isPackaged) app.setAsDefaultProtocolClient('altapulse'); else app.setAsDefaultProtocolClient('altapulse', process.execPath, [require('path').resolve(process.argv[1] || '.')]); } catch {}
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
  urlView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.contentView.addChildView(urlView);
  urlView.webContents.loadFile(path.join(__dirname, 'ui', 'urlbar.html'));
  urlView.webContents.on('did-finish-load', pushUrl);
  urlView.setVisible(false);
  // Ctrl +/−/0 com o foco na lateral ou no cartão do fã: ajusta a página aberta (a lateral não muda de tamanho)
  for (const ui of [sidebar, fanView]) ui.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const k = input.key; const dir = k === '=' || k === '+' ? 'in' : k === '-' ? 'out' : k === '0' ? 'reset' : null;
    if (!dir) return; event.preventDefault(); const p = activeId && activeTab.get(activeId); if (p) changeZoom(p, dir);
  });
  for (const ui of [sidebar, fanView]) ui.webContents.on('zoom-changed', () => ui.webContents.setZoomFactor(1));
  win.on('resize', layout);
  layout();

  token = readToken();
  await refreshState();
  restoreOpenTabs(); startVigia();
  setupAutoUpdate();
  setInterval(refreshState, STATE_REFRESH_MS);
  setInterval(checkShiftClock, 15000); setTimeout(checkShiftClock, 5000);
  setInterval(() => { if (activeId && ['onlyfans', 'fatalfans'].includes(activeTab.get(activeId))) quickFanOF(activeId).catch(() => {}); }, 60000);
  setInterval(() => sendDiag(false), 60000); setTimeout(() => sendDiag(true), 20000);
  setInterval(heartbeats, HEARTBEAT_MS);
  if (pendingLink) setTimeout(() => { handleDeepLink(pendingLink); pendingLink = null; }, 8000); // app aberto pelo link do painel
  setInterval(() => loadOpportunities().catch(() => {}), 60000); setInterval(() => radarFatalFans().catch(() => {}), 90000); setTimeout(() => loadOpportunities().catch(() => {}), 8000);
  setInterval(readAll, READ_MS);
  setTimeout(() => plantao.fetchConfigs().catch(() => {}), 12000); setInterval(() => plantao.fetchConfigs().catch(() => {}), 5 * 60000);
});

app.on('window-all-closed', () => app.quit());
// clique em qualquer outra área (aba da plataforma, cartão do fã): fecha os menus abertos na lateral
// fecha os menus da lateral quando a pessoa CLICA numa página; o evento 'focus' não serve porque uma página
// carregando rouba o foco sozinha e fechava o menu logo depois de abrir
app.on('web-contents-created', (_e, wc) => { wc.on('before-mouse-event', (_ev, m) => { if (m && m.type === 'mouseDown' && (!sidebar || wc !== sidebar.webContents)) hideSidebarMenus(); }); });

// ---------- atualização automática (instalador) ----------
// O app instalado pelo AltaPulse-Setup.exe busca versões novas nas releases do GitHub do projeto
// (electron-updater). Baixa em silêncio e instala ao fechar o app; a lateral avisa quando está pronta.
// Versão sem instalador (.zip): não tem como se atualizar sozinha; avisa na lateral quando sair versão nova.
const isPortable = () => app.isPackaged && !fs.existsSync(path.join(path.dirname(process.execPath), 'Uninstall Alta Pulse.exe'));
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

// atualização rápida (sem instalador): baixa só o app.asar novo do painel para um arquivo NOVO e aponta o carregador
// para ele. Não roda nenhum .exe novo, então o Windows/antivírus não bloqueia e ninguém precisa reinstalar.
let quickBusy = null;
async function downloadQuick() {
  if (quickBusy) return quickBusy;
  quickBusy = (async () => {
    const ofs = require('original-fs'); const crypto = require('crypto');
    const r = await fetch(`${config.origin}/api/desktop/release`); const d = await r.json();
    if (!d.asar || d.asar.electron !== process.versions.electron) throw new Error('Esta atualização precisa do pacote completo. Use o download.');
    const name = `app-${String(d.asar.version).replace(/[^\d.]/g, '')}.asar`;
    try { const cur = JSON.parse(ofs.readFileSync(path.join(process.resourcesPath, 'alta-atual.json'), 'utf8')); if (cur.file === name && ofs.existsSync(path.join(process.resourcesPath, name))) return { version: d.asar.version, ready: true }; } catch {}
    const res = await fetch(`${config.origin}/api/desktop/asar`); if (!res.ok) throw new Error(`Painel respondeu ${res.status}.`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (d.asar.sha512 && crypto.createHash('sha512').update(buf).digest('base64') !== d.asar.sha512) throw new Error('O arquivo baixado veio corrompido. Tente de novo.');
    ofs.writeFileSync(path.join(process.resourcesPath, name + '.tmp'), buf);
    try { ofs.unlinkSync(path.join(process.resourcesPath, name)); } catch {}
    ofs.renameSync(path.join(process.resourcesPath, name + '.tmp'), path.join(process.resourcesPath, name));
    ofs.writeFileSync(path.join(process.resourcesPath, 'alta-atual.json'), JSON.stringify({ file: name, at: new Date().toISOString() }));
    try { fs.appendFileSync(path.join(dataDir(), 'atualizacao.log'), `${new Date().toISOString()} baixada ${d.asar.version} em ${name}\n`); } catch {}
    return { version: d.asar.version, ready: true };
  })().finally(() => { quickBusy = null; });
  return quickBusy;
}
ipcMain.handle('portable:update', async () => {
  await downloadQuick();
  setTimeout(() => { app.relaunch(); app.exit(0); }, 500);
  return true;
});
// limpa versões baixadas antigas (as que não estão em uso); falha em silêncio se algum arquivo estiver travado
function cleanOldUpdates() {
  try {
    const ofs = require('original-fs'); const keep = path.basename((global.altaLoader && global.altaLoader.dir) || '');
    // nunca apaga a versão apontada em alta-atual.json nem uma versão mais nova que a que está rodando
    // (antes, uma janela antiga podia apagar a atualização recém-baixada e o app reabria na versão velha)
    let pointed = ''; try { pointed = path.basename(JSON.parse(ofs.readFileSync(path.join(process.resourcesPath, 'alta-atual.json'), 'utf8')).file || ''); } catch {}
    const ver = (f) => (f.match(/^app-([\d.]+)\.asar/) || [])[1] || '0';
    const gt = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
    for (const f of ofs.readdirSync(process.resourcesPath)) {
      if (!/^app-[\d.]+\.asar(\.tmp)?$/.test(f) || f === keep || f === pointed || /\.tmp$/.test(f) || gt(ver(f), app.getVersion())) continue;
      try { ofs.unlinkSync(path.join(process.resourcesPath, f)); } catch {}
    }
    for (const f of ['app.asar.novo', 'app.asar.anterior', 'atualizar-alta-pulse.bat']) { try { ofs.unlinkSync(path.join(process.resourcesPath, f)); } catch {} }
  } catch {}
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;
  setTimeout(cleanOldUpdates, 30000);
  // 1º caminho (todos, com ou sem instalador): atualização rápida em segundo plano, sem .exe novo.
  // Fica pronta e vale na próxima vez que abrir; a lateral oferece "Reiniciar agora".
  let electronUpdater = null;
  const check = async () => {
    try {
      const r = await fetch(`${config.origin}/api/desktop/release`); const d = await r.json();
      if (!d || !d.version || !newer(d.version, app.getVersion())) return;
      const quick = !!(d.asar && d.asar.version === d.version && d.asar.electron && d.asar.electron === process.versions.electron);
      if (quick) {
        const q = await downloadQuick().catch(() => null);
        if (q && sidebar && !sidebar.webContents.isDestroyed()) sidebar.webContents.send('portable-update', { version: d.version, url: `${config.origin}/instalar`, quick: true, ready: true });
        return;
      }
      // mudou a versão do Electron (raro): precisa do pacote completo
      if (isPortable()) { if (sidebar && !sidebar.webContents.isDestroyed()) sidebar.webContents.send('portable-update', { version: d.version, url: `${config.origin}/instalar`, quick: false }); return; }
      if (!electronUpdater) {
        try { ({ autoUpdater: electronUpdater } = require('electron-updater')); } catch { return; }
        electronUpdater.autoDownload = true; electronUpdater.autoInstallOnAppQuit = true;
        electronUpdater.on('update-downloaded', (info) => { if (sidebar && !sidebar.webContents.isDestroyed()) sidebar.webContents.send('toast', `Atualização ${info.version} pronta: será instalada quando você fechar o Alta Pulse.`); });
        electronUpdater.on('error', () => {});
      }
      electronUpdater.checkForUpdates().catch(() => {});
    } catch {}
  };
  setTimeout(check, 15000); setInterval(check, 60 * 60 * 1000);
}
