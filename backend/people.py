from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError
from datetime import timedelta
from core import db, now, iso, uid, current_user, manager, creator_access, lock, audit, expiration, clean_time
from schemas import Creator, Operator, OperatorUpdate, ShiftStart, ShiftAction, ShiftCorrection, Reason
from auth_routes import hash_password
from responses import UserOut, CreatorOut, ShiftOut

router = APIRouter()
@router.get('/creators', response_model=list[CreatorOut])
async def creators(user=Depends(current_user)):
    query = {} if user['role'] == 'manager' else {'id': {'$in': user['creator_ids']}}
    rows = await db.creators.find(query, {'_id': 0}).sort('created_at', 1).to_list(1000)
    for row in rows:
        lease = await db.desktop_leases.find_one({'creator_id': row['id'], 'expires_at': {'$gt': now()}}, {'_id': 0, 'operator_id': 1, 'device_id': 1, 'mode': 1})
        row['desktop_access'] = lease
        row['shift'] = await db.shifts.find_one({'creator_id': row['id'], 'active': True}, {'_id': 0, 'expires_at': 0})
        row['browser'] = await db.browsers.find_one({'creator_id': row['id']}, {'_id': 0})
        if row['browser'] and row['browser'].get('last_seen', '') < (now() - timedelta(seconds=30)).isoformat():
            row['browser']['state'] = 'interrupted'
    return rows
@router.post('/creators', status_code=201, response_model=CreatorOut)
async def create_creator(body: Creator, user=Depends(manager)):
    row = {**body.model_dump(), 'id': uid(), 'created_at': iso(), 'review': None}
    await db.creators.insert_one(row.copy())
    await audit(user, 'Criadora cadastrada', row['name'])
    return row
@router.patch('/creators/{creator_id}')
async def edit_creator(creator_id: str, body: Creator, user=Depends(manager)):
    old = await creator_access(creator_id, user)
    await db.creators.update_one({'id': creator_id}, {'$set': body.model_dump()})
    await audit(user, 'Cadastro atualizado', old['name'])
    return {'ok': True}
@router.delete('/creators/{creator_id}')
async def remove_creator(creator_id: str, body: Reason, user=Depends(manager)):
    row = await creator_access(creator_id, user)
    if await db.desktop_leases.find_one({'creator_id': creator_id, 'expires_at': {'$gt': now()}}): raise HTTPException(409, 'Feche o navegador integrado antes de excluir o perfil.')
    if await db.shifts.find_one({'creator_id': creator_id, 'active': True}): raise HTTPException(409, 'Encerre o turno antes de excluir.')
    browser = await db.browsers.find_one({'creator_id': creator_id})
    if browser and browser['state'] != 'closed': raise HTTPException(409, 'Feche o perfil local antes de excluir.')
    for collection in ['creators', 'events', 'reviews', 'shifts', 'browsers']:
        await db[collection].delete_many({'id': creator_id} if collection == 'creators' else {'creator_id': creator_id})
    await db.users.update_many({}, {'$pull': {'creator_ids': creator_id}})
    await audit(user, 'Criadora e dados excluídos', row['name'], reason=body.reason)
    return {'ok': True}
@router.get('/users', response_model=list[UserOut])
async def users(user=Depends(manager)):
    return await db.users.find({}, {'_id': 0, 'password_hash': 0}).to_list(1000)
@router.post('/users', status_code=201, response_model=UserOut)
async def create_user(body: Operator, user=Depends(manager)):
    if len(set(body.creator_ids)) != await db.creators.count_documents({'id': {'$in': body.creator_ids}}):
        raise HTTPException(422, 'Há perfis inexistentes.')
    row = {**body.model_dump(exclude={'password', 'temporary_password'}), 'email': str(body.email).lower(), 'id': uid(), 'active': True,
        'password_hash': hash_password(body.password), 'created_at': iso(), 'must_change_password': body.temporary_password, 'auth_version': 0}
    try: await db.users.insert_one(row.copy())
    except DuplicateKeyError: raise HTTPException(409, 'Este e-mail já está cadastrado.')
    await audit(user, 'Integrante cadastrado', row['name'])
    return {k: v for k, v in row.items() if k != 'password_hash'}
