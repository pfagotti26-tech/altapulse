const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const APP_URL = 'https://privacy-agent-hub.preview.emergentagent.com';
const EMAIL = process.env.ALTA_TEST_EMAIL;
const PASSWORD = process.env.ALTA_TEST_PASSWORD;
const APP_DIR = '/app/test_reports/native-smoke-runtime/AltaCoreSmoke';
const ELECTRON_BIN = '/app/desktop/node_modules/electron/dist/electron';
const ARTIFACT_DIR = '/app/test_reports/native-smoke-runtime/artifacts';

const result = {
  started_at: new Date().toISOString(),
  ok: false,
  steps: [],
  failures: [],
  evidence: {},
  cleanup: {
    temp_creator_id: null,
    temp_creator_name: null,
    machine_id: null,
    user_id: null,
    device_id: null
  }
};

function mark(name, ok, details = {}) {
  result.steps.push({ name, ok, details, at: new Date().toISOString() });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`, details);
  if (!ok) result.failures.push({ name, details });
}

async function pageFetchJson(page, url, init) {
  return page.evaluate(async ({ url, init }) => {
    const response = await fetch(url, init);
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: response.ok, status: response.status, data };
  }, { url, init });
}

async function deleteTempCreator(page, creatorId) {
  if (!creatorId) return { skipped: true };
  return pageFetchJson(page, `${APP_URL}/api/creators/${creatorId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'TEMP_NATIVE fixture cleanup after native smoke test' })
  });
}

