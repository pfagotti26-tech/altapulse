import os, secrets, hashlib, asyncio
from pathlib import Path
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import Request, HTTPException, Depends

load_dotenv(Path(__file__).parent / '.env')
ORIGIN = os.environ['APP_ORIGIN']
TRUSTED_ORIGINS = [ORIGIN, os.environ['INGRESS_APP_ORIGIN']]
client = AsyncIOMotorClient(os.environ['MONGO_URL'], tz_aware=True)
db = client[os.environ['DB_NAME']]
lock = asyncio.Lock()
# preparo para várias agências: todo dado NOVO já nasce marcado com a agência dona (hoje só existe a Alta)
WORKSPACE = os.environ.get('WORKSPACE_ID', 'alta')
def now(): return datetime.now(timezone.utc)
def iso(): return now().isoformat()
def uid(): return secrets.token_hex(12)
def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def clean_time(value):
    if value.tzinfo is None: raise HTTPException(422, 'Informe o fuso horário.')
    return value.astimezone(timezone.utc).isoformat()
async def settings():
    return await db.settings.find_one({'id': 'main'}, {'_id': 0}) or {'id': 'main', 'agency_name': 'Minha agência', 'sla_minutes': 5, 'retention_days': 90, 'storage_allowed': False}
async def expiration(): return now() + timedelta(days=(await settings())['retention_days'])
async def audit(user, action, target, changes=None, reason=None):
    await db.audit.insert_one({'id': uid(), 'actor_id': user['id'], 'actor': user['name'], 'action': action,
        'target': target, 'changes': changes, 'reason': reason, 'created_at': iso(), 'expires_at': await expiration()})
async def current_user(request: Request):
    token = request.cookies.get('vertice_session')
    if not token: raise HTTPException(401, 'Entre na sua conta para continuar.')
    session = await db.sessions.find_one({'token_hash': digest(token), 'expires_at': {'$gt': now()}}, {'_id': 0})
    user = await db.users.find_one({'id': session['user_id'], 'active': True}, {'_id': 0, 'password_hash': 0}) if session else None
    if not user: raise HTTPException(401, 'Sessão expirada. Entre novamente.')
    if session.get('auth_version', 0) != user.get('auth_version', 0):
        raise HTTPException(401, 'Sua senha foi alterada. Entre novamente.')
    if user.get('must_change_password') and request.url.path not in {'/api/auth/me', '/api/auth/password', '/api/auth/logout'}:
        raise HTTPException(403, 'Defina sua senha pessoal antes de acessar o painel.')
    return user
async def manager(user=Depends(current_user)):
    if user['role'] != 'manager': raise HTTPException(403, 'Acesso exclusivo do gestor.')
    return user
async def creator_access(creator_id, user):
    creator = await db.creators.find_one({'id': creator_id, 'deleted_at': None}, {'_id': 0})
    if not creator: raise HTTPException(404, 'Criadora não encontrada.')
    if user['role'] != 'manager' and creator_id not in user['creator_ids']:
        raise HTTPException(403, 'Este perfil não está autorizado para você.')
    return creator
async def assign_shift(creator_id, at):
    if not at: return None
    shifts = await db.shifts.find({'creator_id': creator_id, 'started_at': {'$lte': at},
        '$or': [{'ended_at': None}, {'ended_at': {'$gt': at}}]}, {'_id': 0}).to_list(3)
    return shifts[0] if len(shifts) == 1 else None