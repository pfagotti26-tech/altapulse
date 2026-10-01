"""Cofre de acessos (bloco F): login e senha de cada criadora por plataforma.

Regras (decisão do usuário, 30/09/2026):
- Só o GESTOR cadastra, altera, apaga e vê senhas. Toda visualização de senha fica na auditoria.
- O CHATTER vê só o login e "senha salva"; o app desktop pede a senha ao painel para preencher o
  formulário de login da plataforma (endpoint /extension/credentials/{id}/use, auditado), sem mostrar.
- A senha fica criptografada no banco (Fernet/AES). A chave vem de VAULT_KEY (variável de ambiente); se
  não existir, é gerada uma vez e guardada em db.secrets — funciona sem configuração, mas quem tiver o
  banco inteiro consegue abrir. Recomendação: definir VAULT_KEY no ambiente do servidor.
"""
import os
from typing import Optional, Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field
from cryptography.fernet import Fernet, InvalidToken
from core import db, now, iso, uid, current_user, manager, creator_access, audit, lock
from schemas import Strict

router = APIRouter()

PLATFORMS = {
    'privacy':   {'label': 'Privacy',   'home': 'https://privacy.com.br/', 'login': 'https://privacy.com.br/auth?route=sign-in', 'hosts': ['privacy.com.br']},
    'fatalfans': {'label': 'FatalFans', 'home': 'https://fatalfans.com/',  'login': 'https://fatalfans.com/login', 'hosts': ['fatalfans.com']},
    'closefans': {'label': 'CloseFans', 'home': 'https://close.fans/',  'login': 'https://close.fans/login', 'hosts': ['close.fans', 'closefans.com']},
    'onlyfans':  {'label': 'OnlyFans',  'home': 'https://onlyfans.com/',   'login': 'https://onlyfans.com/', 'hosts': ['onlyfans.com']},
    'x':         {'label': 'X (Twitter)', 'home': 'https://x.com/home',    'login': 'https://x.com/i/flow/login', 'hosts': ['x.com', 'twitter.com']},
    'instagram': {'label': 'Instagram', 'home': 'https://www.instagram.com/', 'login': 'https://www.instagram.com/accounts/login/', 'hosts': ['instagram.com']},
    'facebook':  {'label': 'Facebook',  'home': 'https://www.facebook.com/', 'login': 'https://www.facebook.com/login/', 'hosts': ['facebook.com']},
}
Platform = Literal['privacy', 'fatalfans', 'closefans', 'onlyfans', 'x', 'instagram', 'facebook']

_fernet = None
async def fernet():
    global _fernet
    if _fernet: return _fernet
    key = os.environ.get('VAULT_KEY')
    if not key:
        row = await db.secrets.find_one({'id': 'vault_key'}, {'_id': 0})
        if not row:
            row = {'id': 'vault_key', 'key': Fernet.generate_key().decode(), 'created_at': iso()}
            await db.secrets.insert_one(dict(row))
        key = row['key']
    _fernet = Fernet(key.encode() if isinstance(key, str) else key)
    return _fernet

class CredentialIn(Strict):
    creator_id: str
    platform: Platform
    login: str = Field(min_length=1, max_length=120)
    password: Optional[str] = Field(default=None, min_length=1, max_length=200)  # ausente = mantém a senha atual
    note: Optional[str] = Field(default=None, max_length=300)

def public(row, user):
    out = {k: row.get(k) for k in ['id', 'creator_id', 'platform', 'login', 'note', 'updated_at', 'updated_by_name']}
    out['platform_label'] = PLATFORMS[row['platform']]['label']
    out['has_password'] = bool(row.get('secret'))
    out['login_url'] = PLATFORMS[row['platform']]['login']; out['home_url'] = PLATFORMS[row['platform']]['home']
    return out

async def creators_allowed(user):
    return None if user['role'] == 'manager' else user['creator_ids']

async def list_credentials(user, creator_id=None):
    query = {}
    allowed = await creators_allowed(user)
    if creator_id:
        await creator_access(creator_id, user); query['creator_id'] = creator_id
    elif allowed is not None: query['creator_id'] = {'$in': allowed}
    rows = await db.credentials.find(query, {'_id': 0}).sort([('creator_id', 1), ('platform', 1)]).to_list(5000)
    return [public(r, user) for r in rows]

