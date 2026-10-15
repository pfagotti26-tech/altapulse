"""
Envio automático — teste Aline Fishborn (modo ensaio).
O servidor só decide e registra. Quem envia é o app de teste.
Desligador: auto_config.enabled no banco, lido a cada mensagem.
"""
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from core import db, iso, uid, manager
from quality_ai import scrub
from extension_routes import extension_user
from zoneinfo import ZoneInfo
import assist as A

router = APIRouter(prefix="/auto", tags=["auto"])
BR = ZoneInfo('America/Sao_Paulo')

CREATOR_NAME = "Aline Fishborn"
MAX_PER_DAY = 300
MAX_PER_FAN = 50
HOUR_START = 9
HOUR_END = 23

class ChatMsg(BaseModel):
    ours: bool
    text: str = Field(default='', max_length=1200)

class DecideIn(BaseModel):
    creator_id: str
    fan_ref: str
    fan_name: Optional[str] = None
    messages: List[ChatMsg] = Field(default_factory=list, max_length=16)

class DecideOut(BaseModel):
    should_send: bool
    reason: str
    essay: bool = True
    suggested_text: Optional[str] = None
    log_id: Optional[str] = None

async def get_config():
    doc = await db.auto_config.find_one({"id": "main"}) or {}
    return {
        "enabled": bool(doc.get("enabled")),
        "essay": doc.get("essay", True),
        "creator_id": doc.get("creator_id"),
        "max_per_day": int(doc.get("max_per_day") or 15),
        "max_per_fan": int(doc.get("max_per_fan") or 2),
        "hour_start": int(doc.get("hour_start") or 10),
        "hour_end": int(doc.get("hour_end") or 22),
    }

def today():
    return datetime.now(BR).strftime('%Y-%m-%d')

async def count_today(creator_id: str, fan_ref: Optional[str] = None):
    q = {"day": today(), "creator_id": creator_id, "decision": {"$in": ["aprovado", "enviado", "falha_envio"]}}
    if fan_ref:
        q["fan_ref"] = fan_ref
    return await db.auto_log.count_documents(q)

