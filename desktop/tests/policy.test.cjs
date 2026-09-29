const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { allowedUrl, profilePartition, boundsFor } = require('../policy.cjs');

// Native desktop policy coverage: URL allow-listing, profile partitioning, viewport bounds, IPC trust checks.

test('allowedUrl permits only https configured origins and rejects dangerous schemes/lookalikes', () => {
  const appOrigin = 'https://privacy-agent-hub.preview.emergentagent.com';
  const privacyOrigin = 'https://privacy.example.com';
  const allowed = [appOrigin, privacyOrigin];

  assert.equal(allowedUrl(`${appOrigin}/navegador/abc`, allowed), true);
  assert.equal(allowedUrl(`${privacyOrigin}/login`, allowed), true);

  assert.equal(allowedUrl('http://privacy.example.com/login', allowed), false);
  assert.equal(allowedUrl('javascript:alert(1)', allowed), false);
  assert.equal(allowedUrl('data:text/html,hello', allowed), false);
  assert.equal(allowedUrl('file:///etc/passwd', allowed), false);
  assert.equal(allowedUrl('https://user:pass@privacy.example.com', allowed), false);
  assert.equal(allowedUrl('https://privacy.example.com.evil.com', allowed), false);
  assert.equal(allowedUrl('https://evil-privacy.example.com', allowed), false);
  assert.equal(allowedUrl('https://privacy.example.com:444', allowed), false);
});

test('profilePartition is stable per machine+creator and unique across creators', () => {
  const machine = '11111111-2222-4333-8444-555555555555';
  const creatorA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const creatorB = 'bbbbbbbbbbbbbbbbbbbbbbbb';

  const pa1 = profilePartition(machine, creatorA);
  const pa2 = profilePartition(machine, creatorA);
  const pb = profilePartition(machine, creatorB);

  assert.equal(pa1, pa2);
  assert.notEqual(pa1, pb);
  assert.match(pa1, /^persist:alta-creator-[a-f0-9]{64}$/);
});

test('profilePartition rejects invalid IDs', () => {
  assert.throws(() => profilePartition('bad-machine-id', 'aaaaaaaaaaaaaaaaaaaaaaaa'));
  assert.throws(() => profilePartition('11111111-2222-4333-8444-555555555555', 'badcreator'));
});

test('boundsFor clamps dimensions and rejects invalid/small rectangles', () => {
  const bounded = boundsFor({ x: 10.4, y: -5, width: 3000.7, height: 9999 }, 1400, 900);
  assert.deepEqual(bounded, { x: 180, y: 80, width: 1220, height: 820 });

  assert.equal(boundsFor({ x: 100, y: 100, width: 100, height: 100 }, 1400, 900), null);
  assert.equal(boundsFor({ x: NaN, y: 10, width: 500, height: 500 }, 1400, 900), null);
  assert.equal(boundsFor(null, 1400, 900), null);
});

test('main IPC trust gate checks sender, frame and allowed app origin', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  assert.match(src, /event\.sender\s*!==\s*window\.webContents/);
  assert.match(src, /event\.senderFrame\s*!==\s*window\.webContents\.mainFrame/);
  assert.match(src, /allowedUrl\(event\.senderFrame\.url,\s*\[config\.app_url\]\)/);
});
