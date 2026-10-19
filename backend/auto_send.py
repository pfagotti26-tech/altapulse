"""
Envio automático — teste Aline Fishborn (modo ensaio).
O servidor só decide e registra. Quem envia é o app de teste.
Desligador: auto_config.enabled no banco, lido a cada mensagem.
"""
from datetime import datetime, timedelta
import asyncio
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
_fan_locks = {}  # AUTO (Grok) — lock por fã

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
    product: Optional[str] = None
    product_cents: Optional[int] = None
    caption: Optional[str] = None
    after: Optional[str] = None

async def get_config(creator_id: str = None):
    """Config por criadora. Se não existir, tenta migrar da antiga 'main'."""
    if not creator_id:
        # Legacy: devolve a primeira ligada ou a main
        doc = await db.auto_config.find_one({"id": "main"}) or {}
        creator_id = doc.get("creator_id")
        if not creator_id:
            return {"enabled": False, "essay": True, "creator_id": None, "max_per_day": 15, "max_per_fan": 2, "windows": [{"start": 10, "end": 22}]}
    doc = await db.auto_config.find_one({"id": f"creator:{creator_id}"}) or {}
    if not doc:
        # Migração da Aline
        old = await db.auto_config.find_one({"id": "main"}) or {}
        if old.get("creator_id") == creator_id:
            doc = {
                "id": f"creator:{creator_id}",
                "creator_id": creator_id,
                "enabled": bool(old.get("enabled")),
                "essay": old.get("essay", True),
                "max_per_day": int(old.get("max_per_day") or 600),
                "max_per_fan": int(old.get("max_per_fan") or 15),
                "windows": [{"start": 0, "end": 24, "days": None}],
            }
            await db.auto_config.insert_one(dict(doc))
    windows = doc.get("windows") or [{"start": int(doc.get("hour_start") or 0), "end": int(doc.get("hour_end") or 24), "days": None}]
    return {
        "enabled": bool(doc.get("enabled")),
        "essay": doc.get("essay", True),
        "creator_id": creator_id,
        "max_per_day": int(doc.get("max_per_day") or 15),
        "max_per_fan": int(doc.get("max_per_fan") or 2),
        "windows": windows,
    }

def in_windows(windows, now=None):
    """Verifica se agora está em alguma faixa (Brasília). Faixa que cruza meia-noite funciona."""
    now = now or datetime.now(BR)
    h = now.hour
    dow = now.weekday()  # 0=seg
    for w in windows or []:
        start, end = w.get("start", 0), w.get("end", 24)
        days = w.get("days")
        if days and dow not in days: continue
        if start == end: return True  # 24h
        if start < end:
            if start <= h < end: return True
        else:  # cruza meia-noite
            if h >= start or h < end: return True
    return False

def today():
    return datetime.now(BR).strftime('%Y-%m-%d')

async def count_today(creator_id: str, fan_ref: Optional[str] = None):
    q = {"day": today(), "creator_id": creator_id, "decision": {"$in": ["aprovado", "enviado", "falha_envio"]}}
    if fan_ref:
        q["fan_ref"] = fan_ref
    return await db.auto_log.count_documents(q)

