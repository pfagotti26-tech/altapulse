import hashlib
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

import pytest
import requests

# Iteration 12: Chrome pilot release/authz contracts, artifact integrity, and synthetic host/controller checks.

ROOT = Path("/app")
PILOT_DIR = ROOT / "desktop" / "pilot"
PILOT_RELEASE = PILOT_DIR / "release"
PROD_RELEASE = ROOT / "desktop" / "release"


def _frontend_base_url() -> str:
    value = os.environ.get("REACT_APP_BACKEND_URL")
    if value:
        return value.rstrip("/")
    env_file = ROOT / "frontend/.env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    pytest.skip("REACT_APP_BACKEND_URL missing")


def _load_env_credentials():
    env_file = Path("/root/alta-core-test.env")
    if not env_file.exists():
        pytest.skip("/root/alta-core-test.env missing")

    data = {}
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            data[key.strip()] = value.strip()

    email = data.get("ALTA_TEST_EMAIL")
    password = data.get("ALTA_TEST_PASSWORD")
    if not email or not password:
        pytest.skip("ALTA_TEST_EMAIL/ALTA_TEST_PASSWORD missing")
    return email, password


BASE_URL = _frontend_base_url()
API_BASE = f"{BASE_URL}/api"


def _manager_session() -> requests.Session:
    email, password = _load_env_credentials()
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    login = session.post(
        f"{API_BASE}/auth/login",
        json={"email": email, "password": password},
        timeout=30,
    )
    assert login.status_code == 200, login.text

    me = session.get(f"{API_BASE}/auth/me", timeout=30)
    assert me.status_code == 200, me.text
    return session


def _sha256_stream(response: requests.Response):
    hasher = hashlib.sha256()
    total = 0
    first_chunk = b""
    for chunk in response.iter_content(1024 * 1024):
        if not chunk:
            continue
        if not first_chunk:
            first_chunk = chunk
        hasher.update(chunk)
        total += len(chunk)
    return hasher.hexdigest(), total, first_chunk


@pytest.fixture(scope="module")
def manager_session():
    return _manager_session()


@pytest.fixture(scope="module")
def chatter_session(manager_session):
    email = f"TEMP_CHROME_PILOT_QA_{int(time.time())}@example.com".lower()
    password = "TempPass1234"
    create_payload = {
        "name": "TEMP Chrome Pilot QA",
        "email": email,
        "password": password,
        "role": "chatter",
        "creator_ids": [],
        "temporary_password": False,
    }
    create = manager_session.post(f"{API_BASE}/users", json=create_payload, timeout=30)
    assert create.status_code == 201, create.text
    chatter_id = create.json()["id"]

    chatter = requests.Session()
    chatter.headers.update({"Content-Type": "application/json"})
    login = chatter.post(
        f"{API_BASE}/auth/login",
        json={"email": email, "password": password},
        timeout=30,
    )
    assert login.status_code == 200, login.text

    yield chatter

    manager_session.patch(
        f"{API_BASE}/users/{chatter_id}",
        json={"creator_ids": [], "active": False},
        timeout=30,
    )


def test_pilot_build_manifest_ready_before_contract_checks():
    manifest_file = PILOT_RELEASE / "manifest.json"
    assert manifest_file.exists() is True

    data = json.loads(manifest_file.read_text(encoding="utf-8"))
    assert data["version"] == "0.3.0"
    assert data["filename"] == "Alta-Pulse-Chrome-Pilot-0.3.0-Setup-x64.exe"
    assert isinstance(data["sha256"], str)
    assert len(data["sha256"]) == 64


def test_production_release_contract_unchanged_022_and_hash():
    response = requests.get(f"{API_BASE}/desktop/release", timeout=30)
    assert response.status_code == 200

    data = response.json()
    assert data["available"] is True
    assert data["version"] == "0.2.2"
    assert data["filename"] == "Alta-Pulse-0.2.2-Setup-x64.exe"
    assert data["sha256"] == "d8277227bdca75fe87e1e9cb9f0e77e6dc26d5e2adaf7536f5f621bc1e2ecb41"

    local_manifest = json.loads((PROD_RELEASE / "manifest.json").read_text(encoding="utf-8"))
    assert local_manifest["sha256"] == data["sha256"]


def test_pilot_release_authz_matrix_anonymous_chatter_manager(manager_session, chatter_session):
    anonymous_release = requests.get(f"{API_BASE}/desktop/pilot/release", timeout=30)
    anonymous_download = requests.get(f"{API_BASE}/desktop/pilot/download/windows", timeout=30)
    assert anonymous_release.status_code == 401
    assert anonymous_download.status_code == 401

    chatter_release = chatter_session.get(f"{API_BASE}/desktop/pilot/release", timeout=30)
    chatter_download = chatter_session.get(f"{API_BASE}/desktop/pilot/download/windows", timeout=30)
    assert chatter_release.status_code == 403
    assert chatter_download.status_code == 403

    manager_release = manager_session.get(f"{API_BASE}/desktop/pilot/release", timeout=30)
    manager_download = manager_session.get(f"{API_BASE}/desktop/pilot/download/windows", stream=True, timeout=30)
    assert manager_release.status_code == 200
    assert manager_download.status_code == 200


