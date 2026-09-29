const { spawn } = require('node:child_process');
const path = require('node:path');
const { boundsFor } = require('./policy.cjs');
const { profileKey, findChrome, parseHostLine, boundsCommand } = require('./host-protocol.cjs');

class ChromePilotBrowser {
  constructor(window, controlSession, config, machineId, resourcesPath, dependencies = {}) {
    this.window = window; this.session = controlSession; this.config = config; this.machineId = machineId;
    this.resourcesPath = resourcesPath; this.spawn = dependencies.spawn || spawn;
    this.findChrome = dependencies.findChrome || findChrome; this.platform = dependencies.platform || process.platform;
    this.lease = null; this.helper = null; this.authToken = null; this.timer = null;
    this.rect = null; this.busy = false; this.generation = 0; this.checking = false;
    this.state = { status: 'closed', engine: 'chrome-pilot', creator_id: null, can_back: false, can_forward: false };
    window.on('resize', () => this.applyBounds());
  }
  send(update) {
    this.state = { ...this.state, ...update };
    if (!this.window.isDestroyed()) this.window.webContents.send('alta:state', this.state);
  }
  async api(method, endpoint, body) {
    const response = await this.session.fetch(this.config.app_url + '/api' + endpoint, {
      method, credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/json', ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível autorizar o piloto.');
    return data;
  }
  async authorize(ticket) {
    if (!/^[A-Za-z0-9_-]{40,128}$/.test(ticket)) throw new Error('Autorização temporária inválida.');
    this.authToken = null;
    const data = await this.api('POST', '/desktop/auth/exchange', { ticket, machine_id: this.machineId });
    this.authToken = data.token; return { ok: true };
  }
  async open(creatorId) {
    if (this.platform !== 'win32') throw new Error('Este piloto de encaixe de janelas funciona apenas no Windows.');
    const key = profileKey(this.machineId, creatorId);
    if (this.busy) throw new Error('Aguarde a abertura em andamento.');
    this.busy = true;
    let generation;
    try {
      await this.close();
      generation = this.generation;
      const chromePath = this.findChrome();
      const lease = await this.api('POST', '/desktop/leases', { creator_id: creatorId, machine_id: this.machineId });
      if (generation !== this.generation || new URL(this.window.webContents.getURL()).pathname !== `/navegador/${creatorId}`) {
        await this.api('DELETE', `/desktop/leases/${lease.id}`).catch(() => {}); return { cancelled: true };
      }
      this.lease = lease;
      this.send({ status: 'chrome_starting', creator_id: creatorId, message: '', notice: '', can_back: false, can_forward: false });
      this.timer = setInterval(() => this.heartbeat(), 10000);
      const hwnd = this.window.getNativeWindowHandle().readBigUInt64LE(0).toString(16);
      const helper = this.spawn(path.join(this.resourcesPath, 'chrome-host.exe'), [
        '--parent', hwnd, '--parent-pid', String(process.pid), '--chrome', chromePath, '--profile-key', key
      ], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      this.helper = helper;
      await this.waitForHost(helper, generation);
      if (generation !== this.generation) return { cancelled: true };
      this.applyBounds();
      this.send({ status: 'chrome_embedded', message: '', notice: 'Chrome real encaixado. A página, a conta conectada e a aceitação da Privacy não são verificadas pelo piloto.' });
      return { ok: true, engine: 'chrome-pilot', site_verified: false };
    } catch (error) {
      const cancelled = generation !== undefined && generation !== this.generation;
      await this.close();
      if (cancelled) return { cancelled: true };
      this.send({ status: 'error', message: error.message }); throw error;
    } finally { this.busy = false; }
  }
  waitForHost(helper, generation) {
    return new Promise((resolve, reject) => {
      let buffer = '', ready = false, settled = false;
      const timer = setTimeout(() => finish(new Error('O Chrome não confirmou o encaixe em tempo hábil. O piloto foi encerrado.')), 28000);
      const finish = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
      const fail = message => {
        if (!ready) finish(new Error(message));
        else if (this.helper === helper && generation === this.generation) {
          const expectedGeneration = this.generation + 1;
          this.close().finally(() => { if (this.generation === expectedGeneration) this.send({ status: 'error', message }); });
        }
      };
      helper.stdin.on('error', () => fail('A comunicação local com o piloto foi interrompida.'));
      helper.on('error', () => fail('O Windows não permitiu iniciar o componente do piloto. Não desative as proteções do sistema.'));
      helper.on('exit', () => {
        if (!ready) finish(new Error('O componente do piloto encerrou antes de confirmar o encaixe.'));
        else if (this.helper === helper) this.close().catch(() => {});
      });
      helper.stdout.on('data', chunk => {
        buffer += chunk.toString('utf8');
        if (buffer.length > 2048) { fail('O componente local enviou uma resposta inválida.'); return; }
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try {
            const message = parseHostLine(line);
            if (message.event === 'ERROR') { fail(message.message); return; }
            if (message.event === 'READY' && this.helper === helper && generation === this.generation) { ready = true; finish(); }
            if (message.event === 'CLOSED') {
              if (!ready) finish(new Error('A abertura do piloto foi cancelada.'));
              else if (this.helper === helper) this.close().catch(() => {});
            }
          } catch (error) { fail(error.message); }
        }
      });
      this.applyBounds();
    });
  }
  layout(rect) { this.rect = rect; this.applyBounds(); }
  applyBounds() {
    if (!this.helper || this.window.isDestroyed() || this.helper.stdin.destroyed) return;
    const [width, height] = this.window.getContentSize();
    this.helper.stdin.write(boundsCommand(boundsFor(this.rect, width, height)));
  }
  navigate(action) {
    if (action !== 'focus') throw new Error('Neste piloto, a navegação é realizada manualmente no Chrome.');
    if (this.state.status === 'chrome_embedded' && this.helper && !this.helper.stdin.destroyed) this.helper.stdin.write('FOCUS\n');
  }
  async heartbeat() {
    if (!this.lease || this.checking) return;
    this.checking = true;
    try { await this.api('POST', `/desktop/leases/${this.lease.id}/heartbeat`); }
    catch (error) { await this.close(); this.send({ status: 'error', message: error.message }); }
    finally { this.checking = false; }
  }
  async close() {
    this.generation += 1; if (this.timer) clearInterval(this.timer); this.timer = null;
    const helper = this.helper, lease = this.lease; this.helper = null; this.lease = null;
    if (helper && helper.exitCode === null && !helper.killed) {
      await new Promise(resolve => {
        let done = false;
        const finish = () => { if (done) return; done = true; clearTimeout(timeout); resolve(); };
        const timeout = setTimeout(() => { helper.kill(); finish(); }, 4500);
        helper.once('exit', finish);
        try { helper.stdin.end('CLOSE\n'); } catch { helper.kill(); finish(); }
      });
    }
    this.send({ status: 'closed', creator_id: null, message: '', notice: '', can_back: false, can_forward: false });
    if (lease) await this.api('DELETE', `/desktop/leases/${lease.id}`).catch(() => {});
  }
}
module.exports = { ChromePilotBrowser };