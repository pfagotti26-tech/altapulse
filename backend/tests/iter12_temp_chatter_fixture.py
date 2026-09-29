import os
import time
from pathlib import Path

import requests


def _base_url():
    value = os.environ.get("REACT_APP_BACKEND_URL")
    if value:
        return value.rstrip("/")
    env_file = Path("/app/frontend/.env")
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL missing")


def _manager_credentials():
    env_file = Path("/root/alta-core-test.env")
    data = {}
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            data[k.strip()] = v.strip()
    return data["ALTA_TEST_EMAIL"], data["ALTA_TEST_PASSWORD"]


def create_temp_chatter():
    api = _base_url() + "/api"
    email, password = _manager_credentials()

    manager = requests.Session()
    manager.headers.update({"Content-Type": "application/json"})
    login = manager.post(f"{api}/auth/login", json={"email": email, "password": password}, timeout=30)
    login.raise_for_status()

    chatter_email = f"temp_chrome_pilot_qa_{int(time.time())}@example.com"
    chatter_password = "TempPass1234"
    payload = {
        "name": "TEMP Chrome Pilot QA",
        "email": chatter_email,
        "password": chatter_password,
        "role": "chatter",
        "creator_ids": [],
        "temporary_password": False,
    }
    response = manager.post(f"{api}/users", json=payload, timeout=30)
    response.raise_for_status()
    user = response.json()
    print(f"CHATTER_ID={user['id']}")
    print(f"CHATTER_EMAIL={chatter_email}")
    print(f"CHATTER_PASSWORD={chatter_password}")


def deactivate_chatter(chatter_id: str):
    api = _base_url() + "/api"
    email, password = _manager_credentials()

    manager = requests.Session()
    manager.headers.update({"Content-Type": "application/json"})
    login = manager.post(f"{api}/auth/login", json={"email": email, "password": password}, timeout=30)
    login.raise_for_status()

    response = manager.patch(
        f"{api}/users/{chatter_id}",
        json={"creator_ids": [], "active": False},
        timeout=30,
    )
    response.raise_for_status()


if __name__ == "__main__":
    mode = os.environ.get("MODE", "create")
    if mode == "create":
        create_temp_chatter()
    elif mode == "deactivate":
        chatter_id = os.environ["CHATTER_ID"]
        deactivate_chatter(chatter_id)
