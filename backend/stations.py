import os, secrets, io, zipfile, json
from pathlib import Path
from datetime import timedelta
from typing import Literal
from pydantic import Field
from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import Response
from core import db, now, iso, uid, digest, current_user, manager, creator_access, audit, expiration, settings, lock, ORIGIN
from schemas import Strict, Observation
from responses import CommandOut

router = APIRouter()
class Pair(Strict):
    code: str = Field(min_length=16, max_length=40)
    name: str = Field(min_length=2, max_length=60)
class BrowserState(Strict):
    creator_id: str
    state: Literal['open', 'closed', 'interrupted']
    observation_state: Literal['no_data', 'partial', 'paused', 'validation_required', 'interrupted'] = 'validation_required'
class Heartbeat(Strict):
    browsers: list[BrowserState] = Field(default_factory=list, max_length=100)
class Ack(Strict):
    success: bool
    detail: Literal['opened', 'closed', 'declined', 'profile_locked', 'browser_error', 'expired']
async def agent_auth(authorization: str = Header('')):
    if not authorization.startswith('Bearer '): raise HTTPException(401, 'Estação não autenticada.')
    station = await db.stations.find_one({'token_hash': digest(authorization[7:]), 'active': True}, {'_id': 0, 'token_hash': 0})
    if not station: raise HTTPException(401, 'A conexão desta estação foi revogada.')
    return station
@router.get('/station/status')
async def station_status(user=Depends(current_user)):
    station = await db.stations.find_one({'active': True}, {'_id': 0, 'token_hash': 0})
    if not station: return {'online': False, 'name': None, 'last_seen': None, 'id': None}
    return {**station, 'online': station.get('last_seen', '') > (now() - timedelta(seconds=30)).isoformat()}
@router.post('/station/pairing')
async def pairing(user=Depends(manager)):
    code = secrets.token_hex(10).upper()
    await db.pairings.delete_many({})
    await db.pairings.insert_one({'code_hash': digest(code), 'expires_at': now() + timedelta(minutes=10)})
    await audit(user, 'Código de conexão gerado', 'Estação Windows')
    return {'code': code, 'expires_in': 600, 'app_url': ORIGIN}
@router.post('/agent/pair')
async def pair(body: Pair):
    async with lock:
        valid = await db.pairings.find_one_and_delete({'code_hash': digest(body.code.upper()), 'expires_at': {'$gt': now()}})
        if not valid: raise HTTPException(401, 'Código inválido, expirado ou já utilizado.')
        token = secrets.token_urlsafe(48)
        await db.stations.update_many({}, {'$set': {'active': False}})
        row = {'id': uid(), 'name': body.name, 'active': True, 'last_seen': iso()}
        await db.stations.insert_one({**row, 'token_hash': digest(token)})
        await db.browsers.update_many({}, {'$set': {'state': 'interrupted'}})
        return {'token': token, 'station_id': row['id']}
@router.post('/station/revoke')
async def revoke(user=Depends(manager)):
    await db.stations.update_many({}, {'$set': {'active': False}})
    await db.pairings.delete_many({})
    await db.browsers.update_many({}, {'$set': {'state': 'interrupted'}})
    await audit(user, 'Estação desconectada pelo gestor', 'Estação Windows')
    return {'ok': True}
@router.post('/agent/heartbeat')
async def heartbeat(body: Heartbeat, station=Depends(agent_auth)):
    await db.stations.update_one({'id': station['id']}, {'$set': {'last_seen': iso()}})
    for browser in body.browsers:
        if await db.creators.find_one({'id': browser.creator_id}):
            await db.browsers.update_one({'creator_id': browser.creator_id}, {'$set': {**browser.model_dump(), 'last_seen': iso(), 'station_id': station['id']}}, upsert=True)
    creators = await db.creators.find({}, {'_id': 0, 'id': 1, 'name': 1, 'review': 1}).to_list(1000)
    for c in creators:
        shift = await db.shifts.find_one({'creator_id': c['id'], 'active': True}, {'_id': 0})
        c['paused'] = not shift or shift.get('paused', False) or bool(c.get('review'))
        c['review'] = bool(c.get('review'))
    return {'ok': True, 'creators': creators, 'storage_allowed': (await settings())['storage_allowed']}
@router.post('/creators/{creator_id}/browser')
async def open_browser(creator_id: str, user=Depends(current_user)):
    creator = await creator_access(creator_id, user)
    station = await station_status(user)
    if not station['online']: raise HTTPException(409, 'Conecte o componente Windows antes de abrir um perfil.')
    async with lock:
        browser = await db.browsers.find_one({'creator_id': creator_id})
        if browser and browser['state'] == 'open' and browser.get('last_seen', '') > (now() - timedelta(seconds=30)).isoformat():
            raise HTTPException(409, 'Este perfil já está aberto na estação. Use a janela existente.')
        if await db.commands.find_one({'creator_id': creator_id, 'status': {'$in': ['pending', 'delivered']}, 'expires_at': {'$gt': now()}}):
            raise HTTPException(409, 'Já há uma solicitação em andamento para este perfil.')
        row = {'id': uid(), 'creator_id': creator_id, 'creator_name': creator['name'], 'station_id': station['id'], 'status': 'pending',
            'action': 'open', 'requested_by': user['name'], 'expires_at': now() + timedelta(seconds=90), 'created_at': iso()}
        await db.commands.insert_one(row.copy())
    await audit(user, 'Abertura de perfil solicitada', creator['name'])
    return {'command_id': row['id'], 'status': 'pending', 'message': 'Solicitação enviada. Confirme a abertura no computador Windows.'}
