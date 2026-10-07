"""Presença no perfil, anotações da criadora e lixeira de criadoras.

- Presença: cada app avisa a cada ~15 s quais criadoras estão abertas e qual está na tela.
  Quem abre um perfil vê "Wallace e Camily estão neste perfil agora" (evita dois chatters no mesmo fã).
- Anotações: notas curtas por criadora, com autor e hora (passagem de turno). Ficam no painel, valem em qualquer computador.
- Lixeira: excluir uma criadora manda para "Apagados recentemente" por 30 dias; dá para restaurar.
"""
from datetime import timedelta, datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from core import db, now, iso, uid, current_user, manager, is_staff, creator_access, audit, WORKSPACE
from schemas import Strict, Reason

router = APIRouter()
PRESENCE_SECONDS = 45
TRASH_DAYS = 30
MAX_NOTES = 200

# ---------- presença ----------
class PresenceIn(Strict):
    open: list[str] = Field(default_factory=list, max_length=300)
    active: Optional[str] = Field(default=None, max_length=64)

async def save_presence(user, body: PresenceIn):
    allowed = None if is_staff(user) else set(user.get('creator_ids') or [])
    keep = lambda cid: cid and (allowed is None or cid in allowed)
    open_ids = list(dict.fromkeys(c for c in body.open if keep(c)))[:300]
    active = body.active if keep(body.active) else None
    await db.presence.update_one({'user_id': user['id']}, {'$set': {'user_id': user['id'], 'name': user['name'], 'avatar': user.get('avatar'),
        'open': open_ids, 'active': active, 'at': iso(), 'workspace_id': WORKSPACE}}, upsert=True)
    return {'ok': True}

async def viewers_by_creator(exclude_user_id=None):
    """{creator_id: [{id, name, avatar, active}]} de quem está com o perfil aberto agora."""
    since = (now() - timedelta(seconds=PRESENCE_SECONDS)).isoformat()
    out = {}
    async for p in db.presence.find({'at': {'$gt': since}}, {'_id': 0}):
        if p['user_id'] == exclude_user_id: continue
        for cid in p.get('open') or []:
            out.setdefault(cid, []).append({'id': p['user_id'], 'name': p['name'], 'avatar': p.get('avatar'), 'active': p.get('active') == cid})
    for lst in out.values(): lst.sort(key=lambda v: (not v['active'], v['name']))
    return out

# ---------- anotações da criadora ----------
class NoteIn(Strict):
    text: str = Field(min_length=1, max_length=1000)
    pinned: bool = False

async def list_notes(creator_id, user):
    await creator_access(creator_id, user)
    return await db.creator_notes.find({'creator_id': creator_id}, {'_id': 0}).sort([('pinned', -1), ('created_at', -1)]).to_list(MAX_NOTES)

async def add_note(creator_id, body: NoteIn, user):
    await creator_access(creator_id, user)
    if await db.creator_notes.count_documents({'creator_id': creator_id}) >= MAX_NOTES:
        raise HTTPException(422, f'Esta criadora já tem {MAX_NOTES} anotações. Apague as antigas antes.')
    row = {'id': uid(), 'creator_id': creator_id, 'text': body.text, 'pinned': body.pinned, 'author_id': user['id'], 'author': user['name'],
           'created_at': iso(), 'workspace_id': WORKSPACE}
    await db.creator_notes.insert_one(row.copy())
    return row

async def remove_note(note_id, user):
    note = await db.creator_notes.find_one({'id': note_id}, {'_id': 0})
    if not note: raise HTTPException(404, 'Anotação não encontrada.')
    await creator_access(note['creator_id'], user)
    if note['author_id'] != user['id'] and not is_staff(user): raise HTTPException(403, 'Só quem escreveu (ou o gestor) apaga esta anotação.')
    await db.creator_notes.delete_one({'id': note_id})
    return {'ok': True}

async def pin_note(note_id, pinned, user):
    note = await db.creator_notes.find_one({'id': note_id}, {'_id': 0})
    if not note: raise HTTPException(404, 'Anotação não encontrada.')
    await creator_access(note['creator_id'], user)
    await db.creator_notes.update_one({'id': note_id}, {'$set': {'pinned': bool(pinned)}})
    return {'ok': True}

async def notes_summary(creator_ids):
    """{creator_id: {'count': n, 'last': {...}}} para o card."""
    out = {}
    if not creator_ids: return out
    rows = db.creator_notes.aggregate([{'$match': {'creator_id': {'$in': list(creator_ids)}}}, {'$sort': {'pinned': -1, 'created_at': -1}},
        {'$group': {'_id': '$creator_id', 'count': {'$sum': 1}, 'last': {'$first': {'text': '$text', 'author': '$author', 'created_at': '$created_at', 'pinned': '$pinned'}}}}])
    async for r in rows: out[r['_id']] = {'count': r['count'], 'last': r['last']}
    return out

