"""Controle do Alta Pulse Desktop. Nunca recebe credenciais ou sessões da Privacy."""
import json
from pathlib import Path
from datetime import timedelta, datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import Field
from core import db, now, uid, iso, lock, digest, current_user, manager, creator_access, audit
from schemas import Strict
from responses import Public
from desktop_auth import native_user, source_session_hash

router = APIRouter()
RELEASE = Path(__file__).parent.parent / 'desktop' / 'release'

class DeviceIn(Strict):
    machine_id: str = Field(pattern=r'^[a-f0-9-]{36}$')
    name: str = Field(min_length=2, max_length=80)
    version: str = Field(pattern=r'^\d+\.\d+\.\d+$')

class DeviceAction(Strict):
    action: Literal['approve', 'revoke']

class DeviceOut(Public):
    id: str
    user_id: str
    user_name: str
    name: str
    version: str
    status: Literal['pending', 'approved', 'revoked']
    created_at: str
    last_seen: str

class LeaseIn(Strict):
    machine_id: str = Field(pattern=r'^[a-f0-9-]{36}$')
    creator_id: str = Field(pattern=r'^[a-f0-9]{24}$')

class LeaseOut(Public):
    id: str
    creator_id: str
    creator_name: str
    operator_id: str
    device_id: str
    expires_at: datetime
    mode: Literal['work', 'setup']

def release_info():
    if (RELEASE / 'blocked.flag').exists(): return {'available': False, 'message': 'O instalador está recebendo uma atualização.'}
    manifest = RELEASE / 'manifest.json'
    if not manifest.exists(): return {'available': False, 'message': 'O instalador está sendo preparado.'}
    data = json.loads(manifest.read_text())
    binary = RELEASE / data['filename']
    if not binary.is_file() or binary.stat().st_size != data['size_bytes']: return {'available': False, 'message': 'Instalador temporariamente indisponível.'}
    return {'available': True, **data, 'signed': False, 'windows_validated': False,
            'session_model': 'per_machine', 'session_sync': False, 'monitoring_validated': False}

@router.get('/desktop/release')
async def public_release(): return release_info()

@router.get('/desktop/download/windows')
async def installer():
    data = release_info()
    if not data['available']: raise HTTPException(503, data['message'])
    return FileResponse(RELEASE / data['filename'], filename=data['filename'], media_type='application/octet-stream',
        headers={'X-Checksum-SHA256': data['sha256']})

@router.post('/desktop/devices/register', response_model=DeviceOut)
async def register_device(body: DeviceIn, request: Request, user=Depends(native_user)):
    if getattr(request.state, 'desktop_machine_id', body.machine_id) != body.machine_id: raise HTTPException(403, 'Computador não corresponde à autorização.')
    async with lock:
        match = {'machine_id': body.machine_id, 'user_id': user['id']}
        current = await db.desktop_devices.find_one(match, {'_id': 0})
        if not current:
            current = {**match, 'id': uid(), 'created_at': iso(), 'status': 'approved' if user['role'] == 'manager' else 'pending'}
            await db.desktop_devices.insert_one(current.copy())
            await audit(user, 'Computador cadastrado', body.name, {'status': current['status']})
        update = {'name': body.name, 'version': body.version, 'user_name': user['name'], 'last_seen': iso()}
        await db.desktop_devices.update_one(match, {'$set': update})
    return {**current, **update}

@router.get('/desktop/devices', response_model=list[DeviceOut])
async def devices(user=Depends(current_user)):
    query = {} if user['role'] == 'manager' else {'user_id': user['id']}
    return await db.desktop_devices.find(query, {'_id': 0, 'machine_id': 0}).sort('last_seen', -1).to_list(1000)

@router.post('/desktop/devices/{device_id}/action', response_model=DeviceOut)
async def device_action(device_id: str, body: DeviceAction, user=Depends(manager)):
    async with lock:
        device = await db.desktop_devices.find_one({'id': device_id}, {'_id': 0})
        if not device: raise HTTPException(404, 'Computador não encontrado.')
        status = 'approved' if body.action == 'approve' else 'revoked'
        await db.desktop_devices.update_one({'id': device_id}, {'$set': {'status': status}})
        if status == 'revoked': await db.desktop_leases.delete_many({'device_id': device_id})
        await audit(user, 'Computador autorizado' if status == 'approved' else 'Acesso do computador revogado', device['name'])
    return {**device, 'status': status}

