"""Iteration 14: Alta Pulse Chrome extension backend contract & regression.

Covers /api/extension/* endpoints (login/state/heartbeat/shifts/observations/logout/release/download),
CORS/origin_guard for chrome-extension origin, removal of legacy desktop routes, and regression
of core panel endpoints (/api/auth, /api/creators, /api/metrics, /api/settings, /api/shifts).
"""
import os, io, zipfile, uuid
from pathlib import Path
import pytest, requests
from dotenv import load_dotenv

load_dotenv('/root/alta-core-test.env')
BASE = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') if os.environ.get('REACT_APP_BACKEND_URL') else None
if not BASE:
    # try frontend .env
    for line in Path('/app/frontend/.env').read_text().splitlines():
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = BASE + '/api'
TEST_EMAIL = os.environ['ALTA_TEST_EMAIL']
TEST_PASSWORD = os.environ['ALTA_TEST_PASSWORD']
EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'


# ---------- fixtures ----------
@pytest.fixture(scope='module')
def web_session():
    s = requests.Session()
    r = s.post(f'{API}/auth/login', json={'email': TEST_EMAIL, 'password': TEST_PASSWORD})
    assert r.status_code == 200, f'web login failed: {r.status_code} {r.text}'
    return s


@pytest.fixture(scope='module')
def ext_token():
    r = requests.post(f'{API}/extension/login',
                      json={'email': TEST_EMAIL, 'password': TEST_PASSWORD, 'device_name': 'QA-Chrome'},
                      headers={'Origin': EXT_ORIGIN})
    assert r.status_code == 200, f'ext login failed: {r.status_code} {r.text}'
    data = r.json()
    assert data['token'] and data['expires_at'] and data['user']['email'] == TEST_EMAIL
    return data['token']


def ext_headers(token):
    return {'Authorization': f'Bearer {token}', 'Origin': EXT_ORIGIN}


# ---------- /api/extension/login ----------
class TestExtensionLogin:
    def test_login_success_returns_token(self):
        r = requests.post(f'{API}/extension/login',
                          json={'email': TEST_EMAIL, 'password': TEST_PASSWORD},
                          headers={'Origin': EXT_ORIGIN})
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j['token'], str) and len(j['token']) > 20
        assert 'expires_at' in j and j['user']['email'] == TEST_EMAIL

    def test_login_wrong_password_401(self):
        r = requests.post(f'{API}/extension/login',
                          json={'email': TEST_EMAIL, 'password': 'WrongPassword!123'},
                          headers={'Origin': EXT_ORIGIN})
        assert r.status_code == 401

    def test_login_rate_limit_429(self):
        # Use a synthetic bogus email to avoid touching test account counter
        bogus = f'nobody+{uuid.uuid4().hex[:6]}@example.com'
        status_codes = []
        for _ in range(30):
            r = requests.post(f'{API}/extension/login',
                              json={'email': bogus, 'password': 'BadPass!123'},
                              headers={'Origin': EXT_ORIGIN})
            status_codes.append(r.status_code)
        assert 429 in status_codes, f'expected 429, got {status_codes}'


# ---------- /api/extension/state ----------
class TestExtensionState:
    def test_state_ok(self, ext_token):
        r = requests.get(f'{API}/extension/state', headers=ext_headers(ext_token))
        assert r.status_code == 200
        d = r.json()
        assert d['user']['email'] == TEST_EMAIL
        assert isinstance(d['creators'], list)
        assert 'storage_allowed' in d and 'sla_minutes' in d and 'version' in d

    def test_state_no_token_401(self):
        r = requests.get(f'{API}/extension/state')
        assert r.status_code == 401

    def test_state_chrome_extension_origin_not_blocked(self, ext_token):
        # explicit chrome-extension:// Origin must NOT be blocked
        r = requests.get(f'{API}/extension/state', headers=ext_headers(ext_token))
        assert r.status_code == 200


# ---------- /api/extension/heartbeat ----------
class TestExtensionHeartbeat:
    def test_heartbeat_manager_ok(self, ext_token, web_session):
        creators = web_session.get(f'{API}/creators').json()
        assert creators, 'no creators seeded'
        cid = creators[0]['id']
        r = requests.post(f'{API}/extension/heartbeat',
                          json={'creator_id': cid, 'page': 'chat', 'observation_state': 'partial'},
                          headers=ext_headers(ext_token))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['ok'] is True
        assert 'paused' in d and 'shift' in d and 'storage_allowed' in d

    def test_heartbeat_unknown_creator_404(self, ext_token):
        r = requests.post(f'{API}/extension/heartbeat',
                          json={'creator_id': 'nonexistent123', 'page': 'chat'},
                          headers=ext_headers(ext_token))
        assert r.status_code in (403, 404)


# ---------- /api/extension/shifts ----------
class TestExtensionShifts:
    def test_shift_lifecycle(self, ext_token, web_session):
        creators = web_session.get(f'{API}/creators').json()
        cid = creators[0]['id']
        # cleanup: end any active shift for this creator via web
        existing = [s for s in web_session.get(f'{API}/shifts').json() if s['creator_id'] == cid and s.get('active')]
        for s in existing:
            web_session.post(f'{API}/shifts/{s["id"]}/action', json={'action': 'end'})

        r = requests.post(f'{API}/extension/shifts', json={'creator_id': cid}, headers=ext_headers(ext_token))
        assert r.status_code == 201, r.text
        sid = r.json()['id']

        # duplicate must 409
        r2 = requests.post(f'{API}/extension/shifts', json={'creator_id': cid}, headers=ext_headers(ext_token))
        assert r2.status_code == 409

        for action in ['pause', 'resume', 'end']:
            r3 = requests.post(f'{API}/extension/shifts/{sid}/action',
                               json={'action': action}, headers=ext_headers(ext_token))
            assert r3.status_code == 200, f'{action}: {r3.text}'


