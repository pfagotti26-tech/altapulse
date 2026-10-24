"""
Envio automático — teste Aline Fishborn (modo ensaio).
O servidor só decide e registra. Quem envia é o app de teste.
Desligador: auto_config.enabled no banco, lido a cada mensagem.
"""
from datetime import datetime, timedelta, timezone
import asyncio
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from core import db, iso, uid, manager
from quality_ai import scrub
from extension_routes import extension_user
from zoneinfo import ZoneInfo
import assist as A
import profile_model as PM

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
    platform: str = "privacy"
    wait_s: int = 0
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
        "platforms": doc.get("platforms") or ["privacy"],
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


def current_mode(cfg, now=None, shift_active=False):
    """Devolve (modo, origem): 'ensaio', 'real' ou None (fora das faixas). Ensaio vence sobreposição.
    Turno de chatter ativo força ensaio dentro das faixas (revisão Claude: fora das faixas continua desligado)."""
    now = now or datetime.now(BR)
    h = now.hour
    dow = now.weekday()
    modes = []
    for w in cfg.get("windows") or []:
        start, end = w.get("start", 0), w.get("end", 24)
        days = w.get("days")
        if days and dow not in days: continue
        in_w = start == end or (start <= h < end if start < end else (h >= start or h < end))
        if in_w: modes.append(w.get("mode") or ("ensaio" if cfg.get("essay", True) else "real"))
    if not modes: return None, None
    if shift_active: return "ensaio", "turno"
    if "ensaio" in modes: return "ensaio", "agenda"
    return modes[0], "agenda"

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
    if body.platform not in (cfg.get("platforms") or ["privacy"]):
        raise HTTPException(403, "plataforma desligada")

    # Presence: active shift forces essay
    shift = await db.shifts.find_one({'creator_id': body.creator_id, 'active': True})
    mode, mode_src = current_mode(cfg, shift_active=bool(shift))
    if mode is None:
        return DecideOut(should_send=False, reason="fora do horário", essay=True)

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

    # lote 142 (Claude): fã só encerrou ("ok", "kkk", emoji, "boa noite bjs") depois de fala nossa sem pergunta nem oferta → não chama a IA
    if PM.no_reply_needed([{'ours': m.ours, 'text': m.text} for m in body.messages]):
        await db.auto_log.insert_one({
            "id": uid(), "at": iso(), "day": today(), "creator_id": body.creator_id, "platform": body.platform, "wait_s": body.wait_s,
            "fan_ref": body.fan_ref, "fan_name": scrub(body.fan_name or "")[:80] if body.fan_name else None,
            "last_fan": scrub(body.messages[-1].text)[:500], "decision": "sem resposta", "reason": "fã só encerrou (ok/emoji/tchau)",
        })
        return DecideOut(should_send=False, reason="sem resposta necessária", essay=cfg["essay"])

    last_text = body.messages[-1].text
    # Lock por fã + dedupe 10 min
    lock_key = f"{body.creator_id}:{body.fan_ref}"
    lock = _fan_locks.setdefault(lock_key, asyncio.Lock())
    async with lock:
        ten_min = (datetime.now(BR) - timedelta(minutes=10)).isoformat()
        # lote 180 (revisão Claude): "aprovado" que nunca virou "enviado" (a caixa não preencheu, a conversa trocou...) não conta
        # como respondido depois de 2 min — antes o fã ficava 10 min (e na prática o dia todo) sem resposta com "já respondido"
        two_min = (datetime.now(BR) - timedelta(minutes=2)).isoformat()
        recent = await db.auto_log.find_one({
            "creator_id": body.creator_id,
            "fan_ref": body.fan_ref,
            "last_fan": scrub(last_text)[:500],
            "$or": [{"decision": "enviado", "at": {"$gte": ten_min}}, {"decision": "aprovado", "at": {"$gte": two_min}}],
        })
        if recent:
            return DecideOut(should_send=False, reason="já respondido", essay=cfg["essay"])
        # lote 160: passagem para humano — fã que cumpriu uma regra vai para o chatter atribuído (a IA para ou segue sem oferta cara)
        _hv = {}
        try:
            import handover as H
            _hv = await H.gate(body.creator_id, body.fan_ref, body.fan_name, body.messages, create=(mode != "ensaio"))
        except Exception as e:
            logging.getLogger("auto").warning("passagem: %s", e)
        if _hv.get("block"):
            await db.auto_log.insert_one({
                "id": uid(), "at": iso(), "day": today(), "creator_id": body.creator_id, "platform": body.platform,
                "fan_ref": body.fan_ref, "fan_name": scrub(body.fan_name or "")[:80] if body.fan_name else None,
                "last_fan": scrub(last_text)[:500], "decision": "passagem", "reason": _hv["block"],
            })
            return DecideOut(should_send=False, reason=_hv["block"], essay=cfg["essay"])
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
        # lote 185: conversa travada por "tema proibido" que um humano da equipe já respondeu volta para a automação.
        # A trava em si não muda: palavra de família do fã, bloqueio da equipe e o alerta da IA continuam valendo para o que vier
        # depois. Só deixamos de reler o trecho antigo (já revisado por gente) que fazia a IA travar de novo a cada mensagem.
        decide_msgs = list(body.messages)
        released = ""
        try:
            _trav = await db.auto_log.find_one({"creator_id": body.creator_id, "fan_ref": body.fan_ref, "decision": "travado",
                                                "reason": {"$regex": "proibido", "$options": "i"},
                                                "at": {"$gte": ((datetime.now(timezone.utc) - timedelta(days=3))).isoformat()}}, {"_id": 0, "last_fan": 1, "at": 1}, sort=[("at", -1)])
            _last_ok = await db.auto_log.find_one({"creator_id": body.creator_id, "fan_ref": body.fan_ref, "decision": "enviado"}, {"_id": 0, "at": 1}, sort=[("at", -1)]) if _trav else None
            if _trav and not (_last_ok and _last_ok.get("at", "") > _trav.get("at", "")):
                _flag = scrub(_trav.get("last_fan") or "")[:500]
                _i = next((i for i in range(len(decide_msgs) - 1, -1, -1) if not decide_msgs[i].ours and scrub(decide_msgs[i].text or "")[:500] == _flag), -1)
                if _i >= 0:
                    _auto_sent = {str(r.get("suggested_text") or "").strip() for r in await db.auto_log.find(
                        {"creator_id": body.creator_id, "fan_ref": body.fan_ref, "decision": "enviado",
                         "at": {"$gte": ((datetime.now(timezone.utc) - timedelta(days=3))).isoformat()}}, {"_id": 0, "suggested_text": 1}).to_list(50)}
                    _j = next((j for j in range(_i + 1, len(decide_msgs)) if decide_msgs[j].ours and str(decide_msgs[j].text or "").strip() and str(decide_msgs[j].text or "").strip() not in _auto_sent), -1)
                    if _j >= 0 and any(not m.ours and (m.text or "").strip() for m in decide_msgs[_j + 1:]) \
                            and not any(PM.family_word(m.text or "") for m in decide_msgs[_j + 1:] if not m.ours):
                        decide_msgs = decide_msgs[_j:]
                        released = "liberada: humano respondeu depois da trava"
        except Exception as e:
            logging.getLogger("auto").warning("liberar trava: %s", e)
        # Call existing suggest logic
        try:
            suggest_body = A.SuggestIn(
                creator_id=body.creator_id,
                platform=body.platform,
                fan_ref=body.fan_ref,
                messages=[A.ChatMsg(ours=m.ours, text=m.text) for m in decide_msgs],
                mode='reply',
                max_cents=_hv.get("max_cents"),
            )
            result = await A.suggest(suggest_body, user)
            # lote 177 (revisão Claude): "tema proibido" dado pela IA sem o fã ter escrito palavra proibida costuma ser a IA lendo
            # as boas-vindas da própria criadora ("novinha"...). Segunda opinião sem as mensagens longas nossas (boas-vindas/em massa).
            # Palavra de família do fã ou bloqueio da equipe continuam travando direto (vêm com "blocked").
            second = None
            if isinstance(result, dict) and result.get("alert") and not result.get("blocked") and "proibido" in str(result.get("reason") or "").lower():
                import profile_model as PM2
                fan_txt = [m.text for m in decide_msgs[-6:] if not m.ours and m.text]
                if not any(PM2.family_word(t) for t in fan_txt):
                    trimmed = [m for m in decide_msgs if not (m.ours and len(m.text or "") > 280)]
                    if trimmed and len(trimmed) < len(decide_msgs):
                        suggest_body2 = A.SuggestIn(creator_id=body.creator_id, platform=body.platform, fan_ref=body.fan_ref,
                                                    messages=[A.ChatMsg(ours=m.ours, text=m.text) for m in trimmed], mode='reply', max_cents=_hv.get("max_cents"))
                        r2 = await A.suggest(suggest_body2, user)
                        second = "liberou" if (isinstance(r2, dict) and not r2.get("alert")) else "manteve"
                        if second == "liberou": result = r2
            if isinstance(result, dict) and result.get("alert"):
                await db.auto_log.insert_one({
                    "id": uid(), "at": iso(), "day": today(),
                    "creator_id": body.creator_id, "fan_ref": body.fan_ref,
                "fan_name": scrub(body.fan_name or "")[:80] if body.fan_name else None,
                    "last_fan": scrub(last_text)[:500],
                    "decision": "travado", "reason": result.get("reason", "alerta"),
                    **({"second_opinion": second} if second else {}),
                })
                try:  # lote 160: avisa quem tem a criadora atribuída
                    import handover as H
                    _r = str(result.get("reason") or "")
                    _rl = _r.lower()
                    _menor = any(s in _rl for s in ("menor", "idade", "anos", "adolescente", "escola", "colegial"))
                    _encerrada = result.get("blocked") or "encerrada" in _rl or "bloqueado" in _rl
                    _ev = ("reclamacao" if "pagou e não recebeu" in _r else "divulgacao" if "divulgando" in _r
                           else "encontro" if ("encontro" in _r or "programa" in _r)
                           else "menor" if _menor else (None if _encerrada else "travado" if "proibido" in _rl else None))
                    if _ev:
                        _body = _r[:300]
                        if _ev == "travado":
                            _body = _r[:100] + " · " + scrub(last_text)[:200]
                            _title = "Conversa travada: responda à mão"
                        elif _ev == "menor":
                            _body = "Não responda a este fã. " + _r[:100] + " · " + scrub(last_text)[:200]
                            _title = "Possível menor: NÃO responda — gestor revisa"
                        else:
                            _title = H.EVENTS[_ev]["label"]
                        await H.notify(_ev, body.creator_id, _title, _body, body.fan_ref, body.fan_name)
                except Exception:
                    pass
                return DecideOut(should_send=False, reason=result.get("reason", "alerta"), essay=cfg["essay"])
            suggested = result.get("text") if isinstance(result, dict) else None
            prod = result.get("product") if isinstance(result, dict) else None
            product_item = prod.get("item") if isinstance(prod, dict) else None
            product_cents = prod.get("cents") if isinstance(prod, dict) else None
            caption = (result.get("caption") or "") if isinstance(result, dict) else ""
            after = (result.get("after") or "") if isinstance(result, dict) else ""
            try:  # lote 156: memória do fã também na automação (fatos já filtrados pela Alta Ajuda)
                _facts = result.get("facts") if isinstance(result, dict) else None
                if _facts and body.fan_ref:
                    import fan_memory as FM
                    await FM.save_auto(body.creator_id, body.fan_ref, _facts)
            except Exception:
                pass
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

        essay_mode = mode == "ensaio"
        should = not essay_mode
        decision = "ensaio" if essay_mode else "aprovado"
        reason = "ensaio (turno do chatter)" if mode_src == "turno" else ("modo ensaio — não envia" if essay_mode else "aprovado")
        lid = uid()
        await db.auto_log.insert_one({
            "id": lid, "at": iso(), "day": today(),
            "creator_id": body.creator_id, "platform": body.platform, "wait_s": body.wait_s, "fan_ref": body.fan_ref,
            "fan_name": scrub(body.fan_name or "")[:80] if body.fan_name else None,
            "last_fan": scrub(last_text)[:500],
            "decision": decision, "reason": reason, "mode_src": mode_src,
            **({"released": released} if released else {}),
            "suggested_text": suggested,
            "usage_id": (result.get("usage_id") if isinstance(result, dict) else None),
        })
        return DecideOut(should_send=should, reason=reason, essay=essay_mode, suggested_text=suggested, log_id=lid, product=product_item, product_cents=product_cents, caption=caption, after=after)


