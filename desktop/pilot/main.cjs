const { app, BrowserWindow, ipcMain, session, Menu, dialog, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { allowedUrl } = require('./policy.cjs');
const { ChromePilotBrowser } = require('./chrome-browser.cjs');
const config = require('./config.json');
if (!allowedUrl(config.app_url, [config.app_url])) throw new Error('Origem Alta Pulse inválida.');
app.setName('Alta Pulse Chrome Pilot');
app.setPath('userData', path.join(app.getPath('appData'), 'Alta Pulse Chrome Pilot'));
let window, browser;
const exclusive = app.requestSingleInstanceLock();
if (!exclusive) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.on('certificate-error', (event, _wc, _url, _error, _certificate, cb) => { event.preventDefault(); cb(false); });
  app.on('web-contents-created', (_event, contents) => contents.on('will-attach-webview', event => event.preventDefault()));
  app.whenReady().then(async () => {
    app.setAppUserModelId('br.com.altaagency.pulse.chrome-pilot');
    const machineFile = path.join(app.getPath('userData'), 'machine.json');
    let machineId;
    try { machineId = JSON.parse(fs.readFileSync(machineFile, 'utf8')).id; } catch { /* new isolated pilot */ }
    if (!/^[a-f0-9-]{36}$/.test(machineId || '')) {
      machineId = crypto.randomUUID(); fs.mkdirSync(path.dirname(machineFile), { recursive: true });
      fs.writeFileSync(machineFile, JSON.stringify({ id: machineId }), { mode: 0o600 });
    }
    const control = session.fromPartition('persist:alta-pilot-control');
    control.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    window = new BrowserWindow({ width: 1460, height: 940, minWidth: 1100, minHeight: 760,
      title: 'Alta Pulse — Piloto Chrome', backgroundColor: '#111113', autoHideMenuBar: true,
      icon: nativeImage.createFromPath(path.join(__dirname, 'brand/favicon.png')),
      webPreferences: { partition: 'persist:alta-pilot-control', preload: path.join(__dirname, 'preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false, webviewTag: false } });
    browser = new ChromePilotBrowser(window, control, config, machineId, process.resourcesPath);
    const trusted = event => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !allowedUrl(event.senderFrame.url, [config.app_url])) throw new Error('Origem não autorizada.');
    };
    const handle = (channel, callback) => ipcMain.handle(channel, async (event, body) => {
      try { trusted(event); return await callback(body); } catch (error) { return { error: error.message }; }
    });
    handle('alta:info', () => ({ version: config.version, machine_id: machineId, platform: process.platform,
      engine: 'chrome-pilot', session_model: 'pilot_per_machine', site_verified: false }));
    handle('alta:authorize', ticket => browser.authorize(String(ticket)));
    handle('alta:register', () => browser.api('POST', '/desktop/devices/register', {
      machine_id: machineId, name: ('Piloto Chrome · ' + os.hostname()).slice(0, 80), version: config.version
    }));
    handle('alta:open', creatorId => {
      if (!/^[a-f0-9]{24}$/.test(creatorId) || new URL(window.webContents.getURL()).pathname !== `/navegador/${creatorId}`) throw new Error('Selecione uma criadora autorizada.');
      return browser.open(creatorId);
    });
    handle('alta:close', () => browser.close());
    handle('alta:navigate', action => browser.navigate(action));
    ipcMain.on('alta:layout', (event, rect) => { try { trusted(event); browser.layout(rect); } catch { /* denied */ } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { browser.close().catch(() => {}); if (!allowedUrl(url, [config.app_url])) event.preventDefault(); });
    window.webContents.on('will-redirect', (event, url) => { if (!allowedUrl(url, [config.app_url])) event.preventDefault(); });
    window.webContents.on('render-process-gone', () => browser.close().catch(() => {}));
    window.webContents.on('did-fail-load', (_e, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) dialog.showMessageBox(window, { type: 'warning', title: 'Piloto Chrome',
        message: 'O painel não carregou. Verifique a conexão.', buttons: ['Tentar novamente', 'Fechar']
      }).then(result => result.response === 0 ? window.loadURL(config.app_url).catch(() => {}) : window.close());
    });
    let closing = false;
    window.on('close', event => {
      if (closing) return; event.preventDefault(); closing = true;
      browser.close().finally(() => { window.destroy(); app.quit(); });
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Piloto Chrome', submenu: [{ label: 'Sobre o piloto', click: () => dialog.showMessageBox(window, {
        title: 'Alta Pulse — Piloto Chrome', message: `Piloto ${config.version} · Experimental`,
        detail: 'Usa o Google Chrome instalado e perfis novos separados. O encaixe de janelas não é uma integração oficial do Chrome e precisa de validação no Windows. Nenhum reporte, cookies transferidos ou leitura de conteúdo. A aceitação pela Privacy não é garantida.'
      }) }, { type: 'separator' }, { role: 'quit', label: 'Sair' }] },
      { label: 'Editar', submenu: [{ role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' }] }
    ]));
    await window.loadURL(config.app_url).catch(() => {});
  });
}
app.on('window-all-closed', () => app.quit());