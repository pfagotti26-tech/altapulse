import json
import os
import subprocess
from pathlib import Path

import pytest
import requests

# Iteration 11 scoped checks: no Privacy-report flow, navigation status watcher contracts, and public release state.

ROOT = Path("/app")
DESKTOP_DIR = ROOT / "desktop"
FRONTEND_DIR = ROOT / "frontend"


def _frontend_base_url() -> str:
    value = os.environ.get("REACT_APP_BACKEND_URL")
    if value:
        return value.rstrip("/")

    env_file = FRONTEND_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    pytest.skip("REACT_APP_BACKEND_URL missing")


BASE_URL = _frontend_base_url()
API_BASE = f"{BASE_URL}/api"


def test_external_support_module_removed_and_forbidden_ipc_absent():
    assert (DESKTOP_DIR / "external-actions.cjs").exists() is False

    main_source = (DESKTOP_DIR / "main.cjs").read_text(encoding="utf-8")
    preload_source = (DESKTOP_DIR / "preload.cjs").read_text(encoding="utf-8")
    notice_source = (FRONTEND_DIR / "src/components/BrowserAccessNotice.jsx").read_text(encoding="utf-8")

    forbidden_tokens = [
        "shell.openExternal",
        "alta:privacy-support",
        "alta:copy-support",
        "alta:external-privacy",
        "supportSummary",
        "copy-report",
        "contato",
    ]
    combined = "\n".join([main_source, preload_source, notice_source]).lower()
    for token in forbidden_tokens:
        assert token.lower() not in combined


def test_build_script_cleans_staging_and_does_not_generate_support_url_env():
    build_source = (DESKTOP_DIR / "build.mjs").read_text(encoding="utf-8")
    backend_env = (ROOT / "backend/.env").read_text(encoding="utf-8")

    assert "fs.rmSync(stage, { recursive: true, force: true });" in build_source
    assert "blocked.flag" in build_source
    assert "PRIVACY_SUPPORT_URL" not in build_source
    assert "PRIVACY_SUPPORT_URL" not in backend_env


def test_navigation_and_browser_contracts_present_in_source():
    navigation_source = (DESKTOP_DIR / "navigation.cjs").read_text(encoding="utf-8")
    browser_source = (DESKTOP_DIR / "browser.cjs").read_text(encoding="utf-8")

    assert "if (code === 403) return { status: 'blocked'" in navigation_source
    assert "if (code === 429) return { status: 'blocked'" in navigation_source
    assert "if (Number.isInteger(code) && code >= 200 && code < 400) return { status: 'open'" in navigation_source
    assert "if (navigationStatus === 'loading')" in navigation_source
    assert "publish(classifyHttpStatus(null));" in navigation_source
    assert "if (this.state.status === 'blocked' && ['reload', 'home'].includes(action))" in browser_source


def test_navigation_watcher_synthetic_unit_contracts_with_node_runtime():
    node_bin = Path("/app/desktop-tools/node-v22.23.3-linux-arm64/bin/node")
    if not node_bin.exists():
        node_bin = Path("node")

    script = ROOT / "backend/tests/js_navigation_contract_check.cjs"
    result = subprocess.run(
        [str(node_bin), str(script)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "ok" in result.stdout


def test_public_release_contract_remains_022_not_published_023():
    response = requests.get(f"{API_BASE}/desktop/release", timeout=30)
    assert response.status_code == 200
    data = response.json()

    assert data["available"] is True
    assert data["version"] == "0.2.2"
    assert data["filename"] == "Alta-Pulse-0.2.2-Setup-x64.exe"
    assert data["sha256"] == "d8277227bdca75fe87e1e9cb9f0e77e6dc26d5e2adaf7536f5f621bc1e2ecb41"


def test_local_manifest_matches_public_release_values():
    manifest_path = DESKTOP_DIR / "release/manifest.json"
    assert manifest_path.exists() is True

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["version"] == "0.2.2"
    assert manifest["filename"] == "Alta-Pulse-0.2.2-Setup-x64.exe"
    assert manifest["sha256"] == "d8277227bdca75fe87e1e9cb9f0e77e6dc26d5e2adaf7536f5f621bc1e2ecb41"


def test_download_page_copy_does_not_claim_023_publication():
    source = (FRONTEND_DIR / "src/pages/DownloadDesktop.jsx").read_text(encoding="utf-8").lower()
    assert "0.2.3" not in source
    assert "não contorna nem garante a remoção de bloqueios" in source
