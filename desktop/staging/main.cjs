const { app, BrowserWindow, ipcMain, session, Menu, dialog, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { allowedUrl } = require('./policy.cjs');
const { CreatorBrowser } = require('./browser.cjs');
const config = require('./config.json');
if (!allowedUrl(config.app_url, [config.app_url]) || !allowedUrl(config.privacy_url, config.privacy_origins)) throw new Error('Configuração inválida.');
app.setName('Alta Core');
if (!app.requestSingleInstanceLock()) app.quit();
let window, browser;
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on('certificate-error', (event, _wc, _url, _error, _certificate, callback) => { event.preventDefault(); callback(false); });
app.on('web-contents-created', (_event, contents) => contents.on('will-attach-webview', event => event.preventDefault()));

app.whenReady().then(async () => {
  app.setAppUserModelId('br.com.altaagency.core');
  const machineFile = path.join(app.getPath('userData'), 'machine.json');
  let machineId;
  try { machineId = JSON.parse(fs.readFileSync(machineFile, 'utf8')).id; } catch { /* first run */ }
  if (!/^[a-f0-9-]{36}$/.test(machineId || '')) {
    machineId = crypto.randomUUID(); fs.mkdirSync(path.dirname(machineFile), { recursive: true });
    fs.writeFileSync(machineFile, JSON.stringify({ id: machineId }), { mode: 0o600 });
  }
  const control = session.fromPartition('persist:alta-control');
  control.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  const icon = nativeImage.createFromPath(path.join(__dirname, 'brand/favicon.png'));
  window = new BrowserWindow({ width: 1460, height: 940, minWidth: 1050, minHeight: 720, title: 'Alta Core', icon,
    backgroundColor: '#111113', autoHideMenuBar: true, webPreferences: { partition: 'persist:alta-control',
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, devTools: false, webviewTag: false, navigateOnDragDrop: false } });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Alta Core', submenu: [{ label: 'Sobre o Alta Core', click: () => dialog.showMessageBox(window, { type: 'info', title: 'Alta Core', message: `Alta Core ${config.version}`, detail: 'Alta Agency · Perfis locais isolados\nLogin da Privacy necessário em cada computador.\nSem sincronização de sessões ou leitura automática nesta versão.\nElectron/Chromium — licenças incluídas na instalação.' }) }, { type: 'separator' }, { role: 'quit', label: 'Sair' }] },
    { label: 'Editar', submenu: [{ role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' }, { role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' }] }
  ]));
  browser = new CreatorBrowser(window, control, config, machineId);
  const trusted = event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !allowedUrl(event.senderFrame.url, [config.app_url])) throw new Error('Origem não autorizada.');
  };
  const handle = (name, fn) => ipcMain.handle(name, async (event, payload) => {
    try { trusted(event); return await fn(payload); } catch (error) { return { error: error.message }; }
  });
  handle('alta:info', () => ({ version: config.version, machine_id: machineId, platform: process.platform, session_model: 'per_machine' }));
  handle('alta:authorize', ticket => browser.authorize(String(ticket)));
  handle('alta:register', () => browser.api('POST', '/desktop/devices/register', { machine_id: machineId, name: os.hostname().slice(0, 80), version: config.version }));
  handle('alta:open', async creatorId => {
    if (new URL(window.webContents.getURL()).pathname !== `/navegador/${creatorId}`) throw new Error('Abra a página da criadora antes de iniciar o navegador.');
    return browser.open(creatorId);
  });
  handle('alta:close', () => browser.close());
  handle('alta:navigate', action => { if (!['back', 'forward', 'reload', 'home'].includes(action)) throw new Error('Ação inválida.'); return browser.navigate(action); });
  ipcMain.on('alta:layout', (event, rect) => { try { trusted(event); browser.layout(rect); } catch { /* denied */ } });
  window.webContents.on('will-navigate', (event, url) => {
    browser.close().catch(() => {});
    if (!allowedUrl(url, [config.app_url])) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => { if (!allowedUrl(url, [config.app_url])) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('render-process-gone', () => browser.close().catch(() => {}));
  window.webContents.on('did-fail-load', (_event, code, _desc, _url, mainFrame) => {
    if (mainFrame && code !== -3) dialog.showMessageBox(window, { type: 'warning', title: 'Conexão Alta Core', message: 'Não foi possível abrir o painel.', detail: 'Verifique sua internet. O aplicativo precisa estar conectado para validar os acessos.', buttons: ['Tentar novamente', 'Fechar'] }).then(r => r.response === 0 ? window.loadURL(config.app_url).catch(() => {}) : window.close());
  });
  let closing = false;
  window.on('close', event => {
    if (closing) return;
    event.preventDefault(); closing = true;
    browser.close().finally(() => { window.destroy(); app.quit(); });
  });
  await window.loadURL(config.app_url).catch(() => {});
});
app.on('window-all-closed', () => app.quit());