import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

# Phase 1 regression coverage: auth, creators/users RBAC, shifts, station pairing, synthetic observations, settings/reviews/reports

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL')
assert BASE_URL, 'REACT_APP_BACKEND_URL must be set in environment'
BASE_URL = BASE_URL.rstrip('/')
API_BASE = f"{BASE_URL}/api"

MANAGER = {
    'name': 'Gestor de Validação',
    'agency_name': 'Agência Vértice',
    'email': 'gestor.validacao@example.com',
    'password': 'Vertice!Validacao2026',
}


def _email(prefix='chatter'):
    return f"{prefix}.{uuid.uuid4().hex[:8]}@example.com"


def _creator_name(prefix='TEST_Criadora'):
    return f"{prefix}_{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope='session')
def manager_session():
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json'})

    status = s.get(f"{API_BASE}/auth/status", timeout=20)
    assert status.status_code == 200
    setup_required = status.json().get('setup_required')

    if setup_required:
        r = s.post(f"{API_BASE}/auth/setup", json=MANAGER, timeout=20)
        assert r.status_code == 200
        set_cookie = r.headers.get('set-cookie', '').lower()
        assert 'httponly' in set_cookie
        assert 'secure' in set_cookie
    else:
        r = s.post(
            f"{API_BASE}/auth/login",
            json={'email': MANAGER['email'], 'password': MANAGER['password']},
            timeout=20,
        )
        assert r.status_code == 200

    me = s.get(f"{API_BASE}/auth/me", timeout=20)
    assert me.status_code == 200
    body = me.json()
    assert body['user']['role'] == 'manager'
    return s


@pytest.fixture()
def cleanup_created_creators(manager_session):
    created = []
    yield created
    for creator_id in created:
        manager_session.delete(
            f"{API_BASE}/creators/{creator_id}",
            json={'reason': 'TEST_cleanup_creator'},
            timeout=20,
        )


def test_auth_status_and_duplicate_setup_blocked(manager_session):
    status = manager_session.get(f"{API_BASE}/auth/status", timeout=20)
    assert status.status_code == 200
    assert status.json().get('setup_required') is False

    dup = manager_session.post(f"{API_BASE}/auth/setup", json=MANAGER, timeout=20)
    assert dup.status_code == 409
    assert 'gestor inicial' in dup.json().get('detail', '').lower()


def test_logout_and_login_persists_secure_cookie(manager_session):
    out = manager_session.post(f"{API_BASE}/auth/logout", timeout=20)
    assert out.status_code == 200

    me_after = manager_session.get(f"{API_BASE}/auth/me", timeout=20)
    assert me_after.status_code == 401

    login = manager_session.post(
        f"{API_BASE}/auth/login",
        json={'email': MANAGER['email'], 'password': MANAGER['password']},
        timeout=20,
    )
    assert login.status_code == 200
    set_cookie = login.headers.get('set-cookie', '').lower()
    assert 'httponly' in set_cookie
    assert 'secure' in set_cookie

    me = manager_session.get(f"{API_BASE}/auth/me", timeout=20)
    assert me.status_code == 200


def test_creator_crud_and_shift_lifecycle(manager_session, cleanup_created_creators):
    creator = {'name': _creator_name(), 'handle': 'test_handle', 'color': 'green'}
    create = manager_session.post(f"{API_BASE}/creators", json=creator, timeout=20)
    assert create.status_code == 201
    c = create.json()
    cleanup_created_creators.append(c['id'])
    assert c['name'] == creator['name']

    get_all = manager_session.get(f"{API_BASE}/creators", timeout=20)
    assert get_all.status_code == 200
    rows = get_all.json()
    current = next(x for x in rows if x['id'] == c['id'])
    assert current['shift'] is None

    shift = manager_session.post(f"{API_BASE}/shifts", json={'creator_id': c['id']}, timeout=20)
    assert shift.status_code == 201
    s = shift.json()
    assert s['active'] is True

    dup = manager_session.post(f"{API_BASE}/shifts", json={'creator_id': c['id']}, timeout=20)
    assert dup.status_code == 409

    pause = manager_session.post(f"{API_BASE}/shifts/{s['id']}/action", json={'action': 'pause'}, timeout=20)
    assert pause.status_code == 200

    resume = manager_session.post(f"{API_BASE}/shifts/{s['id']}/action", json={'action': 'resume'}, timeout=20)
    assert resume.status_code == 200

    end = manager_session.post(f"{API_BASE}/shifts/{s['id']}/action", json={'action': 'end'}, timeout=20)
    assert end.status_code == 200

    all_shifts = manager_session.get(f"{API_BASE}/shifts", timeout=20)
    assert all_shifts.status_code == 200
    ended = next(x for x in all_shifts.json() if x['id'] == s['id'])
    assert ended['active'] is False
    assert ended['ended_at'] is not None


