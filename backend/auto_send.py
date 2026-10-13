"""
Envio automático — teste Aline Fishborn (modo ensaio).
O servidor só decide e registra. Quem envia é o app de teste.
Desligador: auto_config.enabled no banco, lido a cada mensagem.
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from core import db, iso, uid
from quality_ai import scrub
from extension_routes import extension_user
from zoneinfo import ZoneInfo

router = APIRouter(prefix="/auto", tags=["auto"])
BR = ZoneInfo('America/Sao_Paulo')

CREATOR_NAME = "Aline Fishborn"
MAX_PER_DAY = 40
MAX_PER_FAN = 3
HOUR_START = 9
HOUR_END = 23

class DecideIn(BaseModel):
    creator_id: str
    fan_ref: str
    last_fan_text: str
    presence_active: bool = False
    in_plantao: bool = False

class DecideOut(BaseModel):
    should_send: bool
    reason: str
    essay: bool = True
    suggested_text: Optional[str] = None

async def get_config():
    doc = await db.auto_config.find_one({"id": "main"}) or {}
    return {"enabled": bool(doc.get("enabled")), "essay": doc.get("essay", True)}

def today():
    return datetime.now(BR).strftime('%Y-%m-%d')

@router.post("/decide", response_model=DecideOut)
async def decide(body: DecideIn, user=Depends(extension_user)):
    cfg = await get_config()
    if not cfg["enabled"]:
        return DecideOut(should_send=False, reason="automação desligada", essay=cfg["essay"])

    now = datetime.now(BR)
    if not (HOUR_START <= now.hour < HOUR_END):
        return DecideOut(should_send=False, reason="fora do horário", essay=cfg["essay"])

    if body.presence_active:
        return DecideOut(should_send=False, reason="chatter ativo", essay=cfg["essay"])

    if body.in_plantao:
        return DecideOut(should_send=False, reason="plantão", essay=cfg["essay"])

    low = body.last_fan_text.lower()
    if any(x in low for x in ["robô", "robo", "é a aline", "quem tá falando", "automático"]):
        await db.auto_log.insert_one({
            "id": uid(), "at": iso(), "day": today(),
            "creator_id": body.creator_id, "fan_ref": body.fan_ref,
            "last_fan": scrub(body.last_fan_text)[:500],
            "decision": "travado", "reason": "desconfiança",
        })
        return DecideOut(should_send=False, reason="desconfiança", essay=cfg["essay"])

    # Essay mode: log and do not send
    await db.auto_log.insert_one({
        "id": uid(), "at": iso(), "day": today(),
        "creator_id": body.creator_id, "fan_ref": body.fan_ref,
        "last_fan": scrub(body.last_fan_text)[:500],
        "decision": "ensaio", "reason": "modo ensaio — não envia",
        "suggested_text": None,
    })
    return DecideOut(should_send=False, reason="modo ensaio", essay=True)

@router.get("/status")
async def status(user=Depends(extension_user)):
    cfg = await get_config()
    return {"creator": CREATOR_NAME, **cfg, "limits": {"max_per_day": MAX_PER_DAY, "max_per_fan": MAX_PER_FAN}}
