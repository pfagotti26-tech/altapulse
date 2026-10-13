"""
Envio automático — teste Aline Fishborn.
Modo ensaio por padrão: grava o que enviaria, mas não envia.
Tudo desligado até autorização explícita.
"""
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/auto", tags=["auto"])

# Flag global de emergência (pode ser desligada sem deploy)
AUTO_ENABLED = False  # muda para True só após autorização
ESSAY_MODE = True     # True = só grava, False = envia de verdade

class AutoConfig(BaseModel):
    max_per_day: int = 30
    max_per_fan: int = 3
    min_delay_ms: int = 8000
    max_delay_ms: int = 25000
    plantao_start: str = "22:00"
    plantao_end: str = "06:00"

# Placeholder — será preenchido com a lógica real depois
async def should_respond(fan_last_msg: str, creator_id: str, presence_active: bool) -> tuple[bool, str]:
    if not AUTO_ENABLED:
        return False, "automação desligada"
    if presence_active:
        return False, "chatter ativo"
    # outras travas virão aqui
    return True, "ok"

@router.get("/status")
async def status():
    return {
        "enabled": AUTO_ENABLED,
        "essay_mode": ESSAY_MODE,
        "creator": "Aline Fishborn",
        "note": "Modo ensaio: grava, não envia"
    }

@router.post("/kill")
async def kill_switch():
    global AUTO_ENABLED
    AUTO_ENABLED = False
    return {"ok": True, "message": "Automação desligada"}
