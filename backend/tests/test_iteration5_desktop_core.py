import os
import time
import uuid
import hashlib
from pathlib import Path

import pytest
import requests

# Desktop module coverage: release/download manifest, devices RBAC lifecycle, lease authorization/concurrency.


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


def _load_manager_credentials():
    env_path = Path("/root/alta-core-test.env")
    if not env_path.exists():
        pytest.skip("/root/alta-core-test.env not found")
    data = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            data[k.strip()] = v.strip()
    email = data.get("ALTA_TEST_EMAIL")
    password = data.get("ALTA_TEST_PASSWORD")
    if not email or not password:
        pytest.skip("ALTA_TEST_EMAIL/ALTA_TEST_PASSWORD missing")
    return email, password


def _login(email: str, password: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API_BASE}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    me = s.get(f"{API_BASE}/auth/me", timeout=30)
    assert me.status_code == 200, me.text
    return s


@pytest.fixture(scope="module")
def manager_session():
    email, password = _load_manager_credentials()
    return _login(email, password)


@pytest.fixture(scope="module")
def desktop_fixtures(manager_session):
    suffix = uuid.uuid4().hex[:8]
    creator_payload = {
        "name": f"TEMP_TEST_DESKTOP_{suffix}",
        "handle": f"temp_test_desktop_{suffix}",
        "color": "lavender",
    }
    create_creator = manager_session.post(f"{API_BASE}/creators", json=creator_payload, timeout=30)
    assert create_creator.status_code == 201, create_creator.text
    creator = create_creator.json()

    chatter_email = f"desktop.chatter.{suffix}@example.com"
    chatter_password = "DesktopTemp!9xY2"
    create_user = manager_session.post(
        f"{API_BASE}/users",
        json={
            "name": f"TEMP Chatter {suffix}",
            "email": chatter_email,
            "password": chatter_password,
            "role": "chatter",
            "creator_ids": [creator["id"]],
        },
        timeout=30,
    )
    assert create_user.status_code == 201, create_user.text
    chatter = create_user.json()

    chatter_session = _login(chatter_email, chatter_password)
    manager_machine = str(uuid.uuid4())
    chatter_machine = str(uuid.uuid4())

    yield {
        "creator": creator,
        "chatter": chatter,
        "chatter_session": chatter_session,
        "manager_machine": manager_machine,
        "chatter_machine": chatter_machine,
    }

    manager_session.post(f"{API_BASE}/auth/logout", timeout=30)
    chatter_session.post(f"{API_BASE}/auth/logout", timeout=30)

    manager_session = _login(*_load_manager_credentials())
    shifts = manager_session.get(f"{API_BASE}/shifts", timeout=30)
    if shifts.status_code == 200:
        for shift in shifts.json():
            if shift.get("creator_id") == creator["id"] and shift.get("active"):
                manager_session.post(
                    f"{API_BASE}/shifts/{shift['id']}/action",
                    json={"action": "end"},
                    timeout=30,
                )

    devices = manager_session.get(f"{API_BASE}/desktop/devices", timeout=30)
    if devices.status_code == 200:
        for d in devices.json():
            if d.get("user_id") == chatter["id"] and d.get("status") != "revoked":
                manager_session.post(
                    f"{API_BASE}/desktop/devices/{d['id']}/action",
                    json={"action": "revoke"},
                    timeout=30,
                )

    manager_session.patch(
        f"{API_BASE}/users/{chatter['id']}",
        json={
            "active": False,
            "creator_ids": [],
        },
        timeout=30,
    )

    manager_session.delete(
        f"{API_BASE}/creators/{creator['id']}",
        json={"reason": "cleanup TEMP_TEST_DESKTOP"},
        timeout=30,
    )


