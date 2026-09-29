const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');

const {
  profileKey,
  chromeCandidates,
  parseHostLine,
  boundsCommand,
} = require('/app/desktop/pilot/host-protocol.cjs');

const pilotPolicy = '/app/desktop/pilot/policy.cjs';
assert.ok(fs.existsSync(pilotPolicy), 'Source pilot policy module must exist without a test-side copy workaround');
const { ChromePilotBrowser } = require('/app/desktop/pilot/chrome-browser.cjs');

class FakeHelper extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stdin = new EventEmitter();
    this.stdin.destroyed = false;
    this.exitCode = null;
    this.killed = false;
    this.writes = [];

    this.stdin.write = data => {
      this.writes.push(String(data));
      return true;
    };
    this.stdin.end = data => {
      if (data) this.writes.push(String(data));
      this.stdin.destroyed = true;
      this.exitCode = 0;
      this.emit('exit', 0);
    };
    this.kill = () => {
      this.killed = true;
      this.stdin.destroyed = true;
      this.exitCode = 1;
      this.emit('exit', 1);
    };
  }
}

function makeWindow(pathname) {
  const bus = new EventEmitter();
  const handle = Buffer.alloc(8);
  handle.writeBigUInt64LE(0x1234n, 0);
  const state = { pathname };

  return {
    on: (event, fn) => bus.on(event, fn),
    emit: (event, ...args) => bus.emit(event, ...args),
    isDestroyed: () => false,
    getNativeWindowHandle: () => handle,
    getContentSize: () => [1200, 800],
    webContents: {
      send: () => {},
      getURL: () => `https://app.local${state.pathname}`,
    },
    _state: state,
  };
}

function makeSession(onFetch) {
  return {
    fetch: async (url, options) => {
      const value = await onFetch(url, options);
      return {
        ok: value.ok,
        status: value.status || (value.ok ? 200 : 500),
        json: async () => value.data,
      };
    },
  };
}

