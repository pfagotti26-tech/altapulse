import hashlib
import io
import os
import subprocess
import tempfile
import zipfile
from pathlib import Path

import pytest
import requests

# Release 0.2.2 checks: public desktop endpoints, binary integrity, NSIS payload and legacy ZIP branding.


def _frontend_base_url() -> str:
    value = os.environ.get("REACT_APP_BACKEND_URL")
    if value:
        return value.rstrip("/")

    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")

    pytest.skip("REACT_APP_BACKEND_URL missing")


BASE_URL = _frontend_base_url()
API_BASE = f"{BASE_URL}/api"
RELEASE_DIR = Path("/app/desktop/release")


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


def _load_manager_credentials():
    env_path = Path("/root/alta-core-test.env")
    if not env_path.exists():
        pytest.skip("/root/alta-core-test.env not found")

    data = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            data[key.strip()] = value.strip()

    email = data.get("ALTA_TEST_EMAIL")
    password = data.get("ALTA_TEST_PASSWORD")
    if not email or not password:
        pytest.skip("ALTA_TEST_EMAIL/ALTA_TEST_PASSWORD missing")
    return email, password


def _manager_session() -> requests.Session:
    email, password = _load_manager_credentials()
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


def test_release_contract_public_endpoint_matches_022_values():
    response = requests.get(f"{API_BASE}/desktop/release", timeout=30)
    assert response.status_code == 200

    data = response.json()
    assert data["available"] is True
    assert data["version"] == "0.2.2"
    assert data["filename"] == "Alta-Pulse-0.2.2-Setup-x64.exe"
    assert data["product_name"] == "Alta Pulse"
    assert data["size_bytes"] == 114903998
    assert data["sha256"] == "d8277227bdca75fe87e1e9cb9f0e77e6dc26d5e2adaf7536f5f621bc1e2ecb41"
    assert data["signed"] is False
    assert data["windows_validated"] is False
    assert data["session_sync"] is False
    assert data["monitoring_validated"] is False


def test_public_windows_download_matches_manifest_checksum_size_and_headers():
    release = requests.get(f"{API_BASE}/desktop/release", timeout=30)
    assert release.status_code == 200
    meta = release.json()

    download = requests.get(f"{API_BASE}/desktop/download/windows", stream=True, timeout=300)
    assert download.status_code == 200
    assert "application/octet-stream" in (download.headers.get("content-type") or "")
    assert download.headers.get("X-Checksum-SHA256") == meta["sha256"]

    disposition = download.headers.get("content-disposition", "")
    assert "attachment" in disposition.lower()
    assert meta["filename"].lower() in disposition.lower()

    content_length = int(download.headers.get("content-length", "0"))
    assert content_length == meta["size_bytes"]

    digest, total, first_chunk = _sha256_stream(download)
    assert first_chunk[:2] == b"MZ"
    assert total == meta["size_bytes"]
    assert digest == meta["sha256"]


def test_local_release_manifest_and_binary_match_public_metadata():
    api_release = requests.get(f"{API_BASE}/desktop/release", timeout=30)
    assert api_release.status_code == 200
    api_meta = api_release.json()

    local_manifest = RELEASE_DIR / "manifest.json"
    assert local_manifest.exists() is True
    manifest_data = local_manifest.read_text(encoding="utf-8")
    assert '"version": "0.2.2"' in manifest_data
    assert '"product_name": "Alta Pulse"' in manifest_data

    binary_path = RELEASE_DIR / api_meta["filename"]
    assert binary_path.exists() is True
    assert binary_path.stat().st_size == api_meta["size_bytes"]

    with binary_path.open("rb") as binary_file:
        digest = hashlib.sha256(binary_file.read()).hexdigest()
    assert digest == api_meta["sha256"]


def test_nsis_archive_integrity_and_extracted_payload_contains_alta_pulse_exe_and_asar():
    release = requests.get(f"{API_BASE}/desktop/release", timeout=30).json()
    installer_path = RELEASE_DIR / release["filename"]
    assert installer_path.exists() is True

    test_archive = subprocess.run(
        ["7z", "t", str(installer_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert test_archive.returncode == 0, test_archive.stdout + test_archive.stderr
    assert "Everything is Ok" in (test_archive.stdout + test_archive.stderr)

    with tempfile.TemporaryDirectory(prefix="iter10_nsis_") as tmp_dir:
        extract = subprocess.run(
            ["7z", "x", str(installer_path), f"-o{tmp_dir}", "-y"],
            capture_output=True,
            text=True,
            check=False,
        )
        assert extract.returncode == 0, extract.stdout + extract.stderr

        root = Path(tmp_dir)
        exe_files = list(root.rglob("AltaPulse.exe"))
        assert exe_files, "AltaPulse.exe not found in extracted installer payload"

        pe_info = subprocess.run(
            ["file", str(exe_files[0])],
            capture_output=True,
            text=True,
            check=False,
        )
        assert pe_info.returncode == 0
        assert "PE32+ executable" in pe_info.stdout

        asar_files = list(root.rglob("app.asar"))
        assert asar_files, "app.asar not found in extracted payload"

        asar_bytes = asar_files[0].read_bytes()
        assert b"Alta Pulse" in asar_bytes
        assert b".env" not in asar_bytes


def test_manager_station_download_zip_branding_and_paths_are_pulse():
    session = _manager_session()

    response = session.get(f"{API_BASE}/station/download", timeout=90)
    assert response.status_code == 200, response.text
    assert "application/zip" in (response.headers.get("content-type") or "")

    disposition = response.headers.get("content-disposition", "")
    assert "Alta-Pulse-Windows.zip" in disposition

    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = archive.namelist()
    assert any(name.startswith("Alta-Pulse-Windows/") for name in names)
    assert "Alta-Pulse-Windows/alta-pulse-black.png" in names
    assert "Alta-Pulse-Windows/agent.py" in names
    assert "Alta-Pulse-Windows/config.json" in names

    agent_source = archive.read("Alta-Pulse-Windows/agent.py").decode("utf-8", errors="ignore")
    assert "Alta Pulse" in agent_source


def test_manager_csv_export_uses_alta_pulse_filename_prefix():
    session = _manager_session()

    response = session.get(f"{API_BASE}/reports/export?kind=summary", timeout=60)
    assert response.status_code == 200, response.text
    assert "text/csv" in (response.headers.get("content-type") or "")

    disposition = response.headers.get("content-disposition", "")
    assert 'filename="alta-pulse-summary.csv"' in disposition.lower()