def test_pilot_download_matches_manifest_checksum_size_and_headers(manager_session):
    release_response = manager_session.get(f"{API_BASE}/desktop/pilot/release", timeout=30)
    assert release_response.status_code == 200
    meta = release_response.json()
    assert meta["available"] is True

    download = manager_session.get(f"{API_BASE}/desktop/pilot/download/windows", stream=True, timeout=360)
    assert download.status_code == 200
    assert "application/octet-stream" in (download.headers.get("content-type") or "")
    assert download.headers.get("X-Checksum-SHA256") == meta["sha256"]

    disposition = download.headers.get("content-disposition", "").lower()
    assert "attachment" in disposition
    assert meta["filename"].lower() in disposition

    content_length = int(download.headers.get("content-length", "0"))
    assert content_length == meta["size_bytes"]

    digest, total, first_chunk = _sha256_stream(download)
    assert first_chunk[:2] == b"MZ"
    assert total == meta["size_bytes"]
    assert digest == meta["sha256"]


def test_pilot_archive_integrity_and_expected_win64_payload(manager_session):
    release = manager_session.get(f"{API_BASE}/desktop/pilot/release", timeout=30).json()
    installer = PILOT_RELEASE / release["filename"]
    assert installer.exists() is True
    assert installer.stat().st_size == release["size_bytes"]

    hash_local = hashlib.sha256(installer.read_bytes()).hexdigest()
    assert hash_local == release["sha256"]

    archive_test = subprocess.run(
        ["7z", "t", str(installer)], capture_output=True, text=True, check=False
    )
    assert archive_test.returncode == 0, archive_test.stdout + archive_test.stderr
    assert "Everything is Ok" in (archive_test.stdout + archive_test.stderr)

    with tempfile.TemporaryDirectory(prefix="iter12_pilot_extract_") as tmp_dir:
        extract = subprocess.run(
            ["7z", "x", str(installer), f"-o{tmp_dir}", "-y"],
            capture_output=True,
            text=True,
            check=False,
        )
        assert extract.returncode == 0, extract.stdout + extract.stderr

        root = Path(tmp_dir)
        pilot_exe = list(root.rglob("AltaPulseChromePilot.exe"))
        helper_exe = list(root.rglob("chrome-host.exe"))
        assert pilot_exe, "AltaPulseChromePilot.exe not found in payload"
        assert helper_exe, "resources/chrome-host.exe not found in payload"

        pilot_file = subprocess.run(["file", str(pilot_exe[0])], capture_output=True, text=True, check=False)
        helper_file = subprocess.run(["file", str(helper_exe[0])], capture_output=True, text=True, check=False)
        assert pilot_file.returncode == 0
        assert helper_file.returncode == 0
        assert "PE32+ executable (GUI) x86-64" in pilot_file.stdout
        assert "PE32+ executable (console) x86-64" in helper_file.stdout


def test_helper_imports_do_not_depend_on_mingw_runtime_dlls():
    helper = PILOT_DIR / "native" / "chrome-host.exe"
    assert helper.exists() is True

    dump = subprocess.run(
        ["x86_64-w64-mingw32-objdump", "-p", str(helper)],
        capture_output=True,
        text=True,
        check=False,
    )
    if dump.returncode != 0:
        pytest.skip("objdump unavailable for import analysis in this runtime")

    lowered = dump.stdout.lower()
    assert "libstdc++-6.dll" not in lowered
    assert "libgcc_s_seh-1.dll" not in lowered
    assert "libwinpthread-1.dll" not in lowered

    import_lines = [line.strip().split(":", 1)[1].strip().lower() for line in dump.stdout.splitlines() if "DLL Name:" in line]
    assert import_lines, "No DLL imports found in helper analysis"
    disallowed_non_windows = [name for name in import_lines if not name.endswith(".dll")]
    assert disallowed_non_windows == []

    expected_core_imports = ["kernel32.dll", "user32.dll", "shell32.dll", "ole32.dll", "crypt32.dll", "wintrust.dll"]
    for dll in expected_core_imports:
        assert dll in import_lines

    # msvcrt.dll is a native Windows runtime DLL and acceptable for PE executables.
    for dll in import_lines:
        assert "libstdc++" not in dll
        assert "winpthread" not in dll


def test_native_helper_and_installer_contracts_present_in_source():
    helper_source = (PILOT_DIR / "native/chrome_host.cpp").read_text(encoding="utf-8")
    installer_source = (PILOT_DIR / "installer.nsi").read_text(encoding="utf-8")
    main_source = (PILOT_DIR / "main.cjs").read_text(encoding="utf-8")

    assert "verifyGoogleChrome" in helper_source
    assert "WTD_CACHE_ONLY_URL_RETRIEVAL" in helper_source
    assert "IsProcessInJob" in helper_source
    assert "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE" in helper_source
    assert "quoteArgument" in helper_source
    assert "if (line.size() > 128 || !command(line))" in helper_source
    assert "--user-data-dir=" in helper_source
    assert "--app=" in helper_source
    assert "SetParent(chromeWindow, hostWindow)" in helper_source
    assert "MessageBox MB_ICONSTOP \"Escolha uma pasta nova e exclusiva do piloto." in installer_source
    assert "!include \"uninstall-files.nsh\"" in installer_source
    assert "pathname !== `/navegador/${creatorId}`" in main_source


def test_node_synthetic_contracts_for_host_protocol_and_controller():
    node = Path("/app/desktop-tools/node-v22.23.3-linux-arm64/bin/node")
    if not node.exists():
        node = Path("node")

    script = ROOT / "backend/tests/js_chrome_pilot_contract_check.cjs"
    result = subprocess.run([str(node), str(script)], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "ok: chrome pilot synthetic contracts" in result.stdout
