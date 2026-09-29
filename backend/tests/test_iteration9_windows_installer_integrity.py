import hashlib
import os
from pathlib import Path

import pytest
import requests

# Desktop public release/download integrity checks for Windows installer package.


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
LOCAL_RELEASE_DIR = Path("/app/desktop/release")


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def test_public_release_contract_matches_expected_021_values():
    response = requests.get(f"{API_BASE}/desktop/release", timeout=30)
    assert response.status_code == 200
    data = response.json()

    assert data["available"] is True
    assert data["version"] == "0.2.1"
    assert data["filename"] == "Alta-Core-0.2.1-Setup-x64.exe"
    assert data["size_bytes"] == 114965344
    assert data["sha256"] == "71f3612df4fae7f0d08805e5805948369792cb4ca5c7bb50eb90e172f64c487a"
    assert data["signed"] is False
    assert data["windows_validated"] is False


def test_public_windows_download_full_binary_matches_release_manifest_and_local_file():
    release = requests.get(f"{API_BASE}/desktop/release", timeout=30)
    assert release.status_code == 200
    meta = release.json()

    download = requests.get(f"{API_BASE}/desktop/download/windows", timeout=300, stream=True)
    assert download.status_code == 200
    assert download.headers.get("X-Checksum-SHA256") == meta["sha256"]

    content_length = int(download.headers.get("content-length", "0"))
    assert content_length == meta["size_bytes"]

    hasher = hashlib.sha256()
    total = 0
    first_chunk = b""
    for chunk in download.iter_content(1024 * 1024):
        if not chunk:
            continue
        if not first_chunk:
            first_chunk = chunk
        hasher.update(chunk)
        total += len(chunk)

    assert first_chunk[:2] == b"MZ"
    assert total == meta["size_bytes"]
    assert hasher.hexdigest() == meta["sha256"]

    local_file = LOCAL_RELEASE_DIR / meta["filename"]
    assert local_file.exists() is True
    assert local_file.stat().st_size == meta["size_bytes"]
    assert _sha256_file(local_file) == meta["sha256"]