@router.post("/decide", response_model=DecideOut)
async def decide(body: DecideIn, user=Depends(extension_user)):
    cfg = await get_config()
    if not cfg["enabled"]:
        return DecideOut(should_send=False, reason="automação desligada", essay=cfg["essay"])

    if not cfg.get("creator_id"):
        await db.auto_log.insert_one({
            "id": uid(), "at": iso(), "day": today(),
            "creator_id": body.creator_id, "fan_ref": body.fan_ref,
            "fan_name": scrub(body.fan_name or "")[:80] if body.fan_name else None,
            "decision": "travado", "reason": "creator_id não configurado",
        })
        raise HTTPException(403, "creator_id não configurado")
    if body.creator_id != cfg["creator_id"]:
        raise HTTPException(403, "Automação só para a criadora configurada")

    # Presence: active shift (same pattern as extension_routes.py)
    shift = await db.shifts.find_one({'creator_id': body.creator_id, 'active': True})
    if shift:
        return DecideOut(should_send=False, reason="chatter ativo", essay=cfg["essay"])

    # Plantao: window and recent approaches
    pcfg = await db.plantao_configs.find_one({'creator_id': body.creator_id}) or {}
    if pcfg.get('enabled'):
        ws = pcfg.get('window_start', '03:00')
        we = pcfg.get('window_end', '08:00')
        now_hm = datetime.now(BR).strftime('%H:%M')
        in_window = ws <= now_hm <= we if ws <= we else (now_hm >= ws or now_hm <= we)
        if in_window:
            return DecideOut(should_send=False, reason="janela de plantão", essay=cfg["essay"])
    # Fan recently approached by plantao
    since = (datetime.now(BR) - __import__('datetime').timedelta(hours=18)).isoformat()
    recent = await db.plantao_log.find_one({'creator_id': body.creator_id, 'fan_ref': body.fan_ref, 'sent_at': {'$gt': since}})
    if recent:
        return DecideOut(should_send=False, reason="fã na fila do plantão", essay=cfg["essay"])


    now = datetime.now(BR)
    if not (cfg['hour_start'] <= now.hour < cfg['hour_end']):
        return DecideOut(should_send=False, reason="fora do horário", essay=cfg["essay"])

    # Fan must have spoken last
    if not body.messages or body.messages[-1].ours:
        return DecideOut(should_send=False, reason="fã não falou por último", essay=cfg["essay"])

    last_text = body.messages[-1].text
    if await count_today(body.creator_id) >= cfg['max_per_day']:
        return DecideOut(should_send=False, reason="teto diário", essay=cfg["essay"])
    if await count_today(body.creator_id, body.fan_ref) >= cfg['max_per_fan']:
        return DecideOut(should_send=False, reason="teto por fã", essay=cfg["essay"])

    # Distrust / robot
    low = last_text.lower()
    if any(x in low for x in ["robô", "robo", "é a aline", "quem tá falando", "automático", "é você mesmo"]):
        await db.auto_log.insert_one({
            "id": uid(), "at": iso(), "day": today(),
            "creator_id": body.creator_id, "fan_ref": body.fan_ref,
            "fan_name": scrub(body.fan_name or "")[:80] if body.fan_name else None,
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
        result = await A.suggest(suggest_body, user)
        if isinstance(result, dict) and result.get("alert"):
            await db.auto_log.insert_one({
                "id": uid(), "at": iso(), "day": today(),
                "creator_id": body.creator_id, "fan_ref": body.fan_ref,
            "fan_name": scrub(body.fan_name or "")[:80] if body.fan_name else None,
                "last_fan": scrub(last_text)[:500],
                "decision": "travado", "reason": result.get("reason", "alerta"),
            })
            return DecideOut(should_send=False, reason=result.get("reason", "alerta"), essay=cfg["essay"])
        suggested = result.get("text") if isinstance(result, dict) else None
    except Exception as e:
        await db.auto_log.insert_one({
            "id": uid(), "at": iso(), "day": today(),
            "creator_id": body.creator_id, "fan_ref": body.fan_ref,
            "fan_name": scrub(body.fan_name or "")[:80] if body.fan_name else None,
            "last_fan": scrub(last_text)[:500],
            "decision": "erro", "reason": "falha no suggest",
            "error": str(e)[:300],
        })
        return DecideOut(should_send=False, reason="erro interno", essay=cfg["essay"])

    should = not cfg["essay"]
    decision = "ensaio" if cfg["essay"] else "aprovado"
    reason = "modo ensaio — não envia" if cfg["essay"] else "aprovado"
    lid = uid()
    await db.auto_log.insert_one({
        "id": lid, "at": iso(), "day": today(),
        "creator_id": body.creator_id, "fan_ref": body.fan_ref,
        "fan_name": scrub(body.fan_name or "")[:80] if body.fan_name else None,
        "last_fan": scrub(last_text)[:500],
        "decision": decision, "reason": reason,
        "suggested_text": suggested,
    })
    return DecideOut(should_send=should, reason=reason, essay=cfg["essay"], suggested_text=suggested, log_id=lid)


@router.get("/report")
async def report(day: str = "", user=Depends(manager)):
    """Resumo e lista do dia para o painel de teste. Só gestor."""
    d = day or today()
    rows = await db.auto_log.find({"day": d}, {"_id": 0}).sort("at", -1).to_list(500)
    # gasto do dia (assist_usage)
    usage = await db.assist_usage.aggregate([
        {"$match": {"day": d}},
        {"$group": {"_id": None, "cost": {"$sum": "$cost_usd"}, "calls": {"$sum": 1}}}
    ]).to_list(1)
    cost = usage[0]["cost"] if usage else 0
    calls = usage[0]["calls"] if usage else 0
    summary = {
        "day": d,
        "ensaios": sum(1 for r in rows if r.get("decision") == "ensaio"),
        "travados": sum(1 for r in rows if r.get("decision") == "travado"),
        "erros": sum(1 for r in rows if r.get("decision") == "erro"),
        "motivos": {},
        "cost_usd": round(cost or 0, 4),
        "calls": calls,
    }
    for r in rows:
        if r.get("decision") == "travado":
            m = r.get("reason") or "outro"
            summary["motivos"][m] = summary["motivos"].get(m, 0) + 1
    return {"summary": summary, "rows": rows}



@router.post("/failed/{log_id}")
async def mark_failed(log_id: str, user=Depends(extension_user)):
    await db.auto_log.update_one(
        {"id": log_id, "decision": "aprovado"},
        {"$set": {"decision": "falha_envio", "reason": "falha_envio"}}
    )
    return {"ok": True}

@router.post("/sent/{log_id}")
async def mark_sent(log_id: str, user=Depends(extension_user)):
    await db.auto_log.update_one(
        {"id": log_id, "decision": "aprovado"},
        {"$set": {"decision": "enviado", "sent_at": iso(), "reason": "enviado"}}
    )
    return {"ok": True}


class ConfigIn(BaseModel):
    enabled: Optional[bool] = None
    essay: Optional[bool] = None
    max_per_day: Optional[int] = None
    max_per_fan: Optional[int] = None
    hour_start: Optional[int] = None
    hour_end: Optional[int] = None


@router.get("/config")
async def get_config_endpoint(user=Depends(manager)):
    return await get_config()

@router.put("/config")
async def set_config(body: ConfigIn, user=Depends(manager)):
    upd = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if "max_per_day" in upd and not (1 <= upd["max_per_day"] <= 300):
        raise HTTPException(400, "max_per_day deve estar entre 1 e 300")
    if "max_per_fan" in upd and not (1 <= upd["max_per_fan"] <= 50):
        raise HTTPException(400, "max_per_fan deve estar entre 1 e 50")
    if "hour_start" in upd and not (0 <= upd["hour_start"] <= 23):
        raise HTTPException(400, "hour_start deve estar entre 0 e 23")
    if "hour_end" in upd and not (0 <= upd["hour_end"] <= 23):
        raise HTTPException(400, "hour_end deve estar entre 0 e 23")
    if "hour_start" in upd and "hour_end" in upd and upd["hour_start"] >= upd["hour_end"]:
        raise HTTPException(400, "hour_start deve ser menor que hour_end")
    await db.auto_config.update_one({"id": "main"}, {"$set": upd}, upsert=True)
    return {"ok": True}

@router.get("/status")
async def status(user=Depends(extension_user)):
    cfg = await get_config()
    today_count = await db.auto_log.count_documents({"day": today(), "decision": {"$in": ["aprovado", "enviado", "falha_envio"]}}) if cfg.get("creator_id") else 0
    remaining = max(0, cfg['max_per_day'] - today_count)
    return {**cfg, "today": today_count, "remaining": remaining, "limits": {"max_per_day": MAX_PER_DAY, "max_per_fan": MAX_PER_FAN}}
