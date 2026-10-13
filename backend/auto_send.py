"""
Envio automático — teste Aline Fishborn (modo ensaio).
O servidor só decide e registra. Quem envia é o app de teste.
Desligador: auto_config.enabled no banco, lido a cada mensagem.
"""
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from core import db, iso, uid
from quality_ai import scrub
from extension_routes import extension_user
from zoneinfo import ZoneInfo
import assist as A

router = APIRouter(prefix="/auto", tags=["auto"])
BR = ZoneInfo('America/Sao_Paulo')

CREATOR_NAME = "Aline Fishborn"
MAX_PER_DAY = 40
MAX_PER_FAN = 3
HOUR_START = 9
HOUR_END = 23

class ChatMsg(BaseModel):
    ours: bool
    text: str = Field(default='', max_length=1200)

class DecideIn(BaseModel):
    creator_id: str
    fan_ref: str
    messages: List[ChatMsg] = Field(default_factory=list, max_length=16)
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

async def aline_id():
    c = await db.creators.find_one({"name": CREATOR_NAME}, {"_id": 0, "id": 1})
    return c["id"] if c else None

def today():
    return datetime.now(BR).strftime('%Y-%m-%d')

async def count_today(creator_id: str, fan_ref: Optional[str] = None):
    q = {"day": today(), "creator_id": creator_id, "decision": {"$in": ["ensaio", "enviado"]}}
    if fan_ref:
        q["fan_ref"] = fan_ref
    return await db.auto_log.count_documents(q)

@router.post("/decide", response_model=DecideOut)
async def decide(body: DecideIn, user=Depends(extension_user)):
    cfg = await get_config()
    if not cfg["enabled"]:
        return DecideOut(should_send=False, reason="automação desligada", essay=cfg["essay"])

    aid = await aline_id()
    if not aid or body.creator_id != aid:
        raise HTTPException(403, "Automação só para Aline Fishborn")

    now = datetime.now(BR)
    if not (HOUR_START <= now.hour < HOUR_END):
        return DecideOut(should_send=False, reason="fora do horário", essay=cfg["essay"])

    if body.presence_active:
        return DecideOut(should_send=False, reason="chatter ativo", essay=cfg["essay"])

    if body.in_plantao:
        return DecideOut(should_send=False, reason="plantão", essay=cfg["essay"])

    # Fan must have spoken last
    if not body.messages or body.messages[-1].ours:
        return DecideOut(should_send=False, reason="fã não falou por último", essay=cfg["essay"])

    last_text = body.messages[-1].text
    if await count_today(body.creator_id) >= MAX_PER_DAY:
        return DecideOut(should_send=False, reason="teto diário", essay=cfg["essay"])
    if await count_today(body.creator_id, body.fan_ref) >= MAX_PER_FAN:
        return DecideOut(should_send=False, reason="teto por fã", essay=cfg["essay"])

    # Distrust / robot
    low = last_text.lower()
    if any(x in low for x in ["robô", "robo", "é a aline", "quem tá falando", "automático", "é você mesmo"]):
        await db.auto_log.insert_one({
            "id": uid(), "at": iso(), "day": today(),
            "creator_id": body.creator_id, "fan_ref": body.fan_ref,
            "last_fan": scrub(last_text)[:500],
            "decision": "travado", "reason": "desconfiança",
        })
        return DecideOut(should_send=False, reason="desconfiança", essay=cfg["essay"])

    # Call existing suggest logic
    try:
        suggest_body = A.SuggestIn(
            creator_id=body.creator_id,
            fan_ref=body.fan_ref,
            messages=[A.ChatMsg(ours=m.ours, text=m.text) for m in body.messages],
            mode='reply',
        )
        # Note: this calls the endpoint function directly; in production wire properly
        result = await A.suggest(suggest_body, user)
        suggested = result.get("text") if isinstance(result, dict) else None
    except Exception as e:
        suggested = None

    await db.auto_log.insert_one({
        "id": uid(), "at": iso(), "day": today(),
        "creator_id": body.creator_id, "fan_ref": body.fan_ref,
        "last_fan": scrub(last_text)[:500],
        "decision": "ensaio", "reason": "modo ensaio — não envia",
        "suggested_text": suggested,
    })
    return DecideOut(should_send=False, reason="modo ensaio", essay=True, suggested_text=suggested)

@router.get("/status")
async def status(user=Depends(extension_user)):
    cfg = await get_config()
    return {"creator": CREATOR_NAME, **cfg, "limits": {"max_per_day": MAX_PER_DAY, "max_per_fan": MAX_PER_FAN}}
