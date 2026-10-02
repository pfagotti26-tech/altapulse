"""Contratos públicos: documentos internos e credenciais nunca integram a resposta."""
from datetime import datetime
from typing import Literal, Optional, Any
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
    avatar: Optional[str] = None

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
    operator_avatar: Optional[str] = None
    ends_at: Optional[str] = None
    extended_until: Optional[str] = None
    prompt_at: Optional[str] = None
    ended_reason: Optional[str] = None

class CreatorOut(Public):
    id: str
    name: str
    handle: str
    color: str
    group: str = ''
    groups: list[str] = []
    tag: str = ''
    notes: str = ''
    created_at: str
    review: dict[str, Any] | None = None
    shift: ShiftOut | None = None
    browser: dict[str, Any] | None = None
    avatar: str | None = None

class SettingsOut(Public):
    id: str = 'main'
    agency_name: str
    sla_minutes: int
    retention_days: int
    storage_allowed: bool
    fan_names_allowed: bool = False
    quality_ai_allowed: bool = False
    usd_brl_rate: float = 5.0

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
    offers: list[dict[str, Any]] = []
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