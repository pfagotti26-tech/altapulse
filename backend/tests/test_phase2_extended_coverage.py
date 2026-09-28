import io
import os
import sys
import time
import uuid
import zipfile
import asyncio
import requests
import importlib.util
from datetime import datetime, timezone, timedelta

import pytest

# Phase 2 coverage: unauthorized chatter access, metrics attribution rules, station states, downloads, reader synthetic behavior

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set in environment"
BASE_URL = BASE_URL.rstrip("/")
API_BASE = f"{BASE_URL}/api"

MANAGER = {
    "name": "Gestor de Validação",
    "agency_name": "Agência Vértice",
    "email": "gestor.validacao@example.com",
    "password": "Vertice!Validacao2026",
}


def _name(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:6]}"


def _event_ref():
    return uuid.uuid4().hex + uuid.uuid4().hex


def _manager_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    status = s.get(f"{API_BASE}/auth/status", timeout=20)
    assert status.status_code == 200
    if status.json().get("setup_required"):
        setup = s.post(f"{API_BASE}/auth/setup", json=MANAGER, timeout=20)
        assert setup.status_code == 200
    else:
        login = s.post(
            f"{API_BASE}/auth/login",
            json={"email": MANAGER["email"], "password": MANAGER["password"]},
            timeout=20,
        )
        assert login.status_code == 200
    me = s.get(f"{API_BASE}/auth/me", timeout=20)
    assert me.status_code == 200
    return s


def _pair_agent(manager_session, name="TEST Phase2 Agent"):
    pairing = manager_session.post(f"{API_BASE}/station/pairing", timeout=20)
    assert pairing.status_code == 200
    code = pairing.json()["code"]
    paired = requests.post(
        f"{API_BASE}/agent/pair", json={"code": code, "name": name}, timeout=20
    )
    assert paired.status_code == 200
    token = paired.json()["token"]
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def manager_session():
    return _manager_session()


def test_chatter_forbidden_from_manager_endpoints(manager_session):
    creator = manager_session.post(
        f"{API_BASE}/creators",
        json={"name": _name("TEST2_RBAC"), "handle": "rbac2", "color": "green"},
        timeout=20,
    )
    assert creator.status_code == 201
    creator_id = creator.json()["id"]

    chatter_email = f"chatter.{uuid.uuid4().hex[:8]}@example.com"
    user = manager_session.post(
        f"{API_BASE}/users",
        json={
            "name": "TEST2 Chatter",
            "email": chatter_email,
            "password": MANAGER["password"],
            "role": "chatter",
            "creator_ids": [creator_id],
        },
        timeout=20,
    )
    assert user.status_code == 201

    chatter = requests.Session()
    chatter.headers.update({"Content-Type": "application/json"})
    login = chatter.post(
        f"{API_BASE}/auth/login",
        json={"email": chatter_email, "password": MANAGER["password"]},
        timeout=20,
    )
    assert login.status_code == 200

    assert chatter.get(f"{API_BASE}/metrics", timeout=20).status_code == 403
    assert chatter.get(f"{API_BASE}/audit", timeout=20).status_code == 403
    assert chatter.patch(
        f"{API_BASE}/settings",
        json={
            "agency_name": "nao",
            "sla_minutes": 5,
            "retention_days": 90,
            "storage_allowed": True,
        },
        timeout=20,
    ).status_code == 403
    assert chatter.post(f"{API_BASE}/station/pairing", timeout=20).status_code == 403