@router.get('/creators/{creator_id}/notes')
async def panel_notes(creator_id: str, user=Depends(current_user)): return await list_notes(creator_id, user)
@router.post('/creators/{creator_id}/notes', status_code=201)
async def panel_add_note(creator_id: str, body: NoteIn, user=Depends(current_user)): return await add_note(creator_id, body, user)
@router.delete('/creator-notes/{note_id}')
async def panel_remove_note(note_id: str, user=Depends(current_user)): return await remove_note(note_id, user)
class PinIn(Strict):
    pinned: bool
@router.patch('/creator-notes/{note_id}')
async def panel_pin_note(note_id: str, body: PinIn, user=Depends(current_user)): return await pin_note(note_id, body.pinned, user)

# ---------- lixeira ----------
async def purge_creator(creator_id):
    for collection in ['events', 'reviews', 'shifts', 'browsers', 'creator_notes', 'credentials', 'assist_profiles', 'samples', 'fan_notes', 'fan_tasks', 'subscribers', 'creator_snapshots']:
        await db[collection].delete_many({'creator_id': creator_id})
    await db.creators.delete_one({'id': creator_id})

async def trash_creator(creator_id, user, reason):
    row = await creator_access(creator_id, user)
    holders = [u['id'] async for u in db.users.find({'creator_ids': creator_id}, {'_id': 0, 'id': 1})]
    await db.creators.update_one({'id': creator_id}, {'$set': {'deleted_at': iso(), 'deleted_by': user['name'], 'deleted_reason': reason, 'deleted_assign': holders}})
    await db.users.update_many({}, {'$pull': {'creator_ids': creator_id}})
    await audit(user, 'Criadora enviada para a lixeira', row['name'], reason=reason)
    return {'ok': True}

@router.get('/creators-trash')
async def trash(user=Depends(manager)):
    rows = await db.creators.find({'deleted_at': {'$ne': None}}, {'_id': 0, 'id': 1, 'name': 1, 'color': 1, 'avatar': 1, 'deleted_at': 1, 'deleted_by': 1, 'deleted_reason': 1, 'deleted_assign': 1}).sort('deleted_at', -1).to_list(500)
    for r in rows:
        r['purge_at'] = (datetime.fromisoformat(r['deleted_at']) + timedelta(days=TRASH_DAYS)).isoformat()
        r['assigned'] = len(r.pop('deleted_assign', None) or [])
    return rows

@router.post('/creators/{creator_id}/restore')
async def restore(creator_id: str, user=Depends(manager)):
    from people import MAX_CREATORS_PER_USER
    row = await db.creators.find_one({'id': creator_id, 'deleted_at': {'$ne': None}}, {'_id': 0})
    if not row: raise HTTPException(404, 'Esta criadora não está na lixeira.')
    skipped = []
    for user_id in row.get('deleted_assign') or []:
        u = await db.users.find_one({'id': user_id}, {'_id': 0, 'name': 1, 'creator_ids': 1})
        if not u: continue
        if len(u.get('creator_ids') or []) >= MAX_CREATORS_PER_USER: skipped.append(u['name']); continue
        await db.users.update_one({'id': user_id}, {'$addToSet': {'creator_ids': creator_id}})
    await db.creators.update_one({'id': creator_id}, {'$set': {'deleted_at': None}, '$unset': {'deleted_by': '', 'deleted_reason': '', 'deleted_assign': ''}})
    await audit(user, 'Criadora restaurada da lixeira', row['name'])
    return {'ok': True, 'skipped': skipped}

@router.delete('/creators/{creator_id}/purge')
async def purge(creator_id: str, body: Reason, user=Depends(manager)):
    row = await db.creators.find_one({'id': creator_id, 'deleted_at': {'$ne': None}}, {'_id': 0, 'name': 1})
    if not row: raise HTTPException(404, 'Esta criadora não está na lixeira.')
    await purge_creator(creator_id)
    await audit(user, 'Criadora e dados excluídos de vez', row['name'], reason=body.reason)
    return {'ok': True}

async def purge_expired():
    limit = (now() - timedelta(days=TRASH_DAYS)).isoformat()
    async for r in db.creators.find({'deleted_at': {'$ne': None, '$lt': limit}}, {'_id': 0, 'id': 1}):
        await purge_creator(r['id'])