async def authorized_device(machine_id, user):
    device = await db.desktop_devices.find_one({'machine_id': machine_id, 'user_id': user['id']}, {'_id': 0})
    if not device: raise HTTPException(403, 'Registre este computador pelo aplicativo instalado.')
    if device['status'] != 'approved':
        raise HTTPException(403, 'Este computador aguarda autorização de um gestor.' if device['status'] == 'pending' else 'O acesso deste computador foi revogado.')
    return device

async def browser_mode(creator_id, user):
    shift = await db.shifts.find_one({'creator_id': creator_id, 'active': True}, {'_id': 0})
    if shift and shift['operator_id'] == user['id'] and not shift['paused']: return 'work'
    if user['role'] == 'manager' and (not shift or shift['paused']): return 'setup'
    if shift and shift['operator_id'] != user['id']: raise HTTPException(409, 'Esta criadora está em atendimento por outro operador.')
    raise HTTPException(409, 'Inicie ou retome seu turno antes de abrir o atendimento.')

@router.post('/desktop/leases', response_model=LeaseOut)
async def acquire_lease(body: LeaseIn, request: Request, user=Depends(native_user)):
    if getattr(request.state, 'desktop_machine_id', body.machine_id) != body.machine_id: raise HTTPException(403, 'Computador não corresponde à autorização.')
    async with lock:
        creator = await creator_access(body.creator_id, user)
        device = await authorized_device(body.machine_id, user)
        mode = await browser_mode(body.creator_id, user)
        previous = await db.desktop_leases.find_one({'creator_id': body.creator_id, 'expires_at': {'$gt': now()}}, {'_id': 0})
        session_hash = source_session_hash(request)
        if previous and (previous['device_id'] != device['id'] or previous['operator_id'] != user['id'] or previous['session_hash'] != session_hash):
            raise HTTPException(409, 'O perfil está aberto em outro acesso. Feche-o lá antes de continuar.')
        row = {'id': previous['id'] if previous else uid(), 'creator_id': body.creator_id, 'creator_name': creator['name'],
            'operator_id': user['id'], 'device_id': device['id'], 'machine_id': body.machine_id, 'session_hash': session_hash,
            'mode': mode, 'expires_at': now() + timedelta(seconds=45)}
        await db.desktop_leases.replace_one({'creator_id': body.creator_id}, row.copy(), upsert=True)
        if not previous: await audit(user, 'Navegador integrado aberto', creator['name'], {'device': device['name'], 'mode': mode})
    return row

@router.post('/desktop/leases/{lease_id}/heartbeat', response_model=LeaseOut)
async def renew_lease(lease_id: str, request: Request, user=Depends(native_user)):
    async with lock:
        row = await db.desktop_leases.find_one({'id': lease_id, 'operator_id': user['id'], 'session_hash': source_session_hash(request), 'expires_at': {'$gt': now()}}, {'_id': 0})
        if not row: raise HTTPException(409, 'A autorização do navegador expirou ou foi encerrada.')
        if getattr(request.state, 'desktop_machine_id', row['machine_id']) != row['machine_id']: raise HTTPException(403, 'Computador não corresponde à autorização.')
        await creator_access(row['creator_id'], user)
        await authorized_device(row['machine_id'], user)
        mode = await browser_mode(row['creator_id'], user)
        row.update({'expires_at': now() + timedelta(seconds=45), 'mode': mode})
        await db.desktop_leases.update_one({'id': lease_id}, {'$set': {'expires_at': row['expires_at'], 'mode': mode}})
        await db.desktop_devices.update_one({'id': row['device_id']}, {'$set': {'last_seen': iso()}})
        return row

@router.delete('/desktop/leases/{lease_id}')
async def release_lease(lease_id: str, request: Request, user=Depends(native_user)):
    query = {'id': lease_id, 'operator_id': user['id'], 'session_hash': source_session_hash(request)}
    if getattr(request.state, 'desktop_machine_id', None): query['machine_id'] = request.state.desktop_machine_id
    await db.desktop_leases.delete_one(query)
    return {'ok': True}