def test_metrics_inherited_wait_incomplete_and_operator_filtering(manager_session):
    creator = manager_session.post(
        f"{API_BASE}/creators",
        json={"name": _name("TEST2_Metric"), "handle": "m2", "color": "blue"},
        timeout=20,
    )
    assert creator.status_code == 201
    creator_id = creator.json()["id"]

    cfg = manager_session.get(f"{API_BASE}/settings", timeout=20).json()
    enable = manager_session.patch(
        f"{API_BASE}/settings",
        json={
            "agency_name": cfg["agency_name"],
            "sla_minutes": cfg["sla_minutes"],
            "retention_days": cfg["retention_days"],
            "storage_allowed": True,
        },
        timeout=20,
    )
    assert enable.status_code == 200

    headers = _pair_agent(manager_session, "TEST2 Metric Agent")
    hb = requests.post(
        f"{API_BASE}/agent/heartbeat",
        json={
            "browsers": [
                {
                    "creator_id": creator_id,
                    "state": "open",
                    "observation_state": "partial",
                }
            ]
        },
        headers=headers,
        timeout=20,
    )
    assert hb.status_code == 200

    shift1 = manager_session.post(
        f"{API_BASE}/shifts", json={"creator_id": creator_id}, timeout=20
    )
    assert shift1.status_code == 201
    sid1 = shift1.json()["id"]

    started = datetime.now(timezone.utc) - timedelta(minutes=10)
    ref = _event_ref()

    p = requests.post(
        f"{API_BASE}/agent/observations",
        json={
            "creator_id": creator_id,
            "event_ref": ref,
            "kind": "pending",
            "started_at": started.isoformat(),
            "sequence_complete": True,
        },
        headers=headers,
        timeout=20,
    )
    assert p.status_code == 200

    end1 = manager_session.post(
        f"{API_BASE}/shifts/{sid1}/action", json={"action": "end"}, timeout=20
    )
    assert end1.status_code == 200

    shift2 = manager_session.post(
        f"{API_BASE}/shifts", json={"creator_id": creator_id}, timeout=20
    )
    assert shift2.status_code == 201
    sid2 = shift2.json()["id"]
    responded = datetime.now(timezone.utc) + timedelta(seconds=30)

    r = requests.post(
        f"{API_BASE}/agent/observations",
        json={
            "creator_id": creator_id,
            "event_ref": ref,
            "kind": "response",
            "started_at": started.isoformat(),
            "responded_at": responded.isoformat(),
            "sequence_complete": True,
        },
        headers=headers,
        timeout=20,
    )
    assert r.status_code == 200

    inc = requests.post(
        f"{API_BASE}/agent/observations",
        json={
            "creator_id": creator_id,
            "event_ref": _event_ref(),
            "kind": "pending",
            "started_at": started.isoformat(),
            "sequence_complete": False,
        },
        headers=headers,
        timeout=20,
    )
    assert inc.status_code == 200

    metrics = manager_session.get(f"{API_BASE}/metrics?creator_id={creator_id}", timeout=20)
    assert metrics.status_code == 200
    data = metrics.json()
    assert data["summary"]["response_count"] >= 1
    assert data["summary"]["incomplete_count"] >= 1
    row = next(x for x in data["responses"] if x["event_ref"] == ref)
    assert row["inherited"] is True
    assert row["shift_id"] == sid2

    filtered = manager_session.get(
        f"{API_BASE}/metrics?creator_id={creator_id}&operator_id={row['operator_id']}",
        timeout=20,
    )
    assert filtered.status_code == 200
    assert filtered.json()["summary"]["response_count"] >= 1