@router.post("/decide", response_model=DecideOut)
async def decide(body: DecideIn, user=Depends(extension_user)):
    cfg = await get_config(body.creator_id)
    if not cfg["enabled"]:
        return DecideOut(should_send=False, reason="automação desligada", essay=cfg["essay"])

    # per-creator: cfg já é da criadora

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
    if not in_windows(cfg.get("windows")):
        return DecideOut(should_send=False, reason="fora do horário", essay=cfg["essay"])

    # Fan must have spoken last
    if not body.messages or body.messages[-1].ours:
        return DecideOut(should_send=False, reason="fã não falou por último", essay=cfg["essay"])

    last_text = body.messages[-1].text
    # Lock por fã + dedupe 10 min
    lock_key = f"{body.creator_id}:{body.fan_ref}"
    lock = _fan_locks.setdefault(lock_key, asyncio.Lock())
    async with lock:
        ten_min = (datetime.now(BR) - timedelta(minutes=10)).isoformat()
        recent = await db.auto_log.find_one({
            "creator_id": body.creator_id,
            "fan_ref": body.fan_ref,
            "last_fan": scrub(last_text)[:500],
            "decision": {"$in": ["aprovado", "enviado"]},
            "at": {"$gte": ten_min},
        })
        if recent:
            return DecideOut(should_send=False, reason="já respondido", essay=cfg["essay"])
        if await count_today(body.creator_id) >= cfg['max_per_day']:
            return DecideOut(should_send=False, reason="teto diário", essay=cfg["essay"])
        if await count_today(body.creator_id, body.fan_ref) >= cfg['max_per_fan']:
            return DecideOut(should_send=False, reason="teto por fã", essay=cfg["essay"])

        # Distrust / robot
        low = last_text.lower()
        creator = await db.creators.find_one({"id": body.creator_id}, {"name": 1}) or {}
        name_low = (creator.get("name") or "").lower().split()[0] if creator.get("name") else ""
        distrust = ["robô", "robo", "quem tá falando", "automático", "é você mesmo"]
        if name_low: distrust.append(f"é a {name_low}")
        if any(x in low for x in distrust):
            await db.auto_log.insert_one({
                "id": uid(), "at": iso(), "day": today(),
                "creator_id": body.creator_id, "fan_ref": body.fan_ref,
                "fan_name": scrub(body.fan_name or "")[:80] if body.fan_name else None,
                "last_fan": scrub(last_text)[:500],
                "decision": "travado", "reason": "desconfiança",
            })
            return DecideOut(should_send=False, reason="desconfiança", essay=cfg["essay"])

        caption = ""
        after = ""
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
            prod = result.get("product") if isinstance(result, dict) else None
            product_item = prod.get("item") if isinstance(prod, dict) else None
            product_cents = prod.get("cents") if isinstance(prod, dict) else None
            caption = (result.get("caption") or "") if isinstance(result, dict) else ""
            after = (result.get("after") or "") if isinstance(result, dict) else ""
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
        return DecideOut(should_send=should, reason=reason, essay=cfg["essay"], suggested_text=suggested, log_id=lid, product=product_item, product_cents=product_cents, caption=caption, after=after)


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


class WindowIn(BaseModel):
    start: int = 0
    end: int = 24
    days: Optional[list] = None

class ConfigIn(BaseModel):
    creator_id: Optional[str] = None
    enabled: Optional[bool] = None
    essay: Optional[bool] = None
    max_per_day: Optional[int] = None
    max_per_fan: Optional[int] = None
    windows: Optional[list] = None



@router.get("/configs")
async def list_configs(user=Depends(manager)):
    """Lista configs de todas as criadoras para o painel."""
    creators = await db.creators.find({"deleted_at": None}, {"_id": 0, "id": 1, "name": 1}).sort("name", 1).to_list(1000)
    out = []
    for c in creators:
        cfg = await get_config(c["id"])
        today_count = await count_today(c["id"])
        remaining = max(0, cfg["max_per_day"] - today_count)
        out.append({"creator_id": c["id"], "name": c["name"], **cfg, "today": today_count, "remaining": remaining, "limit_hit": remaining <= 0})
    return out

@router.get("/app-configs")
async def app_configs(user=Depends(extension_user)):
    """Configs das criadoras ligadas que o usuário pode ver. Para o app."""
    creators = await db.creators.find({"deleted_at": None}, {"_id": 0, "id": 1, "name": 1}).sort("name", 1).to_list(1000)
    out = []
    for c in creators:
        cfg = await get_config(c["id"])
        if not cfg.get("enabled"): continue
        today_count = await count_today(c["id"])
        remaining = max(0, cfg["max_per_day"] - today_count)
        out.append({"creator_id": c["id"], "name": c["name"], "enabled": True, "essay": cfg["essay"], "windows": cfg["windows"], "max_per_day": cfg["max_per_day"], "max_per_fan": cfg["max_per_fan"], "today": today_count, "remaining": remaining, "limit_hit": remaining <= 0})
    return out

