const { WebContentsView, session } = require('electron');
const { allowedUrl, profilePartition, boundsFor } = require('./policy.cjs');

class CreatorBrowser {
  constructor(window, controlSession, config, machineId) {
    this.window = window; this.controlSession = controlSession; this.config = config; this.machineId = machineId;
    this.view = null; this.lease = null; this.timer = null; this.rect = null;
    this.state = { status: 'closed', creator_id: null, can_back: false, can_forward: false };
    this.busy = false;
    this.generation = 0;
    this.authToken = null;
    this.window.on('resize', () => this.applyBounds());
  }
  send(update) {
    this.state = { ...this.state, ...update };
    if (!this.window.isDestroyed()) this.window.webContents.send('alta:state', this.state);
  }
  async authorize(ticket) {
    if (!/^[A-Za-z0-9_-]{40,128}$/.test(ticket)) throw new Error('Autorização temporária inválida.');
    this.authToken = null;
    const result = await this.api('POST', '/desktop/auth/exchange', { ticket, machine_id: this.machineId });
    this.authToken = result.token;
    return { ok: true };
  }
  async api(method, endpoint, body) {
    const response = await this.controlSession.fetch(this.config.app_url + '/api' + endpoint, {
      method, credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/json', ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível autorizar o navegador.');
    return data;
  }
  async open(creatorId) {
    console.error('SMOKE OPEN', creatorId, 'generation', this.generation);
    if (!/^[a-f0-9]{24}$/.test(creatorId)) throw new Error('Criadora inválida.');
    if (this.busy) throw new Error('Aguarde a abertura em andamento.');
    this.busy = true;
    try {
      await this.close();
      const generation = this.generation;
      const lease = await this.api('POST', '/desktop/leases', { creator_id: creatorId, machine_id: this.machineId });
      if (generation !== this.generation || new URL(this.window.webContents.getURL()).pathname !== `/navegador/${creatorId}`) {
        await this.api('DELETE', `/desktop/leases/${lease.id}`).catch(() => {});
        return { cancelled: true };
      }
      this.lease = lease;
      const ses = session.fromPartition(profilePartition(this.machineId, creatorId));
      ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
      ses.setPermissionCheckHandler(() => false);
      ses.on('will-download', event => event.preventDefault());
      this.view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true,
        nodeIntegration: false, webSecurity: true, devTools: false, webviewTag: false, navigateOnDragDrop: false } });
      const wc = this.view.webContents;
      const permitted = url => allowedUrl(url, this.config.privacy_origins);
      const guard = (event, url) => { if (!permitted(url)) { event.preventDefault(); this.send({ notice: 'Navegação externa não autorizada. Nenhuma proteção do site foi alterada.' }); } };
      wc.on('will-navigate', guard);
      wc.on('will-redirect', guard);
      wc.setWindowOpenHandler(() => { this.send({ notice: 'A página tentou abrir outra janela. Pop-ups não são liberados nesta versão.' }); return { action: 'deny' }; });
      wc.on('did-start-loading', () => this.send({ status: 'loading' }));
      const update = () => {
        if (!this.view || wc.isDestroyed()) return;
        this.send({ status: 'open', can_back: wc.navigationHistory.canGoBack(), can_forward: wc.navigationHistory.canGoForward() });
      };
      wc.on('did-stop-loading', update);
      wc.on('did-navigate-in-page', update);
      wc.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
        if (mainFrame && code !== -3) { this.detach(); this.send({ status: 'error', message: 'A página não carregou. Verifique a conexão ou tente novamente. Não há contorno de bloqueios.' }); }
      });
      wc.on('render-process-gone', () => { this.close().catch(() => {}); this.send({ status: 'error', message: 'O navegador foi interrompido. Abra o perfil novamente.' }); });
      this.window.contentView.addChildView(this.view);
      this.applyBounds();
      this.send({ status: 'loading', creator_id: creatorId, creator_name: this.lease.creator_name, mode: this.lease.mode, message: '', notice: '' });
      this.timer = setInterval(() => this.heartbeat(), 10000);
      wc.loadURL(this.config.privacy_url).catch(() => {});
      return { ok: true, mode: this.lease.mode };
    } finally { this.busy = false; }
  }
  detach() {
    if (this.view && !this.window.isDestroyed()) {
      try { this.window.contentView.removeChildView(this.view); } catch { /* already removed */ }
    }
  }
  layout(rect) { this.rect = rect; this.applyBounds(); }
  applyBounds() {
    if (!this.view || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const bounds = boundsFor(this.rect, width, height);
    if (bounds) this.view.setBounds(bounds);
    else this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
  async heartbeat() {
    if (!this.lease || this.checking) return;
    this.checking = true;
    try { await this.api('POST', `/desktop/leases/${this.lease.id}/heartbeat`); }
    catch (error) { await this.close(); this.send({ status: 'error', message: error.message }); }
    finally { this.checking = false; }
  }
  navigate(action) {
    if (!this.view) return;
    const wc = this.view.webContents;
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'reload') { this.window.contentView.addChildView(this.view); this.applyBounds(); wc.reload(); }
    else if (action === 'home') wc.loadURL(this.config.privacy_url).catch(() => {});
  }
  async close() {
    console.error('SMOKE CLOSE', this.generation, new Error().stack);
    this.generation += 1;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const lease = this.lease; this.lease = null;
    if (this.view) {
      const view = this.view; this.detach(); this.view = null;
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.send({ status: 'closed', creator_id: null, can_back: false, can_forward: false, notice: '' });
    if (lease) await this.api('DELETE', `/desktop/leases/${lease.id}`).catch(() => {});
  }
}
module.exports = { CreatorBrowser };