async function run() {
  if (!EMAIL || !PASSWORD) throw new Error('Missing ALTA_TEST_EMAIL/ALTA_TEST_PASSWORD in environment');
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const isolatedHome = `/app/test_reports/native-smoke-runtime/home-${Date.now()}`;
  fs.mkdirSync(isolatedHome, { recursive: true });

  let electronApp;
  let page;
  try {
    electronApp = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: [APP_DIR, '--no-sandbox', '--disable-dev-shm-usage'],
      env: {
        ...process.env,
        HOME: isolatedHome,
        XDG_CONFIG_HOME: isolatedHome,
        XDG_CACHE_HOME: path.join(isolatedHome, '.cache')
      }
    });
    mark('launch_electron', true);
    const nativeProcess = electronApp.process();
    nativeProcess.stderr.on('data', b => fs.appendFileSync(path.join(ARTIFACT_DIR, 'electron-stderr.log'), b));
    nativeProcess.stdout.on('data', b => fs.appendFileSync(path.join(ARTIFACT_DIR, 'electron-stdout.log'), b));
    nativeProcess.on('exit', (code, signal) => console.log('NATIVE_PROCESS_EXIT', code, signal));

    page = await electronApp.firstWindow({ timeout: 30000 });
    page.on('crash', () => mark('renderer_crash_event', false, { event: 'renderer_crash' }));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(1200);
    mark('first_window_available', true, { title: await page.title() });

    const hasAuthForm = await page.locator('[data-testid="auth-email"]').count();
    if (hasAuthForm) {
      await page.getByTestId('auth-email').fill(EMAIL);
      await page.getByTestId('auth-password').fill(PASSWORD);
      await page.getByTestId('auth-submit').click();
    }
    await page.waitForSelector('[data-testid="nav-creators"]', { timeout: 20000 });
    mark('ui_login_success', true, { used_form: Boolean(hasAuthForm) });

    const info = await page.evaluate(() => window.altaDesktop.info());
    result.cleanup.machine_id = info?.machine_id || null;
    mark('desktop_info_available', Boolean(info?.machine_id), info || {});

    const ticketForMismatch = await pageFetchJson(page, `${APP_URL}/api/desktop/auth/ticket`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machine_id: info.machine_id })
    });
    mark('ticket_issue_ok', ticketForMismatch.ok === true && !!ticketForMismatch?.data?.ticket, {
      status: ticketForMismatch.status,
      expires_in: ticketForMismatch?.data?.expires_in
    });

    const exchangeWrongMachine = await pageFetchJson(page, `${APP_URL}/api/desktop/auth/exchange`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: ticketForMismatch?.data?.ticket, machine_id: '00000000-0000-0000-0000-000000000000' })
    });
    mark('ticket_machine_binding_enforced', exchangeWrongMachine.ok === false && exchangeWrongMachine.status === 401, exchangeWrongMachine);

    const ticketForOneUse = await pageFetchJson(page, `${APP_URL}/api/desktop/auth/ticket`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machine_id: info.machine_id })
    });
    const firstExchange = await pageFetchJson(page, `${APP_URL}/api/desktop/auth/exchange`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: ticketForOneUse?.data?.ticket, machine_id: info.machine_id })
    });
    const secondExchange = await pageFetchJson(page, `${APP_URL}/api/desktop/auth/exchange`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: ticketForOneUse?.data?.ticket, machine_id: info.machine_id })
    });
    mark('ticket_one_time_exchange_enforced', firstExchange.ok === true && secondExchange.ok === false && secondExchange.status === 401, {
      first_status: firstExchange.status,
      second_status: secondExchange.status,
      second_data: secondExchange.data
    });

    const ticketForDesktopAuthorize = await pageFetchJson(page, `${APP_URL}/api/desktop/auth/ticket`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machine_id: info.machine_id })
    });
    const authorizeResult = await page.evaluate(async (ticket) => window.altaDesktop.authorize(ticket), ticketForDesktopAuthorize?.data?.ticket);
    mark('desktop_authorize_via_ticket', authorizeResult?.ok === true && !authorizeResult?.error, authorizeResult || {});

    let register = null;
    for (let i = 0; i < 3; i += 1) {
      register = await page.evaluate(() => window.altaDesktop.register());
      if (register?.status === 'approved') break;
      await page.waitForTimeout(2000);
    }
    result.cleanup.device_id = register?.id || null;
    mark('register_device_approved', register?.status === 'approved', register || {});

    const me = await pageFetchJson(page, `${APP_URL}/api/auth/me`, { credentials: 'include' });
    result.cleanup.user_id = me?.data?.user?.id || null;
    mark('auth_me_ok', me.ok === true, { status: me.status, role: me?.data?.user?.role });

    const fixtureName = `TEMP_NATIVE_${Date.now()}`;
    const createCreator = await pageFetchJson(page, `${APP_URL}/api/creators`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fixtureName, handle: 'tempnative', color: 'amber' })
    });
    if (createCreator.ok && createCreator?.data?.id) {
      result.cleanup.temp_creator_id = createCreator.data.id;
      result.cleanup.temp_creator_name = fixtureName;
    }
    mark('create_temp_native_fixture', createCreator.ok === true && !!createCreator?.data?.id, createCreator);

    await page.waitForTimeout(16500);
    let sidebarClicked = false;
    try {
      await page.waitForSelector(`[data-testid="sidebar-creator-${result.cleanup.temp_creator_id}"]`, { timeout: 10000 });
      await page.getByTestId(`sidebar-creator-${result.cleanup.temp_creator_id}`).click();
      sidebarClicked = true;
    } catch {
      await page.goto(`${APP_URL}/navegador/${result.cleanup.temp_creator_id}`);
    }
    mark('open_temp_creator_route', sidebarClicked, { creator_id: result.cleanup.temp_creator_id, sidebar_clicked: sidebarClicked });

    await page.waitForSelector('[data-testid="browser-runtime-state"]', { timeout: 15000 });
    await page.waitForTimeout(3500);
    let runtimeState = await page.getByTestId('browser-runtime-state').textContent();
    if (!/Navegador aberto|Carregando/.test(runtimeState || '')) {
      const retryVisible = await page.locator('[data-testid="retry-native-browser"]').count();
      const openVisible = await page.locator('[data-testid="open-native-browser"]').count();
      if (retryVisible > 0) await page.getByTestId('retry-native-browser').click();
      else if (openVisible > 0) await page.getByTestId('open-native-browser').click();
      await page.waitForTimeout(4000);
      runtimeState = await page.getByTestId('browser-runtime-state').textContent();
    }
    let openErrorText = null;
    if (!/Navegador aberto|Carregando/.test(runtimeState || '')) {
      const errCount = await page.locator('[data-testid="browser-open-error"]').count();
      if (errCount > 0) openErrorText = await page.locator('[data-testid="browser-open-error"]').textContent();
    }
    mark('runtime_state_open_or_loading', /Navegador aberto|Carregando/.test(runtimeState || ''), { runtimeState, openErrorText });

    const creatorRows = await pageFetchJson(page, `${APP_URL}/api/creators`, { credentials: 'include' });
    const fixture = Array.isArray(creatorRows?.data) ? creatorRows.data.find(c => c.id === result.cleanup.temp_creator_id) : null;
    const hasLease = Boolean(fixture?.desktop_access?.operator_id);
    mark('lease_active_for_temp_fixture', hasLease, { desktop_access: fixture?.desktop_access || null });

    const mainState = await electronApp.evaluate(async ({ webContents, BrowserWindow }) => {
      const all = webContents.getAllWebContents().map(w => ({
        id: w.id,
        url: w.getURL(),
        type: w.getType(),
        destroyed: w.isDestroyed(),
        partition: w.session?.getPartition?.() || null,
        storage_path: w.session?.getStoragePath?.() || null
      }));
      const controlWc = BrowserWindow.getAllWindows()[0]?.webContents || null;
      const target = webContents.getAllWebContents().find(w => (w.getURL() || '').includes('/api/health'));
      let globals = null;
      let sameSessionAsControl = null;
      let storagePathDifferentFromControl = null;
      if (target && !target.isDestroyed()) {
        globals = await target.executeJavaScript('({ altaDesktopType: typeof window.altaDesktop, processType: typeof process, requireType: typeof require, nodeVersion: (typeof process !== "undefined" && process.versions && process.versions.node) ? process.versions.node : null })', true);
        if (controlWc && controlWc.session && target.session) {
          sameSessionAsControl = target.session === controlWc.session;
          storagePathDifferentFromControl = (target.session?.getStoragePath?.() || null) !== (controlWc.session?.getStoragePath?.() || null);
        }
      }

      const win = BrowserWindow.getAllWindows()[0];
      let childBounds = [];
      try {
        const children = win?.contentView?.children || [];
        childBounds = children.map(v => {
          try { return v.getBounds(); } catch { return null; }
        }).filter(Boolean);
      } catch {
        childBounds = [];
      }

      return {
        all,
        target_found: Boolean(target),
        globals,
        sameSessionAsControl,
        storagePathDifferentFromControl,
        childBounds
      };
    });

    result.evidence.main_webcontents = mainState;
    mark('webcontents_health_loaded', mainState.target_found === true, { target_found: mainState.target_found });
    const nonZeroBounds = Array.isArray(mainState.childBounds) && mainState.childBounds.some(b => b && b.width > 0 && b.height > 0);
    mark('webcontents_view_nonzero_bounds', nonZeroBounds, { childBounds: mainState.childBounds });
    const isolatedPartition = Array.isArray(mainState.all) && mainState.all.some(w => (w.url || '').includes('/api/health') && String(w.partition || '').startsWith('persist:alta-creator-'));
    const distinctSession = mainState.sameSessionAsControl === false || mainState.storagePathDifferentFromControl === true || isolatedPartition;
    mark('separate_session_partition_present', distinctSession, {
      sameSessionAsControl: mainState.sameSessionAsControl,
      storagePathDifferentFromControl: mainState.storagePathDifferentFromControl,
      sessions: mainState.all.map(w => ({ url: w.url, partition: w.partition, storage_path: w.storage_path }))
    });
    const preloadAbsent = mainState.globals?.altaDesktopType === 'undefined' && mainState.globals?.requireType === 'undefined';
    const noNode = mainState.globals?.processType === 'undefined' || mainState.globals?.nodeVersion == null;
    mark('no_alta_preload_and_no_node_globals_on_standin', preloadAbsent && noNode, mainState.globals || {});

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'native_open_state.jpeg'), quality: 40, fullPage: false });

    const closeDisabled = await page.getByTestId('close-native-browser').isDisabled();
    if (!closeDisabled) {
      await page.getByTestId('close-native-browser').click();
      await page.waitForTimeout(1300);
      const closedState = await page.getByTestId('browser-runtime-state').textContent();
      mark('toolbar_close_works', /fechado/i.test(closedState || ''), { closedState });
    } else {
      mark('toolbar_close_works', false, { reason: 'close_button_disabled' });
    }

    await page.getByTestId('open-native-browser').click();
    await page.waitForTimeout(2500);
    await page.getByTestId('nav-computadores').click();
    await page.waitForSelector('[data-testid="devices-section-title"]', { timeout: 12000 });
    const afterUnmount = await pageFetchJson(page, `${APP_URL}/api/creators`, { credentials: 'include' });
    const fixtureAfterUnmount = Array.isArray(afterUnmount?.data) ? afterUnmount.data.find(c => c.id === result.cleanup.temp_creator_id) : null;
    mark('route_navigation_unmount_closes_lease', !fixtureAfterUnmount?.desktop_access, { desktop_access: fixtureAfterUnmount?.desktop_access || null });

    if (result.cleanup.temp_creator_id) {
      const cleanupResult = await deleteTempCreator(page, result.cleanup.temp_creator_id);
      mark('cleanup_temp_creator_via_api', cleanupResult?.ok === true || cleanupResult?.status === 404, cleanupResult || {});
      if (cleanupResult?.ok === true || cleanupResult?.status === 404) result.cleanup.temp_creator_id = null;
    }

    await page.getByTestId('logout-button').click();
    await page.waitForSelector('[data-testid="auth-submit"]', { timeout: 12000 });
    mark('logout_returns_to_auth', true);

    const registerAfterLogout = await page.evaluate(async () => window.altaDesktop.register());
    mark('logout_invalidates_native_register', Boolean(registerAfterLogout?.error) && !String(registerAfterLogout.error).startsWith('net::'), registerAfterLogout || {});

    const postLogoutState = await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents().map(w => w.getURL()));
    mark('logout_closes_native_health_view', !postLogoutState.some(url => String(url).includes('/api/health')), { urls: postLogoutState });

    const postLogoutExchange = await pageFetchJson(page, `${APP_URL}/api/desktop/auth/exchange`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: 'invalid-ticket-after-logout', machine_id: info.machine_id })
    });
    mark('post_logout_exchange_rejected', postLogoutExchange.ok === false && [401, 422].includes(postLogoutExchange.status), postLogoutExchange);

    result.ok = result.failures.length === 0;
  } catch (error) {
    mark('runner_exception', false, { message: String(error && error.message ? error.message : error) });
    result.ok = false;
  } finally {
    try {
      if (page && result.cleanup.temp_creator_id) {
        const cleanupResult = await deleteTempCreator(page, result.cleanup.temp_creator_id);
        mark('cleanup_temp_creator_via_api', cleanupResult?.ok === true || cleanupResult?.status === 404, cleanupResult || {});
      }
    } catch (cleanupError) {
      mark('cleanup_temp_creator_via_api', false, { message: String(cleanupError?.message || cleanupError) });
    }

    try {
      if (electronApp) await electronApp.close();
    } catch (closeError) {
      mark('close_electron', false, { message: String(closeError?.message || closeError) });
    }

    result.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'native_smoke_result.json'), JSON.stringify(result, null, 2));
    console.log(`Result written: ${path.join(ARTIFACT_DIR, 'native_smoke_result.json')}`);
  }
}

run();