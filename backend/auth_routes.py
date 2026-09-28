import secrets, hashlib
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from schemas import Login, Setup
from responses import UserOut, MeOut
from core import db, now, iso, uid, digest, current_user, lock, settings

router = APIRouter()
def hash_password(value):
    salt = secrets.token_hex(16)
    return salt + ':' + hashlib.scrypt(value.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
def verify_password(value, encoded):
    salt, hashed = encoded.split(':')
    return secrets.compare_digest(hashlib.scrypt(value.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex(), hashed)
async def session_response(user, response):
    token = secrets.token_urlsafe(40)
    await db.sessions.insert_one({'token_hash': digest(token), 'user_id': user['id'], 'expires_at': now() + timedelta(hours=12)})
    response.set_cookie('vertice_session', token, httponly=True, secure=True, samesite='lax', max_age=43200, path='/api')
    return {k: v for k, v in user.items() if k not in ['_id', 'password_hash']}
@router.get('/auth/status')
async def status(): return {'setup_required': await db.users.count_documents({}) == 0}
@router.post('/auth/setup', response_model=UserOut)
async def setup(body: Setup, response: Response):
    async with lock:
        if await db.users.count_documents({}): raise HTTPException(409, 'O gestor inicial já foi cadastrado.')
        doc = {'id': uid(), 'name': body.name, 'email': str(body.email).lower(), 'role': 'manager', 'active': True,
            'creator_ids': [], 'password_hash': hash_password(body.password), 'created_at': iso()}
        await db.users.insert_one(doc.copy())
        await db.settings.update_one({'id': 'main'}, {'$set': {'agency_name': body.agency_name, 'sla_minutes': 5, 'retention_days': 90, 'storage_allowed': False}}, upsert=True)
        return await session_response(doc, response)
@router.post('/auth/login', response_model=UserOut)
async def login(body: Login, request: Request, response: Response):
    key = digest(str(body.email).lower() + ':' + (request.client.host if request.client else 'unknown'))
    attempt = await db.login_limits.find_one({'id': key})
    if attempt and attempt['count'] >= 10 and attempt['last_at'] > (now() - timedelta(minutes=15)).isoformat():
        raise HTTPException(429, 'Muitas tentativas. Aguarde 15 minutos.')
    user = await db.users.find_one({'email': str(body.email).lower(), 'active': True}, {'_id': 0})
    if not user or not verify_password(body.password, user['password_hash']):
        count = (attempt['count'] if attempt and attempt['last_at'] > (now() - timedelta(minutes=15)).isoformat() else 0) + 1
        await db.login_limits.update_one({'id': key}, {'$set': {'count': count, 'last_at': iso()}}, upsert=True)
        raise HTTPException(401, 'E-mail ou senha incorretos.')
    await db.login_limits.delete_one({'id': key})
    return await session_response(user, response)
@router.get('/auth/me', response_model=MeOut)
async def me(user=Depends(current_user)): return {'user': user, 'settings': await settings()}
@router.post('/auth/logout')
async def logout(request: Request, response: Response):
    await db.sessions.delete_many({'token_hash': digest(request.cookies.get('vertice_session', ''))})
    response.delete_cookie('vertice_session', path='/api')
    return {'ok': True}