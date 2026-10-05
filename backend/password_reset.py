"""Esqueci minha senha e convite por e-mail.

Fluxo: a pessoa informa o e-mail → se existir, recebe um link com um código aleatório (guardado só como hash,
30 min, uso único) → define a senha nova → sessões antigas caem e ela já entra logada.
O convite de integrante usa o mesmo mecanismo com validade de 48 h.
"""
import secrets
from datetime import timedelta
from typing import Literal
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from core import db, now, iso, uid, digest, audit, ORIGIN
import mailer

router = APIRouter()
VALIDITY = {'reset': timedelta(minutes=30), 'invite': timedelta(hours=48)}

class ForgotIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: EmailStr
class ResetIn(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=False)
    token: str = Field(min_length=20, max_length=120)
    new_password: str = Field(min_length=10, max_length=128)
    confirm_password: str = Field(min_length=10, max_length=128)
    @field_validator('new_password')
    @classmethod
    def strong(cls, v):
        if v != v.strip(): raise ValueError('Não use espaços no início ou no fim da senha.')
        if not any(c.isalpha() for c in v) or not any(c.isdigit() for c in v): raise ValueError('Use pelo menos uma letra e um número.')
        return v
    @model_validator(mode='after')
    def same(self):
        if self.new_password != self.confirm_password: raise ValueError('A confirmação da senha não confere.')
        return self

async def _too_many(key, limit, minutes=15):
    since = (now() - timedelta(minutes=minutes)).isoformat()
    return await db.password_resets.count_documents({'limit_key': key, 'created_at': {'$gt': since}}) >= limit

async def issue_link(user, kind: Literal['reset', 'invite'], limit_key=None):
    """Cria o código, guarda o hash e devolve o link completo do painel."""
    token = secrets.token_urlsafe(32)
    await db.password_resets.insert_one({'id': uid(), 'user_id': user['id'], 'token_hash': digest(token), 'kind': kind,
        'limit_key': limit_key, 'created_at': iso(), 'expires_at': now() + VALIDITY[kind], 'used_at': None})
    return f'{ORIGIN}/redefinir-senha?t={token}'

async def send_invite_if_possible(user, inviter_name=None):
    """Convite de integrante: só manda se o e-mail estiver configurado. Devolve True se enviou."""
    if not mailer.configured(): return False
    link = await issue_link(user, 'invite')
    return await mailer.send_invite(user, link, inviter_name)

@router.get('/auth/mail-status')
async def mail_status(): return {'configured': mailer.configured()}

@router.post('/auth/forgot')
async def forgot(body: ForgotIn, request: Request):
    """Sempre responde igual, exista ou não o e-mail (ninguém descobre quem é da equipe testando endereços)."""
    if not mailer.configured(): raise HTTPException(503, 'O envio de e-mail ainda não está configurado neste painel. Peça ao seu gestor uma nova senha inicial.')
    email = str(body.email).lower()
    ip = request.client.host if request.client else 'unknown'
    if await _too_many('email:' + digest(email), 3) or await _too_many('ip:' + digest(ip), 12): return {'ok': True}
    user = await db.users.find_one({'email': email, 'active': True}, {'_id': 0, 'password_hash': 0})
    if user:
        link = await issue_link(user, 'reset', 'email:' + digest(email))
        await db.password_resets.insert_one({'id': uid(), 'user_id': user['id'], 'token_hash': None, 'kind': 'ip-mark', 'limit_key': 'ip:' + digest(ip), 'created_at': iso(), 'expires_at': now(), 'used_at': iso()})
        await mailer.send_reset(user, link)
    else:
        # marca a tentativa para o limite por IP valer também para e-mails desconhecidos
        await db.password_resets.insert_one({'id': uid(), 'user_id': None, 'token_hash': None, 'kind': 'ip-mark', 'limit_key': 'ip:' + digest(ip), 'created_at': iso(), 'expires_at': now(), 'used_at': iso()})
    return {'ok': True}

async def _valid(token):
    row = await db.password_resets.find_one({'token_hash': digest(token), 'used_at': None, 'expires_at': {'$gt': now()}}, {'_id': 0})
    user = await db.users.find_one({'id': row['user_id'], 'active': True}, {'_id': 0, 'password_hash': 0}) if row else None
    return row, user

@router.get('/auth/reset/{token}')
async def check(token: str):
    row, user = await _valid(token)
    if not user: return {'valid': False}
    e = user['email']; masked = e[0] + '***' + e[e.index('@') - 1:] if '@' in e and len(e) > 3 else e
    return {'valid': True, 'kind': row['kind'], 'name': user['name'], 'email': masked}

@router.post('/auth/reset')
async def reset(body: ResetIn, response: Response):
    from auth_routes import hash_password, session_response
    row, user = await _valid(body.token)
    if not user: raise HTTPException(410, 'Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".')
    update = {'password_hash': hash_password(body.new_password), 'must_change_password': False, 'password_changed_at': iso(), 'auth_version': (user.get('auth_version') or 0) + 1}
    await db.users.update_one({'id': user['id']}, {'$set': update})
    await db.password_resets.update_many({'user_id': user['id'], 'used_at': None}, {'$set': {'used_at': iso()}})  # invalida qualquer outro link pendente
    await db.sessions.delete_many({'user_id': user['id']})
    await db.extension_tokens.delete_many({'user_id': user['id']})
    await audit(user, 'Senha definida pelo link do convite' if row['kind'] == 'invite' else 'Senha redefinida por e-mail (esqueci minha senha)', user['id'])
    return await session_response({**user, **update}, response)

async def purge():
    """Limpeza diária: registros vencidos há mais de 7 dias."""
    await db.password_resets.delete_many({'expires_at': {'$lt': now() - timedelta(days=7)}})