def test_operator_rbac_visibility_and_manager_endpoint_block(manager_session, cleanup_created_creators):
    c1 = manager_session.post(
        f"{API_BASE}/creators",
        json={'name': _creator_name('TEST_Visible'), 'handle': 'v1', 'color': 'blue'},
        timeout=20,
    )
    c2 = manager_session.post(
        f"{API_BASE}/creators",
        json={'name': _creator_name('TEST_Hidden'), 'handle': 'h1', 'color': 'rose'},
        timeout=20,
    )
    assert c1.status_code == 201 and c2.status_code == 201
    creator1 = c1.json()['id']
    creator2 = c2.json()['id']
    cleanup_created_creators.extend([creator1, creator2])

    chatter_email = _email()
    user_payload = {
        'name': 'TEST Chatter RBAC',
        'email': chatter_email,
        'password': 'Vertice!Validacao2026',
        'role': 'chatter',
        'creator_ids': [creator1],
    }
    new_user = manager_session.post(f"{API_BASE}/users", json=user_payload, timeout=20)
    assert new_user.status_code == 201
    user_id = new_user.json()['id']

    chatter = requests.Session()
    chatter.headers.update({'Content-Type': 'application/json'})
    login = chatter.post(
        f"{API_BASE}/auth/login",
        json={'email': chatter_email, 'password': user_payload['password']},
        timeout=20,
    )
    assert login.status_code == 200

    creators = chatter.get(f"{API_BASE}/creators", timeout=20)
    assert creators.status_code == 200
    ids = [x['id'] for x in creators.json()]
    assert creator1 in ids
    assert creator2 not in ids

    forbidden = chatter.get(f"{API_BASE}/users", timeout=20)
    assert forbidden.status_code == 403

    deactivate = manager_session.patch(
        f"{API_BASE}/users/{user_id}",
        json={'creator_ids': [creator1], 'active': False},
        timeout=20,
    )
    assert deactivate.status_code == 200


def test_station_pairing_heartbeat_commands_and_open_browser_flow(manager_session, cleanup_created_creators):
    manager_session.post(f"{API_BASE}/station/revoke", timeout=20)
    create = manager_session.post(
        f"{API_BASE}/creators",
        json={'name': _creator_name('TEST_Station'), 'handle': 'st1', 'color': 'amber'},
        timeout=20,
    )
    assert create.status_code == 201
    creator_id = create.json()['id']
    cleanup_created_creators.append(creator_id)

    no_station = manager_session.post(f"{API_BASE}/creators/{creator_id}/browser", timeout=20)
    assert no_station.status_code == 409

    pairing = manager_session.post(f"{API_BASE}/station/pairing", timeout=20)
    assert pairing.status_code == 200
    code = pairing.json()['code']
    assert pairing.json()['expires_in'] == 600

    agent_pair = requests.post(
        f"{API_BASE}/agent/pair",
        json={'code': code, 'name': 'TEST Station Agent'},
        timeout=20,
    )
    assert agent_pair.status_code == 200
    token = agent_pair.json()['token']
    assert isinstance(token, str) and len(token) > 20

    agent_reuse = requests.post(
        f"{API_BASE}/agent/pair",
        json={'code': code, 'name': 'TEST Station Agent'},
        timeout=20,
    )
    assert agent_reuse.status_code == 401

    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    hb = requests.post(
        f"{API_BASE}/agent/heartbeat",
        json={'browsers': [{'creator_id': creator_id, 'state': 'closed', 'observation_state': 'validation_required'}]},
        headers=headers,
        timeout=20,
    )
    assert hb.status_code == 200
    assert hb.json()['ok'] is True

    command = manager_session.post(f"{API_BASE}/creators/{creator_id}/browser", timeout=20)
    assert command.status_code == 200
    cmd_id = command.json()['command_id']

    commands = requests.get(f"{API_BASE}/agent/commands", headers=headers, timeout=20)
    assert commands.status_code == 200
    rows = commands.json()
    assert any(c['id'] == cmd_id for c in rows)

    ack = requests.post(
        f"{API_BASE}/agent/commands/{cmd_id}/ack",
        json={'success': True, 'detail': 'opened'},
        headers=headers,
        timeout=20,
    )
    assert ack.status_code == 200


