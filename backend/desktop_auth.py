"""Troca de uso único entre a sessão web Alta Core e seu processo nativo.

Não lê, transporta nem armazena cookies da Privacy. Token nativo só autoriza
rotas /desktop e depende continuamente da sessão web Alta Core de origem.
"""
import secrets
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field
from core import db, now, digest, current_user
from schemas import Strict

router = APIRouter()

class TicketIn(Strict):
    machine_id: str = Field(pattern=r'^[a-f0-9-]{36}$')

class ExchangeIn(TicketIn):
    ticket: str = Field(pattern=r'^[A-Za-z0-9_-]{40,128}$')

def source_session_hash(request):
    return getattr(request.state, 'desktop_session_hash', None) or digest(request.cookies.get('vertice_session', ''))

@router.post('/desktop/auth/ticket')
async def issue_ticket(body: TicketIn, request: Request, user=Depends(current_user)):
    ticket = secrets.token_urlsafe(36)
    await db.desktop_tickets.insert_one({'ticket_hash': digest(ticket), 'machine_id': body.machine_id,
        'user_id': user['id'], 'session_hash': digest(request.cookies['vertice_session']), 'expires_at': now() + timedelta(seconds=45)})
    return {'ticket': ticket, 'expires_in': 45}

@router.post('/desktop/auth/exchange')
async def exchange_ticket(body: ExchangeIn):
    ticket = await db.desktop_tickets.find_one_and_delete({'ticket_hash': digest(body.ticket), 'machine_id': body.machine_id, 'expires_at': {'$gt': now()}})
    if not ticket: raise HTTPException(401, 'A autorização temporária expirou ou já foi utilizada.')
    session = await db.sessions.find_one({'token_hash': ticket['session_hash'], 'user_id': ticket['user_id'], 'expires_at': {'$gt': now()}}, {'_id': 0})
    user = await db.users.find_one({'id': ticket['user_id'], 'active': True}, {'_id': 0})
    if not session or not user: raise HTTPException(401, 'Sua sessão Alta Core terminou. Entre novamente.')
    token = secrets.token_urlsafe(48)
    await db.desktop_tokens.insert_one({'token_hash': digest(token), 'user_id': user['id'], 'machine_id': body.machine_id,
        'session_hash': ticket['session_hash'], 'expires_at': session['expires_at']})
    return {'token': token}

async def native_user(request: Request):
    authorization = request.headers.get('authorization', '')
    if not authorization: return await current_user(request)
    if not authorization.startswith('Bearer '): raise HTTPException(401, 'Autorização do aplicativo inválida.')
    token = await db.desktop_tokens.find_one({'token_hash': digest(authorization[7:]), 'expires_at': {'$gt': now()}}, {'_id': 0})
    if not token: raise HTTPException(401, 'A autorização do aplicativo expirou. Entre novamente.')
    session = await db.sessions.find_one({'token_hash': token['session_hash'], 'user_id': token['user_id'], 'expires_at': {'$gt': now()}}, {'_id': 0})
    user = await db.users.find_one({'id': token['user_id'], 'active': True}, {'_id': 0, 'password_hash': 0})
    if not session or not user: raise HTTPException(401, 'Sua sessão Alta Core terminou. Entre novamente.')
    request.state.desktop_session_hash = token['session_hash']
    request.state.desktop_machine_id = token['machine_id']
    return user