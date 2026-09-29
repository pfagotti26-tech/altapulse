"""Contratos públicos: documentos internos e credenciais nunca integram a resposta."""
from datetime import datetime
from typing import Literal, Any
from pydantic import BaseModel, ConfigDict, Field

class Public(BaseModel):
    model_config = ConfigDict(extra='ignore')

class UserOut(Public):
    id: str
    name: str
    email: str
    role: Literal['manager', 'chatter']
    active: bool
    creator_ids: list[str]
    created_at: str
    must_change_password: bool = False

class ShiftOut(Public):
    id: str
    creator_id: str
    creator_name: str
    operator_id: str
    operator_name: str
    started_at: str
    ended_at: str | None = None
    active: bool
    paused: bool

class CreatorOut(Public):
    id: str
    name: str
    handle: str
    color: str
    created_at: str
    review: dict[str, Any] | None = None
    shift: ShiftOut | None = None
    browser: dict[str, Any] | None = None
    desktop_access: dict[str, Any] | None = None

class SettingsOut(Public):
    id: str = 'main'
    agency_name: str
    sla_minutes: int
    retention_days: int
    storage_allowed: bool

class MeOut(Public):
    user: UserOut
    settings: SettingsOut

class AuditOut(Public):
    id: str
    actor_id: str
    actor: str
    action: str
    target: str
    reason: str | None = None
    changes: dict[str, Any] | None = None
    created_at: str

class ReviewOut(Public):
    id: str
    creator_id: str
    creator_name: str
    review_session_id: str
    operator_id: str
    operator_name: str
    period_start: str
    period_end: str
    manager_name: str
    answers: dict[str, Literal['adequado', 'atencao', 'nao_avaliavel']]
    created_at: str

class MetricsOut(Public):
    responses: list[dict[str, Any]]
    pending: list[dict[str, Any]]
    sales: list[dict[str, Any]]
    summary: dict[str, Any]

class CommandOut(Public):
    id: str
    creator_id: str
    creator_name: str
    station_id: str
    status: str
    action: Literal['open']
    requested_by: str
    expires_at: datetime
    created_at: str