@router.get("/config")
async def get_config_endpoint(creator_id: str = "", user=Depends(manager)):
    return await get_config(creator_id or None)

@router.put("/config")
async def set_config(body: ConfigIn, user=Depends(manager)):
    cid = body.creator_id
    if not cid: raise HTTPException(400, "creator_id obrigatório")
    upd = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None and k != "creator_id"}
    if "max_per_day" in upd and not (1 <= upd["max_per_day"] <= 1000):
        raise HTTPException(400, "max_per_day deve estar entre 1 e 1000")
    if "max_per_fan" in upd and not (1 <= upd["max_per_fan"] <= 50):
        raise HTTPException(400, "max_per_fan deve estar entre 1 e 50")
    if "windows" in upd:
        for w in upd["windows"]:
            if not isinstance(w.get("start"), int) or not isinstance(w.get("end"), int):
                raise HTTPException(400, "start e end devem ser inteiros")
            if not (0 <= w.get("start", 0) <= 24 and 0 <= w.get("end", 24) <= 24):
                raise HTTPException(400, "Faixa de horário inválida (0-24)")
            if w.get("days"):
                if not all(isinstance(d, int) and 0 <= d <= 6 for d in w["days"]):
                    raise HTTPException(400, "days deve conter apenas números de 0 a 6")
    await db.auto_config.update_one({"id": f"creator:{cid}"}, {"$set": {**upd, "creator_id": cid}}, upsert=True)
    return {"ok": True}

@router.post("/config/toggle")
async def toggle_config(creator_id: str, enabled: bool, user=Depends(manager)):
    """Liga/desliga na hora, sem depender dos outros campos."""
    await db.auto_config.update_one({"id": f"creator:{creator_id}"}, {"$set": {"enabled": enabled, "creator_id": creator_id}}, upsert=True)
    return {"ok": True, "enabled": enabled}


@router.get("/request-price")
async def request_price(creator_id: str, item: str, fan_ref: str = "", user=Depends(extension_user)):
    """Devolve o preço da tabela para um item. Só a criadora configurada."""
    cfg = await get_config(creator_id)
    if not cfg.get("enabled"):
        raise HTTPException(403, "Automação desligada para esta criadora")
    if fan_ref and await db.assist_blocked.find_one({"creator_id": creator_id, "fan_ref": fan_ref}):
        return {"ok": False, "motivo": "fã bloqueado"}
    if fan_ref and await db.media_requests.find_one({"creator_id": creator_id, "fan_ref": fan_ref, "status": "aguardando"}):
        return {"ok": False, "motivo": "pedido aguardando entrega"}
    prof = await db.assist_profiles.find_one({"creator_id": creator_id}) or {}
    prices = prof.get("prices") or []
    item_low = item.strip().lower()
    for p in prices:
        if p.get("item", "").strip().lower() == item_low:
            min_cents = p.get("cents", 0)
            return {"ok": True, "item": p["item"], "min_cents": min_cents}
    return {"ok": False, "motivo": "item sem preço", "item": item}


class RequestLogIn(BaseModel):
    creator_id: str
    fan_ref: str
    item: str
    cents: int
    essay: bool = True
    result: str = "ensaio"

@router.post("/request-log")
async def request_log(body: RequestLogIn, user=Depends(extension_user)):
    await db.auto_log.insert_one({
        "id": uid(), "at": iso(), "day": today(),
        "creator_id": body.creator_id, "fan_ref": body.fan_ref,
        "decision": "solicitação", "reason": body.result,
        "item": body.item, "cents": body.cents, "essay": body.essay,
    })
    return {"ok": True}

@router.get("/status")
async def status(creator_id: str = "", user=Depends(extension_user)):
    cfg = await get_config(creator_id or None)
    today_count = await count_today(cfg["creator_id"]) if cfg.get("creator_id") else 0
    remaining = max(0, cfg['max_per_day'] - today_count)
    limit_hit = remaining <= 0
    return {**cfg, "today": today_count, "remaining": remaining, "limit_hit": limit_hit, "limits": {"max_per_day": MAX_PER_DAY, "max_per_fan": MAX_PER_FAN}}