def test_desktop_release_manifest_contract():
    r = requests.get(f"{API_BASE}/desktop/release", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert data["available"] is True
    assert data["signed"] is False
    assert data["windows_validated"] is False
    assert data["session_sync"] is False
    assert data["monitoring_validated"] is False
    assert data["filename"].endswith(".exe")
    assert data["size_bytes"] > 100_000_000


def test_public_download_windows_stream_and_checksum():
    release = requests.get(f"{API_BASE}/desktop/release", timeout=30).json()
    r = requests.get(f"{API_BASE}/desktop/download/windows", timeout=60, stream=True)
    assert r.status_code == 200
    assert "application/octet-stream" in (r.headers.get("content-type") or "")
    cd = (r.headers.get("content-disposition") or "").lower()
    assert "attachment" in cd and ".exe" in cd
    assert release["filename"].lower() in cd
    assert r.headers.get("x-checksum-sha256") == release["sha256"]
    first = next(r.iter_content(65536))
    assert first[:2] == b"MZ"


def test_manager_and_chatter_device_rbac_and_revoke_stickiness(manager_session, desktop_fixtures):
    chatter_session = desktop_fixtures["chatter_session"]
    manager_machine = desktop_fixtures["manager_machine"]
    chatter_machine = desktop_fixtures["chatter_machine"]

    mgr_register = manager_session.post(
        f"{API_BASE}/desktop/devices/register",
        json={"machine_id": manager_machine, "name": "TEMP Manager Device", "version": "0.2.0"},
        timeout=30,
    )
    assert mgr_register.status_code == 200, mgr_register.text
    mgr_device = mgr_register.json()
    assert mgr_device["status"] == "approved"
    assert "machine_id" not in mgr_device

    chatter_register = chatter_session.post(
        f"{API_BASE}/desktop/devices/register",
        json={"machine_id": chatter_machine, "name": "TEMP Chatter Device", "version": "0.2.0"},
        timeout=30,
    )
    assert chatter_register.status_code == 200, chatter_register.text
    ch_device = chatter_register.json()
    assert ch_device["status"] == "pending"

    chatter_devices = chatter_session.get(f"{API_BASE}/desktop/devices", timeout=30)
    assert chatter_devices.status_code == 200
    chatter_rows = chatter_devices.json()
    assert all(row["user_id"] == desktop_fixtures["chatter"]["id"] for row in chatter_rows)

    chatter_try_approve = chatter_session.post(
        f"{API_BASE}/desktop/devices/{ch_device['id']}/action",
        json={"action": "approve"},
        timeout=30,
    )
    assert chatter_try_approve.status_code == 403

    manager_approve = manager_session.post(
        f"{API_BASE}/desktop/devices/{ch_device['id']}/action",
        json={"action": "approve"},
        timeout=30,
    )
    assert manager_approve.status_code == 200, manager_approve.text
    assert manager_approve.json()["status"] == "approved"

    manager_revoke = manager_session.post(
        f"{API_BASE}/desktop/devices/{ch_device['id']}/action",
        json={"action": "revoke"},
        timeout=30,
    )
    assert manager_revoke.status_code == 200, manager_revoke.text
    assert manager_revoke.json()["status"] == "revoked"

    chatter_reregister = chatter_session.post(
        f"{API_BASE}/desktop/devices/register",
        json={"machine_id": chatter_machine, "name": "TEMP Chatter Device v2", "version": "0.2.1"},
        timeout=30,
    )
    assert chatter_reregister.status_code == 200, chatter_reregister.text
    assert chatter_reregister.json()["status"] == "revoked"


def test_leases_require_approved_device_turn_and_guard_concurrency(manager_session, desktop_fixtures):
    chatter_session = desktop_fixtures["chatter_session"]
    creator_id = desktop_fixtures["creator"]["id"]
    manager_machine = desktop_fixtures["manager_machine"]
    chatter_machine = desktop_fixtures["chatter_machine"]

    manager_lease = manager_session.post(
        f"{API_BASE}/desktop/leases",
        json={"machine_id": manager_machine, "creator_id": creator_id},
        timeout=30,
    )
    assert manager_lease.status_code == 200, manager_lease.text
    manager_lease_json = manager_lease.json()
    assert manager_lease_json["mode"] == "setup"
    assert "session_hash" not in manager_lease_json and "machine_id" not in manager_lease_json

    chatter_without_approved = chatter_session.post(
        f"{API_BASE}/desktop/leases",
        json={"machine_id": chatter_machine, "creator_id": creator_id},
        timeout=30,
    )
    assert chatter_without_approved.status_code == 403

    # Approve chatter device, then guard on existing manager lease.
    chatter_device = next(
        d for d in manager_session.get(f"{API_BASE}/desktop/devices", timeout=30).json()
        if d["user_id"] == desktop_fixtures["chatter"]["id"]
    )
    approve = manager_session.post(
        f"{API_BASE}/desktop/devices/{chatter_device['id']}/action",
        json={"action": "approve"},
        timeout=30,
    )
    assert approve.status_code == 200

    chatter_conflict = chatter_session.post(
        f"{API_BASE}/desktop/leases",
        json={"machine_id": chatter_machine, "creator_id": creator_id},
        timeout=30,
    )
    assert chatter_conflict.status_code == 409

    rel_manager = manager_session.delete(f"{API_BASE}/desktop/leases/{manager_lease_json['id']}", timeout=30)
    assert rel_manager.status_code == 200

    chatter_needs_shift = chatter_session.post(
        f"{API_BASE}/desktop/leases",
        json={"machine_id": chatter_machine, "creator_id": creator_id},
        timeout=30,
    )
    assert chatter_needs_shift.status_code == 409

    start_shift = chatter_session.post(f"{API_BASE}/shifts", json={"creator_id": creator_id}, timeout=30)
    assert start_shift.status_code == 201, start_shift.text
    shift = start_shift.json()

    chatter_lease = chatter_session.post(
        f"{API_BASE}/desktop/leases",
        json={"machine_id": chatter_machine, "creator_id": creator_id},
        timeout=30,
    )
    assert chatter_lease.status_code == 200, chatter_lease.text
    chatter_lease_json = chatter_lease.json()
    assert chatter_lease_json["mode"] == "work"

    manager_blocked = manager_session.post(
        f"{API_BASE}/desktop/leases",
        json={"machine_id": manager_machine, "creator_id": creator_id},
        timeout=30,
    )
    assert manager_blocked.status_code == 409

    pause = chatter_session.post(
        f"{API_BASE}/shifts/{shift['id']}/action",
        json={"action": "pause"},
        timeout=30,
    )
    assert pause.status_code == 200

    chatter_hb_paused = chatter_session.post(
        f"{API_BASE}/desktop/leases/{chatter_lease_json['id']}/heartbeat",
        timeout=30,
    )
    assert chatter_hb_paused.status_code == 409

    end_shift = chatter_session.post(
        f"{API_BASE}/shifts/{shift['id']}/action",
        json={"action": "end"},
        timeout=30,
    )
    assert end_shift.status_code == 200

    chatter_hb_ended = chatter_session.post(
        f"{API_BASE}/desktop/leases/{chatter_lease_json['id']}/heartbeat",
        timeout=30,
    )
    assert chatter_hb_ended.status_code == 409

    # Recreate for revoke/logout/expiry checks.
    start_shift2 = chatter_session.post(f"{API_BASE}/shifts", json={"creator_id": creator_id}, timeout=30)
    assert start_shift2.status_code == 201
    chatter_lease2 = chatter_session.post(
        f"{API_BASE}/desktop/leases",
        json={"machine_id": chatter_machine, "creator_id": creator_id},
        timeout=30,
    )
    assert chatter_lease2.status_code == 200
    lease2 = chatter_lease2.json()

    revoke_again = manager_session.post(
        f"{API_BASE}/desktop/devices/{chatter_device['id']}/action",
        json={"action": "revoke"},
        timeout=30,
    )
    assert revoke_again.status_code == 200

    hb_after_revoke = chatter_session.post(f"{API_BASE}/desktop/leases/{lease2['id']}/heartbeat", timeout=30)
    assert hb_after_revoke.status_code in [403, 409]

    # Approve back and open manager lease, then ensure logout invalidates heartbeat.
    approve_back = manager_session.post(
        f"{API_BASE}/desktop/devices/{chatter_device['id']}/action",
        json={"action": "approve"},
        timeout=30,
    )
    assert approve_back.status_code == 200

    end_shift2 = chatter_session.post(
        f"{API_BASE}/shifts/{start_shift2.json()['id']}/action",
        json={"action": "end"},
        timeout=30,
    )
    assert end_shift2.status_code == 200

    manager_lease2 = manager_session.post(
        f"{API_BASE}/desktop/leases",
        json={"machine_id": manager_machine, "creator_id": creator_id},
        timeout=30,
    )
    assert manager_lease2.status_code == 200
    lease_mgr = manager_lease2.json()

    logout = manager_session.post(f"{API_BASE}/auth/logout", timeout=30)
    assert logout.status_code == 200
    hb_after_logout = manager_session.post(f"{API_BASE}/desktop/leases/{lease_mgr['id']}/heartbeat", timeout=30)
    assert hb_after_logout.status_code == 401


def test_lease_expires_in_45_seconds_without_heartbeat(manager_session, desktop_fixtures):
    creator_id = desktop_fixtures["creator"]["id"]
    manager_machine = desktop_fixtures["manager_machine"]

    relogin = _login(*_load_manager_credentials())
    lease = relogin.post(
        f"{API_BASE}/desktop/leases",
        json={"machine_id": manager_machine, "creator_id": creator_id},
        timeout=30,
    )
    assert lease.status_code == 200, lease.text
    lease_id = lease.json()["id"]

    time.sleep(46)
    hb = relogin.post(f"{API_BASE}/desktop/leases/{lease_id}/heartbeat", timeout=30)
    assert hb.status_code == 409


def test_download_accessible_for_authenticated_chatter(desktop_fixtures):
    chatter_session = desktop_fixtures["chatter_session"]
    release = chatter_session.get(f"{API_BASE}/desktop/release", timeout=30)
    assert release.status_code == 200
    installer = chatter_session.get(f"{API_BASE}/desktop/download/windows", timeout=60, stream=True)
    assert installer.status_code == 200
    chunk = next(installer.iter_content(65536))
    assert chunk[:2] == b"MZ"
