const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { classifyHttpStatus, watchNavigation } = require('/app/desktop/navigation.cjs');

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
    };
  }
  isDestroyed() {
    return false;
  }
}

function statusEvents(events) {
  return events.filter(event => Object.prototype.hasOwnProperty.call(event, 'status'));
}

function runWatcherScenario() {
  const wc = new FakeWebContents();
  const events = [];
  let networkFailures = 0;
  let gone = 0;

  watchNavigation(wc, {
    origins: ['https://privacy.com.br'],
    isCurrent: () => true,
    publish: update => events.push(update),
    networkFailure: () => { networkFailures += 1; },
    processGone: () => { gone += 1; },
  });

  wc.emit('did-start-navigation', {}, 'https://privacy.com.br/auth?route=sign-in', false, true);
  wc.emit('did-navigate', {}, 'https://privacy.com.br/auth?route=sign-in', 403);
  wc.emit('did-stop-loading');
  wc.emit('did-navigate-in-page');

  const statuses = statusEvents(events).map(event => event.status);
  assert.ok(statuses.includes('blocked'), '403 must be classified as blocked');
  assert.equal(statuses[statuses.length - 1], 'blocked', 'did-stop-loading must not override blocked state');

  wc.emit('did-start-navigation', {}, 'https://privacy.com.br/auth?route=sign-in', false, true);
  wc.emit('did-navigate', {}, 'https://privacy.com.br/auth?route=sign-in', 429);
  assert.equal(statusEvents(events).at(-1).status, 'blocked', '429 must be blocked');
  assert.equal(statusEvents(events).at(-1).http_status, 429, '429 blocked must preserve status code');

  wc.emit('did-start-navigation', {}, 'https://privacy.com.br/auth?route=sign-in', false, true);
  wc.emit('did-stop-loading');
  assert.equal(statusEvents(events).at(-1).status, 'unconfirmed', 'loading without did-navigate must become unconfirmed');

  wc.emit('did-start-navigation', {}, 'https://privacy.com.br/auth?route=sign-in', false, true);
  wc.emit('did-navigate', {}, 'https://privacy.com.br/auth?route=sign-in', 200);
  assert.equal(statusEvents(events).at(-1).status, 'open', '2xx from did-navigate must become open');

  wc.emit('did-start-navigation', {}, 'https://privacy.com.br/auth?route=sign-in', false, true);
  wc.emit('did-navigate', {}, 'https://privacy.com.br/auth?route=sign-in', 500);
  assert.equal(statusEvents(events).at(-1).status, 'http_error', '5xx must be http_error');

  wc.emit('did-start-navigation', {}, 'https://privacy.com.br/auth?route=sign-in', false, true);
  wc.emit('did-navigate', {}, 'https://privacy.com.br/auth?route=sign-in');
  assert.equal(statusEvents(events).at(-1).status, 'unconfirmed', 'missing code must be unconfirmed');

  const beforeNonMainFrame = events.length;
  wc.emit('did-start-navigation', {}, 'https://privacy.com.br/auth?route=sign-in', false, false);
  assert.equal(events.length, beforeNonMainFrame, 'non-mainframe did-start-navigation must be ignored');

  const beforeUnapproved = events.length;
  wc.emit('did-navigate', {}, 'https://example.com/other', 403);
  assert.equal(events.length, beforeUnapproved, 'unapproved origin must be ignored');

  wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://privacy.com.br/auth?route=sign-in', true);
  assert.equal(networkFailures, 1, 'networkFailure callback must fire for non-cancel fail-load');
  assert.equal(statusEvents(events).at(-1).status, 'error', 'fail-load must publish error status');

  wc.emit('render-process-gone');
  assert.equal(gone, 1, 'processGone callback must be invoked');
}

function runStaleViewScenario() {
  const wc = new FakeWebContents();
  const events = [];

  watchNavigation(wc, {
    origins: ['https://privacy.com.br'],
    isCurrent: () => false,
    publish: update => events.push(update),
    networkFailure: () => {},
    processGone: () => {},
  });

  wc.emit('did-start-navigation', {}, 'https://privacy.com.br/auth?route=sign-in', false, true);
  wc.emit('did-navigate', {}, 'https://privacy.com.br/auth?route=sign-in', 403);
  wc.emit('did-stop-loading');
  wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://privacy.com.br/auth?route=sign-in', true);
  wc.emit('render-process-gone');

  assert.equal(events.length, 0, 'stale views must publish nothing');
}

function runClassifierAssertions() {
  assert.deepEqual(classifyHttpStatus(403).status, 'blocked');
  assert.deepEqual(classifyHttpStatus(429).status, 'blocked');
  assert.deepEqual(classifyHttpStatus(204).status, 'open');
  assert.deepEqual(classifyHttpStatus(503).status, 'http_error');
  assert.deepEqual(classifyHttpStatus(undefined).status, 'unconfirmed');
}

runClassifierAssertions();
runWatcherScenario();
runStaleViewScenario();
console.log('ok');