def test_sales_confirmation_time_unknown_refunds_manual_assignment_and_filtering(manager_session):
    creator = manager_session.post(
        f"{API_BASE}/creators",
        json={"name": _name("TEST2_Sales"), "handle": "s2", "color": "amber"},
        timeout=20,
    )
    assert creator.status_code == 201
    creator_id = creator.json()["id"]

    headers = _pair_agent(manager_session, "TEST2 Sales Agent")
    hb = requests.post(
        f"{API_BASE}/agent/heartbeat",
        json={
            "browsers": [
                {
                    "creator_id": creator_id,
                    "state": "open",
                    "observation_state": "partial",
                }
            ]
        },
        headers=headers,
        timeout=20,
    )
    assert hb.status_code == 200

    shift = manager_session.post(
        f"{API_BASE}/shifts", json={"creator_id": creator_id}, timeout=20
    )
    assert shift.status_code == 201
    sid = shift.json()["id"]

    now_utc = datetime.now(timezone.utc)
    in_shift_time = (now_utc - timedelta(minutes=2)).isoformat()
    before_shift_time = (now_utc - timedelta(hours=2)).isoformat()

    ref_confirmed = _event_ref()
    ref_refund = _event_ref()
    ref_unknown_origin = _event_ref()
    ref_old_confirmed = _event_ref()

    s1 = requests.post(
        f"{API_BASE}/agent/observations",
        json={
            "creator_id": creator_id,
            "event_ref": ref_confirmed,
            "kind": "sale",
            "amount_cents": 11000,
            "sale_status": "confirmed",
            "sale_origin": "chat",
            "confirmed_at": in_shift_time,
        },
        headers=headers,
        timeout=20,
    )
    assert s1.status_code == 200

    s2 = requests.post(
        f"{API_BASE}/agent/observations",
        json={
            "creator_id": creator_id,
            "event_ref": ref_refund,
            "kind": "sale",
            "amount_cents": 3000,
            "sale_status": "refunded",
            "sale_origin": "chat",
            "confirmed_at": in_shift_time,
        },
        headers=headers,
        timeout=20,
    )
    assert s2.status_code == 200

    s3 = requests.post(
        f"{API_BASE}/agent/observations",
        json={
            "creator_id": creator_id,
            "event_ref": ref_unknown_origin,
            "kind": "sale",
            "amount_cents": 5000,
            "sale_status": "unknown",
            "sale_origin": "unknown",
            "confirmed_at": in_shift_time,
        },
        headers=headers,
        timeout=20,
    )
    assert s3.status_code == 200

    s4 = requests.post(
        f"{API_BASE}/agent/observations",
        json={
            "creator_id": creator_id,
            "event_ref": ref_old_confirmed,
            "kind": "sale",
            "amount_cents": 7000,
            "sale_status": "confirmed",
            "sale_origin": "chat",
            "confirmed_at": before_shift_time,
        },
        headers=headers,
        timeout=20,
    )
    assert s4.status_code == 200

    metrics = manager_session.get(f"{API_BASE}/metrics?creator_id={creator_id}", timeout=20)
    assert metrics.status_code == 200
    payload = metrics.json()
    assert payload["summary"]["sales_sample"] >= 4
    assert payload["summary"]["confirmed_cents"] >= 11000
    assert payload["summary"]["refunded_cents"] >= 3000
    assert payload["summary"]["unassigned_sales"] >= 2

    old_row = next(x for x in payload["sales"] if x["event_ref"] == ref_old_confirmed)
    assert old_row["operator_id"] is None

    target = next(x for x in payload["sales"] if x["event_ref"] == ref_unknown_origin)
    patch = manager_session.patch(
        f"{API_BASE}/sales/{target['id']}/assignment",
        json={"shift_id": None, "reason": "TEST2 manter sem atribuicao"},
        timeout=20,
    )
    assert patch.status_code == 200

    patch_confirmed = manager_session.patch(
        f"{API_BASE}/sales/{old_row['id']}/assignment",
        json={"shift_id": sid, "reason": "TEST2 ajuste manual auditado"},
        timeout=20,
    )
    assert patch_confirmed.status_code == 200

    after = manager_session.get(f"{API_BASE}/metrics?creator_id={creator_id}", timeout=20)
    assert after.status_code == 200
    rows = after.json()["sales"]
    manually_assigned = next(x for x in rows if x["id"] == old_row["id"])
    assert manually_assigned["assignment_type"] == "manual"
    assert manually_assigned["operator_id"] is not None

    by_operator = manager_session.get(
        f"{API_BASE}/metrics?creator_id={creator_id}&operator_id={manually_assigned['operator_id']}",
        timeout=20,
    )
    assert by_operator.status_code == 200
    assert any(
        x["id"] == manually_assigned["id"] for x in by_operator.json()["sales"]
    )


