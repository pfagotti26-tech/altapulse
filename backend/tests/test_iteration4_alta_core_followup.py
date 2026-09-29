import io
import os
import zipfile
from pathlib import Path

import pytest
import requests

# Follow-up coverage: manager login, Alta Core branding exports, temporary creator+shift lifecycle, storage state

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API_BASE = f"{BASE_URL.rstrip('/')}/api"


def _load_alta_credentials():
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
        pytest.skip("ALTA_TEST_EMAIL/ALTA_TEST_PASSWORD missing in /root/alta-core-test.env")
    return email, password


@pytest.fixture(scope="module")
def manager_session():
    email, password = _load_alta_credentials()
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})

    login = s.post(
        f"{API_BASE}/auth/login",
        json={"email": email, "password": password},
        timeout=30,
    )
    assert login.status_code == 200, login.text

    me = s.get(f"{API_BASE}/auth/me", timeout=30)
    assert me.status_code == 200, me.text
    return s


@pytest.fixture()
def temporary_creator(manager_session):
    payload = {"name": "TEST_ALTA_BRAND", "handle": "test_alta_brand", "color": "green"}
    create = manager_session.post(f"{API_BASE}/creators", json=payload, timeout=30)
    assert create.status_code == 201, create.text
    creator = create.json()
    yield creator

    active = manager_session.get(f"{API_BASE}/shifts", timeout=30)
    if active.status_code == 200:
        for shift in active.json():
            if shift.get("creator_id") == creator["id"] and shift.get("active"):
                manager_session.post(
                    f"{API_BASE}/shifts/{shift['id']}/action",
                    json={"action": "end"},
                    timeout=30,
                )

    manager_session.delete(
        f"{API_BASE}/creators/{creator['id']}",
        json={"reason": "TEST cleanup temporary creator"},
        timeout=30,
    )


def test_manager_account_is_active_and_alta_workspace(manager_session):
    me = manager_session.get(f"{API_BASE}/auth/me", timeout=30)
    assert me.status_code == 200
    data = me.json()
    assert data["user"]["email"].lower() == "teste@altaagency.com.br"
    assert data["user"]["role"] == "manager"
    assert data["settings"]["agency_name"] == "Alta Agency"


def test_storage_permission_stays_disabled(manager_session):
    settings = manager_session.get(f"{API_BASE}/settings", timeout=30)
    assert settings.status_code == 200
    assert settings.json()["storage_allowed"] is False


def test_temp_creator_shift_lifecycle_and_cleanup(temporary_creator, manager_session):
    creator_id = temporary_creator["id"]

    shift_start = manager_session.post(f"{API_BASE}/shifts", json={"creator_id": creator_id}, timeout=30)
    assert shift_start.status_code == 201, shift_start.text
    shift = shift_start.json()
    assert shift["active"] is True
    assert shift["paused"] is False

    pause = manager_session.post(
        f"{API_BASE}/shifts/{shift['id']}/action",
        json={"action": "pause"},
        timeout=30,
    )
    assert pause.status_code == 200, pause.text

    resume = manager_session.post(
        f"{API_BASE}/shifts/{shift['id']}/action",
        json={"action": "resume"},
        timeout=30,
    )
    assert resume.status_code == 200, resume.text

    end = manager_session.post(
        f"{API_BASE}/shifts/{shift['id']}/action",
        json={"action": "end"},
        timeout=30,
    )
    assert end.status_code == 200, end.text

    shifts = manager_session.get(f"{API_BASE}/shifts", timeout=30)
    assert shifts.status_code == 200
    row = next(x for x in shifts.json() if x["id"] == shift["id"])
    assert row["active"] is False
    assert row["ended_at"] is not None


def test_csv_filename_prefix_is_alta_core(manager_session):
    r = manager_session.get(f"{API_BASE}/reports/export?kind=summary", timeout=30)
    assert r.status_code == 200
    cd = r.headers.get("Content-Disposition", "")
    assert "filename=\"alta-core-summary.csv\"" in cd
    assert r.text.startswith("\ufeff")


def test_station_download_zip_branding_and_integrity(manager_session):
    email, password = _load_alta_credentials()
    r = manager_session.get(f"{API_BASE}/station/download", timeout=30)
    assert r.status_code == 200

    cd = r.headers.get("Content-Disposition", "")
    assert "alta-core-windows.zip" in cd.lower()

    archive = zipfile.ZipFile(io.BytesIO(r.content))
    names = archive.namelist()

    required = {
        "Alta-Core-Windows/agent.py",
        "Alta-Core-Windows/reader.py",
        "Alta-Core-Windows/config.json",
        "Alta-Core-Windows/Instalar.bat",
        "Alta-Core-Windows/Iniciar.bat",
        "Alta-Core-Windows/LEIA-ME.md",
        "Alta-Core-Windows/alta-core-black.png",
        "Alta-Core-Windows/alta-mark-red.png",
    }
    for item in required:
        assert item in names

    for name in names:
        assert name.startswith("Alta-Core-Windows/")

    config_raw = archive.read("Alta-Core-Windows/config.json").decode("utf-8")
    assert "app_url" in config_raw
    assert "privacy_url" in config_raw
    assert password not in config_raw
    assert email not in config_raw


def test_no_fabricated_reviews_for_manager_workspace(manager_session):
    reviews = manager_session.get(f"{API_BASE}/reviews", timeout=30)
    assert reviews.status_code == 200
    assert reviews.json() == []


def test_station_remains_disconnected(manager_session):
    status = manager_session.get(f"{API_BASE}/station/status", timeout=30)
    assert status.status_code == 200
    body = status.json()
    assert body["online"] is False


def test_workspace_metrics_without_fabricated_events(manager_session):
    metrics = manager_session.get(f"{API_BASE}/metrics", timeout=30)
    assert metrics.status_code == 200
    summary = metrics.json()["summary"]
    assert summary["response_count"] in [0, None]
    assert summary["pending_count"] in [0, None]
    assert summary["confirmed_count"] in [0, None]
    assert summary["sales_sample"] == 0
