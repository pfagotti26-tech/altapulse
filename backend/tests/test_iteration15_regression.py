"""Regression tests - iteration 15:
- /api/health stability (sanity + no restart loop)
- 520 guard: /api/extension/release returns 200 with version
- /api/desktop/release consistency on 1.4.19
- Alta Auto new routes auth guard (401 without token, 403 without 'plantao' permission)
"""
import os
import re
import time
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://privacy-agent-hub.preview.emergentagent.com').rstrip('/')
TEST_EMAIL = 'teste@altaagency.com.br'
TEST_PASSWORD = 'AltaCore!7mK9q2R5'


@pytest.fixture(scope='module')
def extension_token():
    r = requests.post(f'{BASE_URL}/api/extension/login',
                      json={'email': TEST_EMAIL, 'password': TEST_PASSWORD, 'device_name': 'QA-Regression'},
                      timeout=20)
    assert r.status_code == 200, f'Extension login failed: {r.status_code} {r.text[:300]}'
    data = r.json()
    assert 'token' in data
    return data['token']


# --- Health & 520 guard stability ---
class TestHealthAnd520Guard:
    def test_health_endpoint(self):
        r = requests.get(f'{BASE_URL}/api/health', timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data == {'status': 'ok', 'product': 'Alta Pulse'}

    def test_extension_release_has_version(self):
        r = requests.get(f'{BASE_URL}/api/extension/release', timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert 'version' in data
        assert isinstance(data['version'], str)
        # expected '1.1.2' per request
        assert data['version'] == '1.1.2', f"expected 1.1.2 got {data['version']}"

    def test_health_stable_over_time(self):
        """Hit /api/health 6 times across ~6s. Backend must not crash/restart loop."""
        for i in range(6):
            r = requests.get(f'{BASE_URL}/api/health', timeout=10)
            assert r.status_code == 200, f'iter {i} failed: {r.status_code}'
            time.sleep(1)


# --- Desktop release consistency ---
class TestDesktopRelease:
    def test_desktop_release_versions_all_1_4_19(self):
        r = requests.get(f'{BASE_URL}/api/desktop/release', timeout=15)
        assert r.status_code == 200
        data = r.json()
        installer = data.get('installer') or {}
        asar = data.get('asar') or {}
        portable = data.get('portable') or {}

        inst_ver = installer.get('version')
        asar_ver = asar.get('version')
        port_ver = portable.get('version')

        # All three should be present and equal 1.4.19
        assert inst_ver == '1.4.19', f'installer version is {inst_ver}'
        assert asar_ver == '1.4.19', f'asar version is {asar_ver}'
        assert port_ver == '1.4.19', f'portable version is {port_ver}'
        # No 1.4.20 leakage anywhere
        body_str = r.text
        assert '1.4.20' not in body_str, 'Unexpected 1.4.20 reference in /api/desktop/release'


# --- Alta Auto new routes: auth guard ---
class TestAltaAutoAuthGuard:
    def test_plantao_reply_requires_auth(self):
        r = requests.post(f'{BASE_URL}/api/extension/plantao/reply', json={}, timeout=10)
        assert r.status_code == 401, f'expected 401 got {r.status_code}: {r.text[:200]}'

    def test_plantao_opener_requires_auth(self):
        r = requests.post(f'{BASE_URL}/api/extension/plantao/opener', json={}, timeout=10)
        assert r.status_code == 401, f'expected 401 got {r.status_code}: {r.text[:200]}'

    def test_plantao_get_without_permission_returns_403(self, extension_token):
        headers = {'Authorization': f'Bearer {extension_token}'}
        r = requests.get(f'{BASE_URL}/api/extension/plantao', headers=headers, timeout=15)
        assert r.status_code == 403, f'expected 403 got {r.status_code}: {r.text[:300]}'
        # must not be 500
        try:
            data = r.json()
            # mensagem esperada contém "Sem permissão para o plantão." ou similar
            msg = (data.get('detail') or data.get('message') or '').lower()
            assert 'permiss' in msg or 'plantao' in msg or 'plantão' in msg, f'unexpected detail: {data}'
        except Exception:
            pass

    def test_plantao_reply_without_permission_returns_403(self, extension_token):
        headers = {'Authorization': f'Bearer {extension_token}'}
        r = requests.post(f'{BASE_URL}/api/extension/plantao/reply', headers=headers, json={}, timeout=15)
        assert r.status_code == 403, f'expected 403 got {r.status_code}: {r.text[:300]}'
        assert r.status_code != 500

    def test_plantao_opener_without_permission_returns_403(self, extension_token):
        headers = {'Authorization': f'Bearer {extension_token}'}
        r = requests.post(f'{BASE_URL}/api/extension/plantao/opener', headers=headers, json={}, timeout=15)
        assert r.status_code == 403, f'expected 403 got {r.status_code}: {r.text[:300]}'
        assert r.status_code != 500