def test_storage_observations_metrics_and_retention_bounds(manager_session, cleanup_created_creators):
    creator = manager_session.post(
        f"{API_BASE}/creators",
        json={'name': _creator_name('TEST_Metric'), 'handle': 'mt1', 'color': 'lavender'},
        timeout=20,
    )
    assert creator.status_code == 201
    creator_id = creator.json()['id']
    cleanup_created_creators.append(creator_id)

    settings = manager_session.get(f"{API_BASE}/settings", timeout=20)
    assert settings.status_code == 200
    cfg = settings.json()
    patch = manager_session.patch(
        f"{API_BASE}/settings",
        json={
            'agency_name': cfg['agency_name'],
            'sla_minutes': cfg['sla_minutes'],
            'retention_days': min(cfg['retention_days'], 90),
            'storage_allowed': True,
        },
        timeout=20,
    )
    assert patch.status_code == 200
    assert patch.json()['storage_allowed'] is True

    pairing = manager_session.post(f"{API_BASE}/station/pairing", timeout=20)
    assert pairing.status_code == 200
    token = requests.post(
        f"{API_BASE}/agent/pair",
        json={'code': pairing.json()['code'], 'name': 'TEST Metric Agent'},
        timeout=20,
    ).json()['token']
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

    shift = manager_session.post(f"{API_BASE}/shifts", json={'creator_id': creator_id}, timeout=20)
    assert shift.status_code == 201

    hb = requests.post(
        f"{API_BASE}/agent/heartbeat",
        json={'browsers': [{'creator_id': creator_id, 'state': 'open', 'observation_state': 'partial'}]},
        headers=headers,
        timeout=20,
    )
    assert hb.status_code == 200

    started = datetime.now(timezone.utc) - timedelta(minutes=4)
    responded = started + timedelta(seconds=140)
    event_ref = uuid.uuid4().hex + uuid.uuid4().hex

    pending = requests.post(
        f"{API_BASE}/agent/observations",
        json={
            'creator_id': creator_id,
            'event_ref': event_ref,
            'kind': 'pending',
            'started_at': started.isoformat(),
            'sequence_complete': True,
        },
        headers=headers,
        timeout=20,
    )
    assert pending.status_code == 200

    response = requests.post(
        f"{API_BASE}/agent/observations",
        json={
            'creator_id': creator_id,
            'event_ref': event_ref,
            'kind': 'response',
            'started_at': started.isoformat(),
            'responded_at': responded.isoformat(),
            'sequence_complete': True,
        },
        headers=headers,
        timeout=20,
    )
    assert response.status_code == 200

    regression = requests.post(
        f"{API_BASE}/agent/observations",
        json={
            'creator_id': creator_id,
            'event_ref': event_ref,
            'kind': 'pending',
            'started_at': started.isoformat(),
            'sequence_complete': True,
        },
        headers=headers,
        timeout=20,
    )
    assert regression.status_code == 200
    assert regression.json().get('deduplicated') is True

    sale_ref = (uuid.uuid4().hex + uuid.uuid4().hex)[:64]
    confirmed_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    sale = requests.post(
        f"{API_BASE}/agent/observations",
        json={
            'creator_id': creator_id,
            'event_ref': sale_ref,
            'kind': 'sale',
            'amount_cents': 12500,
            'sale_status': 'confirmed',
            'sale_origin': 'chat',
            'confirmed_at': confirmed_at,
        },
        headers=headers,
        timeout=20,
    )
    assert sale.status_code == 200

    metrics = manager_session.get(f"{API_BASE}/metrics", timeout=20)
    assert metrics.status_code == 200
    m = metrics.json()
    assert m['summary']['response_count'] >= 1
    assert m['summary']['sales_sample'] >= 1

    bad_retention = manager_session.patch(
        f"{API_BASE}/settings",
        json={
            'agency_name': cfg['agency_name'],
            'sla_minutes': cfg['sla_minutes'],
            'retention_days': 91,
            'storage_allowed': True,
        },
        timeout=20,
    )
    assert bad_retention.status_code == 422

    end_shift = manager_session.post(
        f"{API_BASE}/shifts/{shift.json()['id']}/action",
        json={'action': 'end'},
        timeout=20,
    )
    assert end_shift.status_code == 200