async function run() {
  // host-protocol contract
  const machine = '123e4567-e89b-12d3-a456-426614174000';
  const creatorA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const creatorB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const key1 = profileKey(machine, creatorA);
  const key2 = profileKey(machine, creatorA);
  const key3 = profileKey(machine, creatorB);
  assert.strictEqual(key1, key2);
  assert.notStrictEqual(key1, key3);
  assert.throws(() => profileKey('bad-machine', creatorA));
  assert.throws(() => profileKey(machine, 'bad-creator'));

  const candidates = chromeCandidates({
    PROGRAMFILES: 'C:\\PF',
    'PROGRAMFILES(X86)': 'C:\\PF86',
    LOCALAPPDATA: 'C:\\LA',
  });
  assert.deepStrictEqual(candidates, [
    'C:\\PF\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\PF86\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\LA\\Google\\Chrome\\Application\\chrome.exe',
  ]);

  assert.deepStrictEqual(parseHostLine('READY'), { event: 'READY' });
  assert.deepStrictEqual(parseHostLine('CLOSED'), { event: 'CLOSED' });
  assert.strictEqual(parseHostLine('ERROR\targuments_invalid').event, 'ERROR');
  assert.throws(() => parseHostLine('ERROR\tnot_known'));
  assert.throws(() => parseHostLine(`READY${'x'.repeat(200)}`));

  assert.strictEqual(boundsCommand({ x: 1, y: 2, width: 3, height: 4 }), 'BOUNDS\t1\t2\t3\t4\n');
  assert.strictEqual(boundsCommand(null), 'BOUNDS\t0\t0\t0\t0\n');
  assert.throws(() => boundsCommand({ x: '1\nrm', y: 0, width: 100, height: 100 }));

  // ChromePilotBrowser: windows-only contract
  {
    const win = makeWindow('/navegador/aaaaaaaaaaaaaaaaaaaaaaaa');
    const browser = new ChromePilotBrowser(
      win,
      makeSession(async () => ({ ok: true, data: {} })),
      { app_url: 'https://app.local' },
      machine,
      '/tmp',
      { platform: 'linux' },
    );
    await assert.rejects(browser.open('aaaaaaaaaaaaaaaaaaaaaaaa'), /apenas no Windows/i);
  }

  // denied lease / missing chrome => no helper spawn
  {
    let spawnCount = 0;
    const win = makeWindow('/navegador/aaaaaaaaaaaaaaaaaaaaaaaa');
    const browser = new ChromePilotBrowser(
      win,
      makeSession(async (url) => {
        if (url.endsWith('/desktop/leases')) {
          return { ok: false, status: 403, data: { detail: 'Acesso exclusivo do gestor.' } };
        }
        return { ok: true, data: {} };
      }),
      { app_url: 'https://app.local' },
      machine,
      '/tmp',
      {
        platform: 'win32',
        findChrome: () => 'C:\\Google\\Chrome\\Application\\chrome.exe',
        spawn: () => {
          spawnCount += 1;
          return new FakeHelper();
        },
      },
    );
    await assert.rejects(browser.open('aaaaaaaaaaaaaaaaaaaaaaaa'), /gestor/i);
    assert.strictEqual(spawnCount, 0);
  }

  // waits READY (not only spawn), and cleanup on ERROR
  {
    const calls = [];
    const helper = new FakeHelper();
    const lease = { id: 'lease-1' };
    const win = makeWindow('/navegador/aaaaaaaaaaaaaaaaaaaaaaaa');
    const browser = new ChromePilotBrowser(
      win,
      makeSession(async (url, options) => {
        calls.push({ url, method: options.method });
        if (url.endsWith('/desktop/leases') && options.method === 'POST') return { ok: true, data: lease };
        if (url.endsWith('/desktop/leases/lease-1') && options.method === 'DELETE') return { ok: true, data: { ok: true } };
        if (url.endsWith('/desktop/leases/lease-1/heartbeat')) return { ok: true, data: lease };
        return { ok: true, data: {} };
      }),
      { app_url: 'https://app.local' },
      machine,
      '/tmp',
      {
        platform: 'win32',
        findChrome: () => 'C:\\Google\\Chrome\\Application\\chrome.exe',
        spawn: () => {
          setTimeout(() => helper.stdout.emit('data', Buffer.from('ERROR\targuments_invalid\n')), 5);
          return helper;
        },
      },
    );
    await assert.rejects(browser.open('aaaaaaaaaaaaaaaaaaaaaaaa'));
    assert.ok(calls.some(item => item.url.endsWith('/desktop/leases/lease-1') && item.method === 'DELETE'));
  }

  // cancellation guard by route mismatch and no spawn
  {
    let spawnCount = 0;
    const calls = [];
    const win = makeWindow('/outra-rota');
    const browser = new ChromePilotBrowser(
      win,
      makeSession(async (url, options) => {
        calls.push({ url, method: options.method });
        if (url.endsWith('/desktop/leases') && options.method === 'POST') return { ok: true, data: { id: 'lease-cancel' } };
        if (url.endsWith('/desktop/leases/lease-cancel') && options.method === 'DELETE') return { ok: true, data: { ok: true } };
        return { ok: true, data: {} };
      }),
      { app_url: 'https://app.local' },
      machine,
      '/tmp',
      {
        platform: 'win32',
        findChrome: () => 'C:\\Google\\Chrome\\Application\\chrome.exe',
        spawn: () => {
          spawnCount += 1;
          return new FakeHelper();
        },
      },
    );
    const result = await browser.open('aaaaaaaaaaaaaaaaaaaaaaaa');
    assert.strictEqual(result.cancelled, true);
    assert.strictEqual(spawnCount, 0);
    assert.ok(calls.some(item => item.url.endsWith('/desktop/leases/lease-cancel') && item.method === 'DELETE'));
  }

  // successful open, focus command, heartbeat revocation closes own helper and lease
  {
    const calls = [];
    const helper = new FakeHelper();
    const lease = { id: 'lease-2' };
    const win = makeWindow('/navegador/aaaaaaaaaaaaaaaaaaaaaaaa');

    const browser = new ChromePilotBrowser(
      win,
      makeSession(async (url, options) => {
        calls.push({ url, method: options.method });
        if (url.endsWith('/desktop/leases') && options.method === 'POST') return { ok: true, data: lease };
        if (url.endsWith('/desktop/leases/lease-2/heartbeat')) {
          return { ok: false, status: 409, data: { detail: 'A autorização do navegador expirou ou foi encerrada.' } };
        }
        if (url.endsWith('/desktop/leases/lease-2') && options.method === 'DELETE') return { ok: true, data: { ok: true } };
        return { ok: true, data: {} };
      }),
      { app_url: 'https://app.local' },
      machine,
      '/tmp',
      {
        platform: 'win32',
        findChrome: () => 'C:\\Google\\Chrome\\Application\\chrome.exe',
        spawn: () => {
          setTimeout(() => helper.stdout.emit('data', Buffer.from('READY\n')), 5);
          return helper;
        },
      },
    );

    const result = await browser.open('aaaaaaaaaaaaaaaaaaaaaaaa');
    assert.strictEqual(result.ok, true);
    browser.layout({ x: 10, y: 10, width: 400, height: 300 });
    browser.navigate('focus');
    assert.ok(helper.writes.some(write => write.includes('FOCUS')));

    await browser.heartbeat();
    assert.ok(calls.some(item => item.url.endsWith('/desktop/leases/lease-2/heartbeat') && item.method === 'POST'));
    assert.ok(calls.some(item => item.url.endsWith('/desktop/leases/lease-2') && item.method === 'DELETE'));
  }

  console.log('ok: chrome pilot synthetic contracts');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