@router.get("/report")
async def report(day: str = "", creator_id: str = "", user=Depends(manager)):
    """Resumo e lista do dia para o painel de teste. Só gestor."""
    d = day or today()
    q = {"day": d}
    if creator_id: q["creator_id"] = creator_id
    rows = await db.auto_log.find(q, {"_id": 0}).sort("at", -1).to_list(500)
    usage_q = {"day": d}
    if creator_id: usage_q["creator_id"] = creator_id
    usage = await db.assist_usage.aggregate([
        {"$match": usage_q},
        {"$group": {"_id": None, "cost": {"$sum": "$cost_usd"}, "calls": {"$sum": 1}}}
    ]).to_list(1)
    cost = usage[0]["cost"] if usage else 0
    calls = usage[0]["calls"] if usage else 0
    waits = [r.get("wait_s") or 0 for r in rows if r.get("wait_s")]
    summary = {
        "day": d,
        "wait_avg": round(sum(waits)/len(waits)/60, 1) if waits else 0,
        "wait_max": round(max(waits)/60, 1) if waits else 0,
        "wait_over5": sum(1 for w in waits if w > 300),
        "ensaios": sum(1 for r in rows if r.get("decision") == "ensaio"),
        "travados": sum(1 for r in rows if r.get("decision") == "travado"),
        "erros": sum(1 for r in rows if r.get("decision") == "erro"),
        "motivos": {},
        "cost_usd": round(cost or 0, 4),
        "calls": calls,
    }
    labels = {"mídia": "mídia paga", "pago": "mídia paga", "bloqueado": "bloqueado", "proibido": "tema proibido", "encontro": "encontro"}
    for r in rows:
        if r.get("decision") == "travado":
            raw = (r.get("reason") or "").lower()
            label = next((v for k, v in labels.items() if k in raw), "outro")
            summary["motivos"][label] = summary["motivos"].get(label, 0) + 1
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
    # lote 142d (Claude): a Sombra passa a ver o envio da automação (antes ficava "sem resposta")
    log = await db.auto_log.find_one({"id": log_id}, {"_id": 0, "usage_id": 1, "suggested_text": 1})
    if log and log.get("usage_id"):
        await db.shadow_actions.update_one({"usage_id": log["usage_id"], "status": "pendente"},
            {"$set": {"sent": (log.get("suggested_text") or "")[:1200], "sent_at": iso(), "similarity": 1.0, "status": "igual", "by_auto": True}})
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
    platforms: Optional[list] = None