def test_review_requires_paused_shift_and_browser_open(manager_session, cleanup_created_creators):
    creator = manager_session.post(
        f"{API_BASE}/creators",
        json={'name': _creator_name('TEST_Review'), 'handle': 'rv1', 'color': 'green'},
        timeout=20,
    )
    assert creator.status_code == 201
    creator_id = creator.json()['id']
    cleanup_created_creators.append(creator_id)

    shift = manager_session.post(f"{API_BASE}/shifts", json={'creator_id': creator_id}, timeout=20)
    assert shift.status_code == 201
    shift_id = shift.json()['id']

    fail_without_pause = manager_session.post(
        f"{API_BASE}/creators/{creator_id}/review/start",
        json={'acknowledge_read': True},
        timeout=20,
    )
    assert fail_without_pause.status_code == 409

    manager_session.post(f"{API_BASE}/shifts/{shift_id}/action", json={'action': 'pause'}, timeout=20)

    fail_without_browser = manager_session.post(
        f"{API_BASE}/creators/{creator_id}/review/start",
        json={'acknowledge_read': True},
        timeout=20,
    )
    assert fail_without_browser.status_code == 409

    pairing = manager_session.post(f"{API_BASE}/station/pairing", timeout=20)
    token = requests.post(
        f"{API_BASE}/agent/pair",
        json={'code': pairing.json()['code'], 'name': 'TEST Review Agent'},
        timeout=20,
    ).json()['token']
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

    hb = requests.post(
        f"{API_BASE}/agent/heartbeat",
        json={'browsers': [{'creator_id': creator_id, 'state': 'open', 'observation_state': 'partial'}]},
        headers=headers,
        timeout=20,
    )
    assert hb.status_code == 200

    begin = manager_session.post(
        f"{API_BASE}/creators/{creator_id}/review/start",
        json={'acknowledge_read': True},
        timeout=20,
    )
    assert begin.status_code == 200
    review_id = begin.json()['id']

    save = manager_session.post(
        f"{API_BASE}/reviews",
        json={
            'creator_id': creator_id,
            'review_session_id': review_id,
            'answers': {
                'resposta': 'adequado',
                'continuidade': 'atencao',
                'clareza': 'adequado',
                'orientacoes': 'nao_avaliavel',
                'acompanhamento': 'adequado',
            },
        },
        timeout=20,
    )

    if save.status_code == 409:
        cfg = manager_session.get(f"{API_BASE}/settings", timeout=20).json()
        manager_session.patch(
            f"{API_BASE}/settings",
            json={
                'agency_name': cfg['agency_name'],
                'sla_minutes': cfg['sla_minutes'],
                'retention_days': cfg['retention_days'],
                'storage_allowed': True,
            },
            timeout=20,
        )
        save = manager_session.post(
            f"{API_BASE}/reviews",
            json={
                'creator_id': creator_id,
                'review_session_id': review_id,
                'answers': {
                    'resposta': 'adequado',
                    'continuidade': 'atencao',
                    'clareza': 'adequado',
                    'orientacoes': 'nao_avaliavel',
                    'acompanhamento': 'adequado',
                },
            },
            timeout=20,
        )

    assert save.status_code == 201

    end_review = manager_session.post(f"{API_BASE}/creators/{creator_id}/review/end", timeout=20)
    assert end_review.status_code == 200

    keep_paused = manager_session.get(f"{API_BASE}/shifts", timeout=20)
    row = next(x for x in keep_paused.json() if x['id'] == shift_id)
    assert row['paused'] is True


def test_csv_exports_have_utf8_bom_and_formula_protection(manager_session):
    kinds = ['summary', 'sales', 'reviews', 'audit']
    for kind in kinds:
        r = manager_session.get(f"{API_BASE}/reports/export?kind={kind}", timeout=20)
        assert r.status_code == 200
        assert r.text.startswith('\ufeff')

    injection_creator = {
        'name': '=HYPERLINK("http://x")',
        'handle': '@danger',
        'color': 'green',
    }
    created = manager_session.post(f"{API_BASE}/creators", json=injection_creator, timeout=20)
    assert created.status_code == 201
    cid = created.json()['id']

    try:
        sales_csv = manager_session.get(f"{API_BASE}/reports/export?kind=sales", timeout=20)
        assert sales_csv.status_code == 200
        assert '\ufeff' in sales_csv.text[:1]
    finally:
        manager_session.delete(f"{API_BASE}/creators/{cid}", json={'reason': 'TEST_cleanup_formula'}, timeout=20)