# ---------- /api/extension/observations ----------
class TestExtensionObservations:
    def test_observations_storage_disabled(self, ext_token, web_session):
        # ensure storage_allowed false
        cfg = web_session.get(f'{API}/auth/me').json()['settings']
        original = cfg['storage_allowed']
        if original:
            web_session.patch(f'{API}/settings', json={**{k: cfg[k] for k in ['agency_name', 'sla_minutes', 'retention_days']}, 'storage_allowed': False})
        creators = web_session.get(f'{API}/creators').json()
        cid = creators[0]['id']
        event = {
            'creator_id': cid,
            'event_ref': 'a' * 64,
            'kind': 'pending',
            'started_at': '2026-01-15T12:00:00+00:00',
        }
        r = requests.post(f'{API}/extension/observations',
                          json={'events': [event]}, headers=ext_headers(ext_token))
        assert r.status_code == 200, r.text
        results = r.json()['results']
        assert results[0]['ok'] is False
        assert 'armazenamento' in (results[0].get('detail') or '').lower() or results[0].get('status') == 409

        # restore
        if original:
            web_session.patch(f'{API}/settings', json={**{k: cfg[k] for k in ['agency_name', 'sla_minutes', 'retention_days']}, 'storage_allowed': True})

    def test_observations_storage_enabled(self, ext_token, web_session):
        cfg = web_session.get(f'{API}/auth/me').json()['settings']
        original = cfg['storage_allowed']
        base = {k: cfg[k] for k in ['agency_name', 'sla_minutes', 'retention_days']}
        web_session.patch(f'{API}/settings', json={**base, 'storage_allowed': True})
        try:
            creators = web_session.get(f'{API}/creators').json()
            cid = creators[0]['id']
            event = {
                'creator_id': cid,
                'event_ref': 'b' * 64,
                'kind': 'pending',
                'started_at': '2026-01-15T12:00:00+00:00',
            }
            r = requests.post(f'{API}/extension/observations',
                              json={'events': [event]}, headers=ext_headers(ext_token))
            assert r.status_code == 200, r.text
            results = r.json()['results']
            # Should succeed OR fail only because turn/review specific — but not because of storage
            assert 'armazenamento' not in (str(results[0].get('detail') or '')).lower()
        finally:
            web_session.patch(f'{API}/settings', json={**base, 'storage_allowed': original})


# ---------- /api/extension/logout ----------
class TestExtensionLogout:
    def test_logout_invalidates_token(self):
        r = requests.post(f'{API}/extension/login',
                          json={'email': TEST_EMAIL, 'password': TEST_PASSWORD, 'device_name': 'QA-Logout'},
                          headers={'Origin': EXT_ORIGIN})
        assert r.status_code == 200
        tok = r.json()['token']
        r2 = requests.post(f'{API}/extension/logout', headers=ext_headers(tok))
        assert r2.status_code == 200
        r3 = requests.get(f'{API}/extension/state', headers=ext_headers(tok))
        assert r3.status_code == 401


# ---------- release & download ----------
class TestExtensionArtifacts:
    def test_release(self):
        r = requests.get(f'{API}/extension/release')
        assert r.status_code == 200
        d = r.json()
        assert 'version' in d and 'api_origin' in d

    def test_download_requires_session(self):
        r = requests.get(f'{API}/extension/download')
        assert r.status_code == 401

    def test_download_zip(self, web_session):
        r = web_session.get(f'{API}/extension/download')
        assert r.status_code == 200
        assert 'zip' in r.headers.get('Content-Type', '').lower()
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
        assert 'manifest.json' in names


# ---------- removed desktop routes ----------
class TestRemovedDesktopRoutes:
    @pytest.mark.parametrize('path', [
        '/desktop/release',
        '/desktop/download/windows',
        '/desktop/pilot/release',
    ])
    def test_desktop_routes_gone(self, path):
        r = requests.get(f'{API}{path}')
        assert r.status_code == 404, f'{path} -> {r.status_code}'


# ---------- regression: web endpoints ----------
class TestWebRegression:
    def test_auth_me(self, web_session):
        r = web_session.get(f'{API}/auth/me')
        assert r.status_code == 200
        assert r.json()['user']['email'] == TEST_EMAIL

    def test_creators_list(self, web_session):
        r = web_session.get(f'{API}/creators')
        assert r.status_code == 200 and isinstance(r.json(), list)

    def test_metrics_manager(self, web_session):
        r = web_session.get(f'{API}/metrics')
        assert r.status_code == 200

    def test_settings_patch_roundtrip(self, web_session):
        cfg = web_session.get(f'{API}/auth/me').json()['settings']
        base = {k: cfg[k] for k in ['agency_name', 'sla_minutes', 'retention_days', 'storage_allowed']}
        r = web_session.patch(f'{API}/settings', json=base)
        assert r.status_code == 200

    def test_shifts_list(self, web_session):
        r = web_session.get(f'{API}/shifts')
        assert r.status_code == 200 and isinstance(r.json(), list)
