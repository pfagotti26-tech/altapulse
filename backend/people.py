from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError
from datetime import timedelta
from core import db, now, iso, uid, current_user, manager, staff, is_staff, creator_access, lock, audit, expiration, clean_time
from schemas import AvatarIn, Creator, Operator, OperatorUpdate, ShiftStart, ShiftAction, ShiftCorrection, Reason
from auth_routes import hash_password
from responses import UserOut, CreatorOut, ShiftOut

router = APIRouter()
@router.get('/creators', response_model=list[CreatorOut])
async def creators(user=Depends(current_user)):
    from shift_clock import sweep_soon, decorate
    await sweep_soon()
    from team_live import viewers_by_creator, notes_summary
    query = {'deleted_at': None} if is_staff(user) else {'id': {'$in': user['creator_ids']}, 'deleted_at': None}
    rows = await db.creators.find(query, {'_id': 0}).sort('created_at', 1).to_list(1000)
    viewers = await viewers_by_creator(user['id'])
    notes = await notes_summary([r['id'] for r in rows])
    avatars = {u['id']: u.get('avatar') for u in await db.users.find({'avatar': {'$ne': None}}, {'_id': 0, 'id': 1, 'avatar': 1}).to_list(500)}
    for row in rows:
        row['groups'] = row.get('groups') or ([row['group']] if row.get('group') else [])
        row['shift'] = await db.shifts.find_one({'creator_id': row['id'], 'active': True}, {'_id': 0, 'expires_at': 0})
        if row['shift']: row['shift']['operator_avatar'] = avatars.get(row['shift']['operator_id']); decorate(row['shift'])
        row['browser'] = await db.browsers.find_one({'creator_id': row['id']}, {'_id': 0})
        if row['browser'] and row['browser'].get('last_seen', '') < (now() - timedelta(seconds=30)).isoformat():
            row['browser']['state'] = 'interrupted'
        row['viewers'] = viewers.get(row['id'], [])
        row['notes_info'] = notes.get(row['id'])
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
    await db.creators.update_one({'id': creator_id}, {'$set': body.model_dump(exclude_unset=True)})
    await audit(user, 'Cadastro atualizado', old['name'])
    return {'ok': True}
# foto da criadora (bolinha no painel e no app): o gestor envia, ou o app pega a foto de perfil da plataforma
@router.put('/creators/{creator_id}/avatar')
async def creator_avatar(creator_id: str, body: AvatarIn, user=Depends(manager)):
    await creator_access(creator_id, user)
    await db.creators.update_one({'id': creator_id}, {'$set': {'avatar': body.image, 'avatar_source': 'manual'}})
    return {'ok': True}
@router.delete('/creators/{creator_id}/avatar')
async def creator_avatar_delete(creator_id: str, user=Depends(manager)):
    await creator_access(creator_id, user)
    await db.creators.update_one({'id': creator_id}, {'$set': {'avatar': None, 'avatar_source': None}})
    return {'ok': True}
@router.delete('/creators/{creator_id}')
async def remove_creator(creator_id: str, body: Reason, user=Depends(manager)):
    # vai para a lixeira ("Apagados recentemente"): 30 dias para restaurar; depois some de vez com os dados
    await creator_access(creator_id, user)
    if await db.shifts.find_one({'creator_id': creator_id, 'active': True}): raise HTTPException(409, 'Encerre o turno antes de excluir.')
    from team_live import trash_creator
    return await trash_creator(creator_id, user, body.reason)
@router.get('/users', response_model=list[UserOut])
async def users(user=Depends(staff)):
    return await db.users.find({}, {'_id': 0, 'password_hash': 0}).to_list(1000)
# Supervisor cuida só de chatters: não cria nem edita gestores/supervisores, não muda papel para cima e não toca em permissões.
# O dono da conta é intocável para os outros (papel, acesso e permissões só ele mesmo).
def can_manage(user, target_role, body_role=None, perms=None):
    if user['role'] == 'supervisor':
        if target_role != 'chatter' or (body_role and body_role != 'chatter'): raise HTTPException(403, 'Supervisor só cadastra e edita chatters.')
    if perms is not None and not user.get('owner'): raise HTTPException(403, 'Só o dono da conta altera permissões especiais.')
MAX_CREATORS_PER_USER = 150
def check_assigned(ids):
    if len(set(ids)) > MAX_CREATORS_PER_USER: raise HTTPException(422, f'Cada integrante pode ter no máximo {MAX_CREATORS_PER_USER} criadoras atribuídas (você marcou {len(set(ids))}).')