def test_station_no_data_then_interrupted_state_reflected_in_creators(manager_session):
    creator = manager_session.post(
        f"{API_BASE}/creators",
        json={"name": _name("TEST2_State"), "handle": "st2", "color": "lavender"},
        timeout=20,
    )
    assert creator.status_code == 201
    creator_id = creator.json()["id"]

    headers = _pair_agent(manager_session, "TEST2 State Agent")
    hb = requests.post(
        f"{API_BASE}/agent/heartbeat",
        json={
            "browsers": [
                {
                    "creator_id": creator_id,
                    "state": "open",
                    "observation_state": "no_data",
                }
            ]
        },
        headers=headers,
        timeout=20,
    )
    assert hb.status_code == 200

    creators_now = manager_session.get(f"{API_BASE}/creators", timeout=20)
    assert creators_now.status_code == 200
    row_now = next(x for x in creators_now.json() if x["id"] == creator_id)
    assert row_now["browser"]["observation_state"] == "no_data"

    time.sleep(31)
    creators_later = manager_session.get(f"{API_BASE}/creators", timeout=20)
    assert creators_later.status_code == 200
    row_later = next(x for x in creators_later.json() if x["id"] == creator_id)
    assert row_later["browser"]["state"] == "interrupted"


def test_station_download_zip_has_expected_contents(manager_session):
    r = manager_session.get(f"{API_BASE}/station/download", timeout=30)
    assert r.status_code == 200
    archive = zipfile.ZipFile(io.BytesIO(r.content))
    names = archive.namelist()
    assert "Vertice-Windows/agent.py" in names
    assert "Vertice-Windows/reader.py" in names
    assert "Vertice-Windows/LEIA-ME.md" in names
    assert "Vertice-Windows/config.json" in names
    config = archive.read("Vertice-Windows/config.json").decode("utf-8")
    assert "app_url" in config
    assert "privacy_url" in config


def test_local_reader_synthetic_dom_behavior_without_privacy_runtime():
    reader_path = "/app/local-agent/reader.py"
    spec = importlib.util.spec_from_file_location("vertice_reader", reader_path)
    reader = importlib.util.module_from_spec(spec)
    sys.modules["vertice_reader"] = reader
    spec.loader.exec_module(reader)

    class FakePage:
        def __init__(self, payload):
            self.payload = payload

        async def evaluate(self, *_args, **_kwargs):
            return self.payload

    config = {
        "chat": {
            "incoming_value": "in",
            "outgoing_value": "out",
        },
        "sales": {
            "status_values": {"Confirmada": "confirmed"},
            "origin_values": {"Chat": "chat"},
        },
    }
    secret = bytes.fromhex("ab" * 32)

    empty_payload = {"chat": [], "sales": [], "reference": None}
    events_empty = asyncio.run(reader.observe(FakePage(empty_payload), config, secret, "creatorX"))
    assert events_empty == []

    valid_payload = {
        "reference": "thread-1",
        "chat": [
            {"at": "2026-02-01T10:00:00+00:00", "direction": "out", "sequence": "1"},
            {"at": "2026-02-01T10:01:00+00:00", "direction": "in", "sequence": "2"},
            {"at": "2026-02-01T10:02:30+00:00", "direction": "out", "sequence": "3"},
        ],
        "sales": [
            {
                "ref": "sale-123",
                "at": "2026-02-01T10:03:00+00:00",
                "amount": "R$ 123,45",
                "status": "Confirmada",
                "origin": "Chat",
            }
        ],
    }
    events = asyncio.run(reader.observe(FakePage(valid_payload), config, secret, "creatorY"))
    kinds = sorted(e["kind"] for e in events)
    assert kinds == ["response", "sale"]