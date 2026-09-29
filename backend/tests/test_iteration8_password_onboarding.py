import json
import os
import uuid
from pathlib import Path

import pytest
import requests

# Auth onboarding and own-password endpoint coverage: forced first access, validations, lockout, session/token revocation, release contract.


def _base_url():
    value = os.environ.get("REACT_APP_BACKEND_URL")
    if value:
        return value.rstrip("/")
    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    pytest.skip("REACT_APP_BACKEND_URL not available")


BASE_URL = _base_url()
API_BASE = f"{BASE_URL}/api"


def _read_env(path: str):
    env_path = Path(path)
    if not env_path.exists():
        pytest.skip(f"{path} not found")
    data = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            data[key.strip()] = value.strip()
    return data


def _session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(email: str, password: str):
    s = _session()
    r = s.post(f"{API_BASE}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def manager_credentials():
    data = _read_env("/root/alta-core-test.env")
    email = data.get("ALTA_TEST_EMAIL")
    password = data.get("ALTA_TEST_PASSWORD")
    if not email or not password:
        pytest.skip("ALTA_TEST_EMAIL/ALTA_TEST_PASSWORD missing")
    return {"email": email, "password": password}


@pytest.fixture(scope="module")
def real_credentials():
    data = _read_env("/root/alta-manager-onboarding.env")
    required = ["ADMIN_EMAIL", "ADMIN_TEMP_PASSWORD", "FERNANDA_EMAIL", "FERNANDA_TEMP_PASSWORD"]
    if any(not data.get(k) for k in required):
        pytest.skip("Missing real onboarding credentials in /root/alta-manager-onboarding.env")
    return {
        "admin": {"email": data["ADMIN_EMAIL"], "password": data["ADMIN_TEMP_PASSWORD"]},
        "fernanda": {"email": data["FERNANDA_EMAIL"], "password": data["FERNANDA_TEMP_PASSWORD"]},
    }


@pytest.fixture(scope="module")
def manager_session(manager_credentials):
    session = _login(manager_credentials["email"], manager_credentials["password"])
    me = session.get(f"{API_BASE}/auth/me", timeout=30)
    assert me.status_code == 200
    assert me.json()["user"]["email"].lower() == manager_credentials["email"].lower()
    return session


@pytest.fixture(scope="module")
def qa_users(manager_session):
    suffix = uuid.uuid4().hex[:8]
    users = {}

    for key in ["flow", "lock"]:
        email = f"temp.password.qa.{key}.{suffix}@example.com"
        temp_password = "TempPass1234A"
        payload = {
            "name": f"TEMP_PASSWORD_QA_{key}_{suffix}",
            "email": email,
            "password": temp_password,
            "role": "manager",
            "creator_ids": [],
            "temporary_password": True,
        }
        created = manager_session.post(f"{API_BASE}/users", json=payload, timeout=30)
        assert created.status_code == 201, created.text
        body = created.json()
        assert body["must_change_password"] is True
        assert "password_hash" not in body
        users[key] = {
            "id": body["id"],
            "email": email,
            "temp_password": temp_password,
            "new_password_1": "NewPasswordA123",
            "new_password_2": "SecondPassB456",
        }

    yield users

    relog = _login(_read_env("/root/alta-core-test.env")["ALTA_TEST_EMAIL"], _read_env("/root/alta-core-test.env")["ALTA_TEST_PASSWORD"])
    for item in users.values():
        relog.patch(
            f"{API_BASE}/users/{item['id']}",
            json={"active": False, "creator_ids": []},
            timeout=30,
        )


def test_real_requested_accounts_login_me_forced_and_logout_only(real_credentials):
    for account in [real_credentials["admin"], real_credentials["fernanda"]]:
        session = _login(account["email"], account["password"])

        me = session.get(f"{API_BASE}/auth/me", timeout=30)
        assert me.status_code == 200
        me_body = me.json()
        assert me_body["user"]["email"].lower() == account["email"].lower()
        assert me_body["user"]["role"] == "manager"
        assert me_body["user"]["active"] is True
        assert me_body["user"]["must_change_password"] is True

        forbidden = session.get(f"{API_BASE}/creators", timeout=30)
        assert forbidden.status_code == 403

        out = session.post(f"{API_BASE}/auth/logout", timeout=30)
        assert out.status_code == 200
        me_after = session.get(f"{API_BASE}/auth/me", timeout=30)
        assert me_after.status_code == 401


def test_temp_forced_flow_allows_auth_me_and_logout_but_blocks_protected_routes(qa_users):
    flow = qa_users["flow"]
    session = _login(flow["email"], flow["temp_password"])

    me = session.get(f"{API_BASE}/auth/me", timeout=30)
    assert me.status_code == 200
    assert me.json()["user"]["must_change_password"] is True

    creators = session.get(f"{API_BASE}/creators", timeout=30)
    users = session.get(f"{API_BASE}/users", timeout=30)
    ticket = session.post(f"{API_BASE}/desktop/auth/ticket", json={"machine_id": str(uuid.uuid4())}, timeout=30)
    assert creators.status_code == 403
    assert users.status_code == 403
    assert ticket.status_code == 403

    logout = session.post(f"{API_BASE}/auth/logout", timeout=30)
    assert logout.status_code == 200


def test_password_endpoint_validation_and_rejection_cases(qa_users):
    flow = qa_users["flow"]

    anonymous = requests.post(
        f"{API_BASE}/auth/password",
        json={"current_password": "x", "new_password": "Password1234", "confirm_password": "Password1234"},
        timeout=30,
    )
    assert anonymous.status_code == 401

    session = _login(flow["email"], flow["temp_password"])

    wrong_current = session.post(
        f"{API_BASE}/auth/password",
        json={"current_password": "WrongPassword999", "new_password": "Password1234", "confirm_password": "Password1234"},
        timeout=30,
    )
    assert wrong_current.status_code == 400

    session.post(f"{API_BASE}/auth/logout", timeout=30)
    relog_old = _login(flow["email"], flow["temp_password"])
    assert relog_old.get(f"{API_BASE}/auth/me", timeout=30).status_code == 200

    same_old = relog_old.post(
        f"{API_BASE}/auth/password",
        json={
            "current_password": flow["temp_password"],
            "new_password": flow["temp_password"],
            "confirm_password": flow["temp_password"],
        },
        timeout=30,
    )
    assert same_old.status_code == 400

    mismatch = relog_old.post(
        f"{API_BASE}/auth/password",
        json={
            "current_password": flow["temp_password"],
            "new_password": "AnotherPassword123",
            "confirm_password": "AnotherPassword999",
        },
        timeout=30,
    )
    assert mismatch.status_code == 422

    weak = relog_old.post(
        f"{API_BASE}/auth/password",
        json={
            "current_password": flow["temp_password"],
            "new_password": "short",
            "confirm_password": "short",
        },
        timeout=30,
    )
    assert weak.status_code == 422

    leading_space = relog_old.post(
        f"{API_BASE}/auth/password",
        json={
            "current_password": flow["temp_password"],
            "new_password": " Password1234",
            "confirm_password": " Password1234",
        },
        timeout=30,
    )
    assert leading_space.status_code == 422

    extra_field = relog_old.post(
        f"{API_BASE}/auth/password",
        json={
            "current_password": flow["temp_password"],
            "new_password": "Password1234",
            "confirm_password": "Password1234",
            "user_id": "should-not-be-accepted",
        },
        timeout=30,
    )
    assert extra_field.status_code == 422


def test_password_wrong_current_rate_limit_429_on_dedicated_fixture(qa_users):
    lock_user = qa_users["lock"]
    session = _login(lock_user["email"], lock_user["temp_password"])

    statuses = []
    for _ in range(5):
        r = session.post(
            f"{API_BASE}/auth/password",
            json={
                "current_password": "WrongPassword999",
                "new_password": "Password1234",
                "confirm_password": "Password1234",
            },
            timeout=30,
        )
        statuses.append(r.status_code)

    blocked = session.post(
        f"{API_BASE}/auth/password",
        json={
            "current_password": "WrongPassword999",
            "new_password": "Password1234",
            "confirm_password": "Password1234",
        },
        timeout=30,
    )

    assert all(status in [400, 429] for status in statuses)
    assert blocked.status_code == 429


def test_successful_password_change_rotates_session_revokes_others_and_invalidates_native_tokens(qa_users, manager_session):
    flow = qa_users["flow"]
    s_primary = _login(flow["email"], flow["temp_password"])
    s_secondary = _login(flow["email"], flow["temp_password"])

    old_cookie = s_primary.cookies.get("vertice_session")
    changed = s_primary.post(
        f"{API_BASE}/auth/password",
        json={
            "current_password": flow["temp_password"],
            "new_password": flow["new_password_1"],
            "confirm_password": flow["new_password_1"],
        },
        timeout=30,
    )
    assert changed.status_code == 200, changed.text
    changed_body = changed.json()
    assert changed_body["must_change_password"] is False
    assert "password_hash" not in changed_body

    new_cookie = s_primary.cookies.get("vertice_session")
    assert old_cookie and new_cookie and old_cookie != new_cookie

    me_primary = s_primary.get(f"{API_BASE}/auth/me", timeout=30)
    assert me_primary.status_code == 200
    assert me_primary.json()["user"]["must_change_password"] is False
    assert "password_hash" not in json.dumps(me_primary.json())

    me_secondary = s_secondary.get(f"{API_BASE}/auth/me", timeout=30)
    assert me_secondary.status_code == 401

    old_login = requests.post(
        f"{API_BASE}/auth/login",
        json={"email": flow["email"], "password": flow["temp_password"]},
        timeout=30,
    )
    assert old_login.status_code == 401

    s_new = _login(flow["email"], flow["new_password_1"])
    assert s_new.get(f"{API_BASE}/auth/me", timeout=30).status_code == 200

    machine_id = str(uuid.uuid4())
    ticket_resp = s_new.post(f"{API_BASE}/desktop/auth/ticket", json={"machine_id": machine_id}, timeout=30)
    assert ticket_resp.status_code == 200
    ticket = ticket_resp.json()["ticket"]

    exchange = requests.post(
        f"{API_BASE}/desktop/auth/exchange",
        json={"machine_id": machine_id, "ticket": ticket},
        timeout=30,
    )
    assert exchange.status_code == 200
    desktop_token = exchange.json()["token"]

    ticket_resp_2 = s_new.post(f"{API_BASE}/desktop/auth/ticket", json={"machine_id": machine_id}, timeout=30)
    assert ticket_resp_2.status_code == 200
    unused_ticket = ticket_resp_2.json()["ticket"]

    s_new_secondary = _login(flow["email"], flow["new_password_1"])
    changed_again = s_new_secondary.post(
        f"{API_BASE}/auth/password",
        json={
            "current_password": flow["new_password_1"],
            "new_password": flow["new_password_2"],
            "confirm_password": flow["new_password_2"],
        },
        timeout=30,
    )
    assert changed_again.status_code == 200

    stale_session = s_new.get(f"{API_BASE}/auth/me", timeout=30)
    assert stale_session.status_code == 401

    stale_native = requests.post(
        f"{API_BASE}/desktop/devices/register",
        json={"machine_id": machine_id, "name": "TEMP QA Device", "version": "0.2.1"},
        headers={"Authorization": f"Bearer {desktop_token}", "Content-Type": "application/json"},
        timeout=30,
    )
    assert stale_native.status_code == 401

    stale_ticket_exchange = requests.post(
        f"{API_BASE}/desktop/auth/exchange",
        json={"machine_id": machine_id, "ticket": unused_ticket},
        timeout=30,
    )
    assert stale_ticket_exchange.status_code == 401

    old_new_password_login = requests.post(
        f"{API_BASE}/auth/login",
        json={"email": flow["email"], "password": flow["new_password_1"]},
        timeout=30,
    )
    assert old_new_password_login.status_code == 401

    final_login = requests.post(
        f"{API_BASE}/auth/login",
        json={"email": flow["email"], "password": flow["new_password_2"]},
        timeout=30,
    )
    assert final_login.status_code == 200

    unrelated = manager_session.get(f"{API_BASE}/auth/me", timeout=30)
    assert unrelated.status_code == 200


def test_password_change_audit_has_no_password_fields(manager_session, qa_users):
    audit = manager_session.get(f"{API_BASE}/audit", timeout=30)
    if audit.status_code != 200:
        pytest.skip("/api/audit unavailable in this environment")

    flow_user_id = qa_users["flow"]["id"]
    rows = [
        row for row in audit.json()
        if row.get("target") == flow_user_id and "Senha do próprio acesso atualizada" in row.get("action", "")
    ]
    assert rows, "Expected at least one password-change audit row"
    serialized = json.dumps(rows).lower()
    assert "password_hash" not in serialized
    assert "current_password" not in serialized
    assert "new_password" not in serialized
    assert "confirm_password" not in serialized


def test_desktop_release_manifest_unchanged_v021_and_public_download_checksum():
    release = requests.get(f"{API_BASE}/desktop/release", timeout=30)
    assert release.status_code == 200
    body = release.json()
    assert body["available"] is True
    assert body["version"] == "0.2.1"
    assert body["sha256"] == "71f3612df4fae7f0d08805e5805948369792cb4ca5c7bb50eb90e172f64c487a"

    installer = requests.get(f"{API_BASE}/desktop/download/windows", timeout=60, stream=True)
    assert installer.status_code == 200
    assert installer.headers.get("x-checksum-sha256") == body["sha256"]
    first_chunk = next(installer.iter_content(65536))
    assert first_chunk[:2] == b"MZ"