@router.post('/users', status_code=201, response_model=UserOut)
async def create_user(body: Operator, user=Depends(staff)):
    can_manage(user, 'chatter', body.role)
    check_assigned(body.creator_ids)
    if len(set(body.creator_ids)) != await db.creators.count_documents({'id': {'$in': body.creator_ids}}):
        raise HTTPException(422, 'Há perfis inexistentes.')
    row = {**body.model_dump(exclude={'password', 'temporary_password'}), 'email': str(body.email).lower(), 'id': uid(), 'active': True,
        'password_hash': hash_password(body.password), 'created_at': iso(), 'must_change_password': body.temporary_password, 'auth_version': 0}
    try: await db.users.insert_one(row.copy())
    except DuplicateKeyError: raise HTTPException(409, 'Este e-mail já está cadastrado.')
    await audit(user, 'Integrante cadastrado', row['name'])
    # com e-mail configurado, a pessoa recebe o convite e define a própria senha (a inicial segue valendo como reserva)
    from password_reset import send_invite_if_possible
    invited = await send_invite_if_possible(row, user['name'])
    return {k: v for k, v in row.items() if k != 'password_hash'} | {'invite_sent': invited}
@router.patch('/users/{user_id}')
async def update_user(user_id: str, body: OperatorUpdate, user=Depends(staff)):
    target = await db.users.find_one({'id': user_id}, {'_id': 0})
    if not target: raise HTTPException(404, 'Integrante não encontrado.')
    can_manage(user, target['role'], body.role, body.perms)
    if target.get('owner') and user_id != user['id'] and (body.role not in (None, target['role']) or not body.active or body.new_password): raise HTTPException(403, 'O acesso do dono da conta só pode ser alterado por ele mesmo.')
    if user_id == user['id'] and not body.active: raise HTTPException(409, 'Você não pode desativar seu próprio acesso.')
    check_assigned(body.creator_ids)
    if await db.shifts.find_one({'operator_id': user_id, 'active': True}): raise HTTPException(409, 'Encerre os turnos deste integrante primeiro.')
    if await db.creators.count_documents({'id': {'$in': body.creator_ids}}) != len(set(body.creator_ids)): raise HTTPException(422, 'Perfis inválidos.')
    if user_id == user['id'] and body.role and body.role != user['role']: raise HTTPException(409, 'Você não pode mudar o seu próprio papel.')
    patch = {'creator_ids': body.creator_ids, 'active': body.active}
    if body.name: patch['name'] = body.name.strip()
    if body.email: patch['email'] = str(body.email).lower()
    if body.role: patch['role'] = body.role
    if body.perms is not None: patch['perms'] = sorted(set(body.perms))
    kick = not body.active
    if body.new_password:
        # nova senha inicial: a pessoa é obrigada a trocar no primeiro acesso; sessões antigas caem
        patch.update({'password_hash': hash_password(body.new_password), 'must_change_password': True, 'auth_version': (target.get('auth_version') or 0) + 1}); kick = True
    try: await db.users.update_one({'id': user_id}, {'$set': patch})
    except DuplicateKeyError: raise HTTPException(409, 'Este e-mail já está cadastrado.')
    if patch.get('name') and patch['name'] != target['name']:
        # o nome aparece em turnos, vendas e análises: atualiza onde está guardado por nome
        for col, field in [('shifts', 'operator_name'), ('browsers', 'operator_name'), ('presence', 'name')]: await db[col].update_many({'operator_id' if field == 'operator_name' else 'user_id': user_id}, {'$set': {field: patch['name']}})
    if kick:
        await db.sessions.delete_many({'user_id': user_id})
        await db.extension_tokens.delete_many({'user_id': user_id})
    await audit(user, 'Integrante atualizado', target['name'], {k: v for k, v in patch.items() if k not in ['password_hash']} | ({'senha': 'redefinida'} if body.new_password else {}))
    invited = False
    if body.new_password:
        from password_reset import send_invite_if_possible
        invited = await send_invite_if_possible({**target, **patch}, user['name'])
    return {'ok': True, 'invite_sent': invited}
@router.post('/users/{user_id}/invite')
async def resend_invite(user_id: str, user=Depends(staff)):
    """Reenvia o e-mail para a pessoa definir a senha (precisa do envio de e-mail configurado)."""
    from password_reset import send_invite_if_possible
    import mailer
    if not mailer.configured(): raise HTTPException(503, 'O envio de e-mail ainda não está configurado neste painel.')
    target = await db.users.find_one({'id': user_id, 'active': True}, {'_id': 0, 'password_hash': 0})
    if not target: raise HTTPException(404, 'Integrante não encontrado.')
    can_manage(user, target['role'])
    if not await send_invite_if_possible(target, user['name']): raise HTTPException(502, 'Não consegui enviar o e-mail agora. Tente de novo em instantes.')
    await audit(user, 'Convite por e-mail reenviado', target['name'])
    return {'ok': True}