@router.get("/configs")
async def list_configs(user=Depends(manager)):
    """Lista configs de todas as criadoras para o painel."""
    creators = await db.creators.find({"deleted_at": None}, {"_id": 0, "id": 1, "name": 1, "avatar": 1}).sort("name", 1).to_list(1000)
    out = []
    for c in creators:
        cfg = await get_config(c["id"])
        today_count = await count_today(c["id"])
        today_essay = await db.auto_log.count_documents({"day": today(), "creator_id": c["id"], "decision": "ensaio"})
        remaining = max(0, cfg["max_per_day"] - today_count)
        prof = await db.assist_profiles.find_one({"creator_id": c["id"]}) or {}
        ficha = bool(prof.get("persona") and prof.get("prices"))
        _shift = await db.shifts.find_one({'creator_id': c["id"], 'active': True}, {'_id': 1})
        mode_now, mode_src = current_mode(cfg, shift_active=bool(_shift))
        out.append({"creator_id": c["id"], "name": c["name"], "avatar": c.get("avatar"), **cfg, "today": today_count, "today_essay": today_essay, "remaining": remaining, "limit_hit": remaining <= 0, "ficha_pronta": ficha, "mode_now": mode_now, "mode_src": mode_src})
    return out

@router.get("/app-configs")
async def app_configs(user=Depends(extension_user)):
    """Configs das criadoras ligadas que o usuário pode ver. Para o app."""
    creators = await db.creators.find({"deleted_at": None}, {"_id": 0, "id": 1, "name": 1, "avatar": 1}).sort("name", 1).to_list(1000)
    out = []
    for c in creators:
        cfg = await get_config(c["id"])
        if not cfg.get("enabled"): continue
        today_count = await count_today(c["id"])
        remaining = max(0, cfg["max_per_day"] - today_count)
        out.append({"creator_id": c["id"], "name": c["name"], "enabled": True, "essay": cfg["essay"], "windows": cfg["windows"], "platforms": cfg.get("platforms") or ["privacy"], "max_per_day": cfg["max_per_day"], "max_per_fan": cfg["max_per_fan"], "today": today_count, "remaining": remaining, "limit_hit": remaining <= 0})
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
    if "platforms" in upd:
        if not all(p in ("privacy", "fatalfans") for p in upd["platforms"]):
            raise HTTPException(400, "Plataforma inválida")
    if "windows" in upd:
        for w in upd["windows"]:
            if not isinstance(w.get("start"), int) or not isinstance(w.get("end"), int):
                raise HTTPException(400, "start e end devem ser inteiros")
            if not (0 <= w.get("start", 0) <= 24 and 0 <= w.get("end", 24) <= 24):
                raise HTTPException(400, "Faixa de horário inválida (0-24)")
            if w.get("days"):
                if not all(isinstance(d, int) and 0 <= d <= 6 for d in w["days"]):
                    raise HTTPException(400, "days deve conter apenas números de 0 a 6")
            if w.get("mode") and w["mode"] not in ("ensaio", "real"):
                raise HTTPException(400, "mode deve ser ensaio ou real")
    await db.auto_config.update_one({"id": f"creator:{cid}"}, {"$set": {**upd, "creator_id": cid}}, upsert=True)
    return {"ok": True}

@router.post("/config/toggle")
async def toggle_config(creator_id: str, enabled: bool, user=Depends(manager)):
    """Liga/desliga na hora, sem depender dos outros campos."""
    if enabled:
        prof = await db.assist_profiles.find_one({"creator_id": creator_id}) or {}
        if not (prof.get("persona") and prof.get("prices")):
            raise HTTPException(400, "Preencha a ficha da IA antes de ligar")
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
            if fan_ref:  # lote 143: fã em teste de faixa → o mínimo é a faixa dele (pode ser abaixo da tabela, ex.: 39,90)
                from price_test import active_test
                t = await active_test(creator_id, p["item"])
                a = t and await db.price_test_assign.find_one({"test_id": t["id"], "fan_ref": fan_ref}, {"_id": 0, "cents": 1})
                if a: min_cents = a["cents"]
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