@router.patch('/users/{user_id}')
async def update_user(user_id: str, body: OperatorUpdate, user=Depends(manager)):
    target = await db.users.find_one({'id': user_id}, {'_id': 0})
    if not target: raise HTTPException(404, 'Integrante não encontrado.')
    if user_id == user['id'] and not body.active: raise HTTPException(409, 'Você não pode desativar seu próprio acesso.')
    if await db.shifts.find_one({'operator_id': user_id, 'active': True}): raise HTTPException(409, 'Encerre os turnos deste integrante primeiro.')
    if await db.creators.count_documents({'id': {'$in': body.creator_ids}}) != len(set(body.creator_ids)): raise HTTPException(422, 'Perfis inválidos.')
    await db.users.update_one({'id': user_id}, {'$set': body.model_dump()})
    if not body.active: await db.sessions.delete_many({'user_id': user_id})
    await audit(user, 'Permissões atualizadas', target['name'], body.model_dump())
    return {'ok': True}
@router.get('/shifts', response_model=list[ShiftOut])
async def shifts(user=Depends(current_user)):
    return await db.shifts.find({} if user['role'] == 'manager' else {'operator_id': user['id']}, {'_id': 0, 'expires_at': 0}).sort('started_at', -1).to_list(1000)
@router.post('/shifts', status_code=201, response_model=ShiftOut)
async def start_shift(body: ShiftStart, user=Depends(current_user)):
    creator = await creator_access(body.creator_id, user)
    async with lock:
        lease = await db.desktop_leases.find_one({'creator_id': body.creator_id, 'expires_at': {'$gt': now()}})
        if lease and lease['operator_id'] != user['id']:
            raise HTTPException(409, 'Outro responsável está com o navegador aberto. Aguarde o encerramento.')
        if creator.get('review'): raise HTTPException(409, 'Encerre a revisão antes de iniciar um turno.')
        row = {'id': uid(), 'creator_id': creator['id'], 'creator_name': creator['name'], 'operator_id': user['id'],
            'operator_name': user['name'], 'started_at': iso(), 'ended_at': None, 'active': True, 'paused': False}
        try: await db.shifts.insert_one(row.copy())
        except DuplicateKeyError: raise HTTPException(409, 'Esta criadora já possui um turno ativo. Nenhum responsável foi substituído.')
    await audit(user, 'Turno iniciado', creator['name'])
    return row
@router.post('/shifts/{shift_id}/action')
async def shift_action(shift_id: str, body: ShiftAction, user=Depends(current_user)):
    async with lock:
        return await change_shift(shift_id, body, user)

async def change_shift(shift_id, body, user):
    shift = await db.shifts.find_one({'id': shift_id, 'active': True}, {'_id': 0})
    if not shift: raise HTTPException(404, 'Turno ativo não encontrado.')
    if shift['operator_id'] != user['id'] and user['role'] != 'manager': raise HTTPException(403, 'Este turno não é seu.')
    creator = await creator_access(shift['creator_id'], user)
    if creator.get('review') and body.action != 'pause': raise HTTPException(409, 'Finalize a revisão local antes de continuar.')
    update = {'paused': body.action == 'pause'}
    if body.action == 'end': update = {'ended_at': iso(), 'active': False, 'paused': False, 'expires_at': await expiration()}
    await db.shifts.update_one({'id': shift_id, 'active': True}, {'$set': update})
    await audit(user, {'pause': 'Turno pausado', 'resume': 'Turno retomado', 'end': 'Turno encerrado'}[body.action], creator['name'])
    return {'ok': True}
@router.patch('/shifts/{shift_id}')
async def correct_shift(shift_id: str, body: ShiftCorrection, user=Depends(manager)):
    async with lock:
        old = await db.shifts.find_one({'id': shift_id}, {'_id': 0, 'expires_at': 0})
        if not old: raise HTTPException(404, 'Turno não encontrado.')
        if old['active']: raise HTTPException(409, 'Encerre o turno antes de corrigir o histórico.')
        if not body.ended_at: raise HTTPException(422, 'Informe o encerramento.')
        start, end = clean_time(body.started_at), clean_time(body.ended_at)
        if start >= end or end > iso(): raise HTTPException(422, 'Intervalo inválido ou futuro.')
        operator = await db.users.find_one({'id': body.operator_id}, {'_id': 0})
        if not operator or (operator['role'] != 'manager' and old['creator_id'] not in operator['creator_ids']):
            raise HTTPException(422, 'Operador não autorizado para esta criadora.')
        conflict = await db.shifts.find_one({'id': {'$ne': shift_id}, 'creator_id': old['creator_id'], 'started_at': {'$lt': end}, '$or': [{'ended_at': None}, {'ended_at': {'$gt': start}}]})
        if conflict: raise HTTPException(409, 'O intervalo conflita com outro turno.')
        update = {'started_at': start, 'ended_at': end, 'operator_id': operator['id'], 'operator_name': operator['name']}
        await db.shifts.update_one({'id': shift_id}, {'$set': update})
        await audit(user, 'Turno corrigido', old['creator_name'], {'before': old, 'after': update}, body.reason)
    return {'ok': True}