@router.delete('/users/{user_id}')
async def delete_user(user_id: str, body: Reason, user=Depends(staff)):
    """Exclui o integrante. Turnos, vendas e análises ficam no histórico com o nome dele."""
    target = await db.users.find_one({'id': user_id}, {'_id': 0})
    if not target: raise HTTPException(404, 'Integrante não encontrado.')
    can_manage(user, target['role'])
    if target.get('owner'): raise HTTPException(403, 'O dono da conta não pode ser excluído.')
    if user_id == user['id']: raise HTTPException(409, 'Você não pode excluir seu próprio acesso.')
    if await db.shifts.find_one({'operator_id': user_id, 'active': True}): raise HTTPException(409, 'Encerre os turnos deste integrante primeiro.')
    if target.get('role') == 'manager' and await db.users.count_documents({'role': 'manager', 'active': True, 'id': {'$ne': user_id}}) == 0: raise HTTPException(409, 'Precisa sobrar pelo menos um gestor ativo.')
    await db.users.delete_one({'id': user_id})
    for col in ['sessions', 'extension_tokens', 'presence', 'app_status']: await db[col].delete_many({'user_id': user_id})
    await db.fan_tasks.update_many({'assigned_to': user_id, 'status': 'open'}, {'$set': {'status': 'cancelled'}})
    await audit(user, 'Integrante excluído', target['name'], reason=body.reason)
    return {'ok': True}
@router.get('/shifts', response_model=list[ShiftOut])
async def shifts(user=Depends(current_user)):
    from shift_clock import sweep_soon, decorate
    await sweep_soon()
    rows = await db.shifts.find({} if is_staff(user) else {'operator_id': user['id']}, {'_id': 0, 'expires_at': 0}).sort('started_at', -1).to_list(1000)
    return [decorate(r) for r in rows]
@router.post('/shifts', status_code=201, response_model=ShiftOut)
async def start_shift(body: ShiftStart, user=Depends(current_user)):
    creator = await creator_access(body.creator_id, user)
    async with lock:
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
    if shift['operator_id'] != user['id'] and not is_staff(user): raise HTTPException(403, 'Este turno não é seu.')
    creator = await creator_access(shift['creator_id'], user)
    if creator.get('review') and body.action != 'pause': raise HTTPException(409, 'Finalize a revisão local antes de continuar.')
    update = {'paused': body.action == 'pause'}
    if body.action == 'end': update = {'ended_at': iso(), 'active': False, 'paused': False, 'expires_at': await expiration()}
    await db.shifts.update_one({'id': shift_id, 'active': True}, {'$set': update})
    await audit(user, {'pause': 'Turno pausado', 'resume': 'Turno retomado', 'end': 'Turno encerrado'}[body.action], creator['name'])
    return {'ok': True}
@router.patch('/shifts/{shift_id}')
async def correct_shift(shift_id: str, body: ShiftCorrection, user=Depends(staff)):
    async with lock:
        old = await db.shifts.find_one({'id': shift_id}, {'_id': 0, 'expires_at': 0})
        if not old: raise HTTPException(404, 'Turno não encontrado.')
        if old['active']: raise HTTPException(409, 'Encerre o turno antes de corrigir o histórico.')
        if not body.ended_at: raise HTTPException(422, 'Informe o encerramento.')
        start, end = clean_time(body.started_at), clean_time(body.ended_at)
        if start >= end or end > iso(): raise HTTPException(422, 'Intervalo inválido ou futuro.')
        operator = await db.users.find_one({'id': body.operator_id}, {'_id': 0})
        if not operator or (not is_staff(operator) and old['creator_id'] not in operator['creator_ids']):
            raise HTTPException(422, 'Operador não autorizado para esta criadora.')
        conflict = await db.shifts.find_one({'id': {'$ne': shift_id}, 'creator_id': old['creator_id'], 'started_at': {'$lt': end}, '$or': [{'ended_at': None}, {'ended_at': {'$gt': start}}]})
        if conflict: raise HTTPException(409, 'O intervalo conflita com outro turno.')
        update = {'started_at': start, 'ended_at': end, 'operator_id': operator['id'], 'operator_name': operator['name']}
        await db.shifts.update_one({'id': shift_id}, {'$set': update})
        await audit(user, 'Turno corrigido', old['creator_name'], {'before': old, 'after': update}, body.reason)
    return {'ok': True}