@router.get('/agent/commands', response_model=list[CommandOut])
async def commands(station=Depends(agent_auth)):
    rows = await db.commands.find({'station_id': station['id'], 'status': 'pending', 'expires_at': {'$gt': now()}}, {'_id': 0}).to_list(100)
    await db.commands.update_many({'id': {'$in': [r['id'] for r in rows]}}, {'$set': {'status': 'delivered'}})
    return rows
@router.post('/agent/commands/{command_id}/ack')
async def ack(command_id: str, body: Ack, station=Depends(agent_auth)):
    row = await db.commands.find_one({'id': command_id, 'station_id': station['id'], 'status': 'delivered', 'expires_at': {'$gt': now()}}, {'_id': 0})
    if not row: raise HTTPException(409, 'Comando expirado ou já concluído.')
    await db.commands.update_one({'id': command_id}, {'$set': {'status': 'done' if body.success else 'failed', 'detail': body.detail}})
    return {'ok': True}
@router.post('/agent/observations')
async def observations(body: Observation, station=Depends(agent_auth)):
    return await ingest(body, {'station_id': station['id']})
async def ingest(body: Observation, source: dict):
    if not (await settings())['storage_allowed']: raise HTTPException(409, 'Armazenamento de métricas desabilitado. Ative em Configurações.')
    creator = await db.creators.find_one({'id': body.creator_id}, {'_id': 0})
    if not creator: raise HTTPException(404, 'Criadora não cadastrada.')
    if creator.get('review'): raise HTTPException(409, 'Observação pausada durante revisão.')
    shift = await db.shifts.find_one({'creator_id': body.creator_id, 'active': True}, {'_id': 0})
    # venda do extrato tem instante próprio (não é observação da tela em tempo real): entra mesmo com turno pausado
    if shift and shift['paused'] and not (body.kind == 'sale' and body.sale_source == 'extrato'): raise HTTPException(409, 'Turno pausado.')
    row = body.model_dump(mode='json')
    # nome do assinante só é guardado com a opção explícita da agência em Configurações
    if not (await settings()).get('fan_names_allowed'): row['fan_name'] = None
    for key in ['started_at', 'responded_at', 'confirmed_at']:
        if getattr(body, key):
            from core import clean_time
            row[key] = clean_time(getattr(body, key))
    from datetime import datetime
    timestamp = row.get('confirmed_at') or row.get('responded_at') or row.get('started_at')
    if timestamp and datetime.fromisoformat(timestamp) < now() - timedelta(days=(await settings())['retention_days']):
        raise HTTPException(422, 'Registro anterior ao período de retenção.')
    async with lock:
        old = await db.events.find_one({'creator_id': body.creator_id, 'event_ref': body.event_ref}, {'_id': 0})
        if old:
            if old['kind'] == 'sale' and body.kind != 'sale' or old['kind'] != 'sale' and body.kind == 'sale': raise HTTPException(409, 'Referência com tipo conflitante.')
            if old['kind'] == 'response' and body.kind == 'pending': return {'ok': True, 'deduplicated': True}
            if old['kind'] == 'sale' and old['sale_status'] in ['refunded', 'cancelled'] and body.sale_status == 'confirmed': return {'ok': True, 'deduplicated': True}
            # o extrato é a fonte exata: uma venda inferida pela lista nunca sobrescreve uma venda do extrato
            if old['kind'] == 'sale' and old.get('sale_source') == 'extrato' and body.sale_source != 'extrato': return {'ok': True, 'deduplicated': True}
        await db.events.update_one({'creator_id': body.creator_id, 'event_ref': body.event_ref},
            {'$set': {**row, **source, 'observed_at': iso()}, '$setOnInsert': {'id': uid(), 'expires_at': await expiration()}}, upsert=True)
    return {'ok': True}
@router.get('/station/download')
async def download_agent(user=Depends(manager)):
    source = Path(__file__).parent.parent / 'local-agent'
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as package:
        for file in source.glob('*'):
            if file.is_file() and file.suffix in ['.py', '.ps1', '.bat', '.md', '.json']:
                package.write(file, 'Alta-Pulse-Windows/' + file.name)
        package.writestr('Alta-Pulse-Windows/config.json', json.dumps({'app_url': ORIGIN, 'privacy_url': os.environ['PRIVACY_URL']}, indent=2))
        assets = Path(__file__).parent.parent / 'frontend/public/brand'
        for name in ['alta-pulse-black.png', 'alta-mark-red.png']:
            package.write(assets / name, 'Alta-Pulse-Windows/' + name)
    return Response(output.getvalue(), media_type='application/zip', headers={'Content-Disposition': 'attachment; filename="Alta-Pulse-Windows.zip"'})