async def decrypt(row):
    try: return (await fernet()).decrypt(row['secret'].encode()).decode()
    except (InvalidToken, KeyError): raise HTTPException(409, 'Senha ilegível (chave do cofre mudou). Cadastre a senha de novo.')

# ---------- painel (sessão) ----------
@router.get('/platforms')
async def platforms(user=Depends(current_user)):
    return [{'id': k, **v} for k, v in PLATFORMS.items()]

@router.get('/credentials')
async def get_credentials(creator_id: Optional[str] = None, user=Depends(current_user)):
    return await list_credentials(user, creator_id)

@router.put('/credentials')
async def save_credential(body: CredentialIn, user=Depends(manager)):
    creator = await creator_access(body.creator_id, user)
    async with lock:
        old = await db.credentials.find_one({'creator_id': body.creator_id, 'platform': body.platform}, {'_id': 0})
        if not old and not body.password: raise HTTPException(422, 'Informe a senha no primeiro cadastro.')
        row = {'creator_id': body.creator_id, 'platform': body.platform, 'login': body.login, 'note': body.note,
            'updated_at': iso(), 'updated_by': user['id'], 'updated_by_name': user['name']}
        if body.password: row['secret'] = (await fernet()).encrypt(body.password.encode()).decode()
        await db.credentials.update_one({'creator_id': body.creator_id, 'platform': body.platform}, {'$set': row, '$setOnInsert': {'id': old['id'] if old else uid(), 'created_at': iso()}}, upsert=True)
        saved = await db.credentials.find_one({'creator_id': body.creator_id, 'platform': body.platform}, {'_id': 0})
    await audit(user, 'Acesso salvo no cofre' if old else 'Acesso cadastrado no cofre', f"{creator['name']} · {PLATFORMS[body.platform]['label']}",
        {'login': body.login, 'senha_alterada': bool(body.password), 'nota': body.note})
    return public(saved, user)

@router.delete('/credentials/{credential_id}')
async def delete_credential(credential_id: str, user=Depends(manager)):
    row = await db.credentials.find_one({'id': credential_id}, {'_id': 0})
    if not row: raise HTTPException(404, 'Acesso não encontrado.')
    creator = await db.creators.find_one({'id': row['creator_id']}, {'_id': 0, 'name': 1}) or {'name': '?'}
    await db.credentials.delete_one({'id': credential_id})
    await audit(user, 'Acesso removido do cofre', f"{creator['name']} · {PLATFORMS[row['platform']]['label']}", {'login': row['login']})
    return {'ok': True}

@router.post('/credentials/{credential_id}/reveal')
async def reveal_credential(credential_id: str, user=Depends(manager)):
    row = await db.credentials.find_one({'id': credential_id}, {'_id': 0})
    if not row: raise HTTPException(404, 'Acesso não encontrado.')
    creator = await db.creators.find_one({'id': row['creator_id']}, {'_id': 0, 'name': 1}) or {'name': '?'}
    password = await decrypt(row)
    await audit(user, 'Senha visualizada', f"{creator['name']} · {PLATFORMS[row['platform']]['label']}", {'login': row['login']})
    return {'login': row['login'], 'password': password}

# ---------- app desktop / extensão (token) ----------
async def extension_list(user, creator_id=None): return await list_credentials(user, creator_id)

async def extension_use(credential_id, user, device_name=None):
    """Entrega login e senha ao app para preencher o formulário da plataforma. Chatter só das criadoras dele."""
    row = await db.credentials.find_one({'id': credential_id}, {'_id': 0})
    if not row: raise HTTPException(404, 'Acesso não encontrado.')
    creator = await creator_access(row['creator_id'], user)
    password = await decrypt(row)
    await audit(user, 'Acesso usado no app (login automático)', f"{creator['name']} · {PLATFORMS[row['platform']]['label']}", {'login': row['login'], 'dispositivo': device_name})
    return {'login': row['login'], 'password': password, 'platform': row['platform'], 'login_url': PLATFORMS[row['platform']]['login'], 'hosts': PLATFORMS[row['platform']]['hosts']}
