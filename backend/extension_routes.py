"""Extensão Chrome Alta Pulse: login por token, estado, turnos e observações do DOM visível.

Nenhuma credencial, cookie ou conteúdo da Privacy chega a este servidor; somente hashes,
horários, valores e situações de venda observados pela extensão no Chrome do operador.
"""
import io, json, os, re, secrets, zipfile
from pathlib import Path
from datetime import timedelta
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import Field
from core import db, now, iso, uid, digest, lock, settings, audit, ORIGIN
from schemas import Strict, Login, ShiftStart, ShiftAction, Observation, CreatorMeta
from performance import SnapshotIn
from quality_ai import SampleIn
from responses import Public, UserOut, ShiftOut, CreatorOut
from auth_routes import verify_password
from people import start_shift, change_shift
from stations import ingest

router = APIRouter()
SOURCE = Path(__file__).parent.parent / 'extension'
VERSION = json.loads((SOURCE / 'manifest.json').read_text())['version']
DESKTOP = Path(__file__).parent.parent / 'desktop'
DESKTOP_VERSION = json.loads((DESKTOP / 'package.json').read_text())['version'] if (DESKTOP / 'package.json').exists() else None
DESKTOP_SKIP = {'node_modules', 'calibracoes', 'package-lock.json', 'iniciar.log'}
TOKEN_DAYS = 30

class ExtensionLogin(Login):
    device_name: str = Field(default='Chrome', min_length=1, max_length=80)

class HeartbeatIn(Strict):
    creator_id: str
    page: Literal['chat', 'other'] = 'other'
    source: Literal['extension', 'desktop'] = 'extension'
    observation_state: Literal['no_data', 'partial', 'paused', 'validation_required', 'interrupted'] = 'partial'

class ObservationBatch(Strict):
    events: list[Observation] = Field(max_length=200)

class TokenOut(Public):
    token: str
    expires_at: str
    user: UserOut

class StateOut(Public):
    user: UserOut
    creators: list[CreatorOut]
    storage_allowed: bool
    fan_names_allowed: bool = False
    quality_ai_allowed: bool = False
    sla_minutes: int
    version: str
    latest_version: str

async def extension_user(request: Request):
    authorization = request.headers.get('authorization', '')
    if not authorization.startswith('Bearer '): raise HTTPException(401, 'Entre na extensão com seu acesso Alta Pulse.')
    token = await db.extension_tokens.find_one({'token_hash': digest(authorization[7:]), 'expires_at': {'$gt': now()}}, {'_id': 0})
    if not token: raise HTTPException(401, 'A sessão da extensão expirou. Entre novamente.')
    user = await db.users.find_one({'id': token['user_id'], 'active': True}, {'_id': 0, 'password_hash': 0})
    if not user: raise HTTPException(401, 'Este acesso foi desativado.')
    if token.get('auth_version', 0) != user.get('auth_version', 0): raise HTTPException(401, 'Sua senha foi alterada. Entre novamente na extensão.')
    if user.get('must_change_password'): raise HTTPException(403, 'Defina sua senha pessoal no painel Alta Pulse antes de usar a extensão.')
    await db.extension_tokens.update_one({'token_hash': token['token_hash']}, {'$set': {'last_seen': iso()}})
    request.state.extension_token_hash = token['token_hash']
    return user

@router.post('/extension/login', response_model=TokenOut)
async def login(body: ExtensionLogin, request: Request):
    key = digest('extension:' + str(body.email).lower() + ':' + (request.client.host if request.client else 'unknown'))
    attempt = await db.login_limits.find_one({'id': key})
    threshold = (now() - timedelta(minutes=15)).isoformat()
    if attempt and attempt['count'] >= 10 and attempt['last_at'] > threshold: raise HTTPException(429, 'Muitas tentativas. Aguarde 15 minutos.')
    user = await db.users.find_one({'email': str(body.email).lower(), 'active': True}, {'_id': 0})
    if not user or not verify_password(body.password, user['password_hash']):
        count = (attempt['count'] if attempt and attempt['last_at'] > threshold else 0) + 1
        await db.login_limits.update_one({'id': key}, {'$set': {'count': count, 'last_at': iso()}}, upsert=True)
        raise HTTPException(401, 'E-mail ou senha incorretos.')
    await db.login_limits.delete_one({'id': key})
    if user.get('must_change_password'): raise HTTPException(403, 'Defina sua senha pessoal no painel Alta Pulse antes de usar a extensão.')
    token = secrets.token_urlsafe(48); expires = now() + timedelta(days=TOKEN_DAYS)
    await db.extension_tokens.insert_one({'token_hash': digest(token), 'user_id': user['id'], 'auth_version': user.get('auth_version', 0),
        'device_name': body.device_name, 'created_at': iso(), 'last_seen': iso(), 'expires_at': expires})
    await audit(user, 'Extensão Chrome conectada', body.device_name)
    return {'token': token, 'expires_at': expires.isoformat(), 'user': user}

@router.post('/extension/logout')
async def logout(request: Request, user=Depends(extension_user)):
    await db.extension_tokens.delete_one({'token_hash': request.state.extension_token_hash})
    await db.browsers.update_many({'operator_id': user['id'], 'source': 'extension'}, {'$set': {'state': 'closed'}})
    return {'ok': True}

async def creators_for(user):
    from people import creators
    return await creators(user)

@router.get('/extension/state', response_model=StateOut)
async def state(user=Depends(extension_user)):
    config = await settings()
    return {'user': user, 'creators': await creators_for(user), 'storage_allowed': config['storage_allowed'], 'fan_names_allowed': bool(config.get('fan_names_allowed')), 'quality_ai_allowed': bool(config.get('quality_ai_allowed')), 'sla_minutes': config['sla_minutes'], 'version': VERSION, 'latest_version': VERSION}

@router.post('/extension/shifts', status_code=201, response_model=ShiftOut)
async def extension_start_shift(body: ShiftStart, user=Depends(extension_user)):
    return await start_shift(body, user)

@router.post('/extension/shifts/{shift_id}/action')
async def extension_shift_action(shift_id: str, body: ShiftAction, user=Depends(extension_user)):
    async with lock:
        return await change_shift(shift_id, body, user)

@router.post('/extension/heartbeat')
async def heartbeat(body: HeartbeatIn, user=Depends(extension_user)):
    from core import creator_access
    creator = await creator_access(body.creator_id, user)
    shift = await db.shifts.find_one({'creator_id': body.creator_id, 'active': True}, {'_id': 0, 'expires_at': 0})
    paused = not shift or shift.get('paused', False) or bool(creator.get('review'))
    state = 'paused' if paused else body.observation_state if body.page == 'chat' else 'no_data'
    await db.browsers.update_one({'creator_id': body.creator_id}, {'$set': {'creator_id': body.creator_id, 'state': 'open', 'observation_state': state,
        'last_seen': iso(), 'source': body.source, 'operator_id': user['id'], 'operator_name': user['name'], 'page': body.page}}, upsert=True)
    return {'ok': True, 'paused': paused, 'review': bool(creator.get('review')), 'shift': shift, 'storage_allowed': (await settings())['storage_allowed']}

@router.post('/extension/observations')
async def observations(body: ObservationBatch, user=Depends(extension_user)):
    results = []
    for event in body.events:
        if user['role'] != 'manager' and event.creator_id not in user['creator_ids']:
            results.append({'event_ref': event.event_ref, 'ok': False, 'detail': 'Criadora não autorizada.'}); continue
        try:
            outcome = await ingest(event, {'source': 'desktop-extrato' if event.sale_source == 'extrato' else 'extension', 'operator_id': user['id']})
            results.append({'event_ref': event.event_ref, **outcome})
        except HTTPException as error:
            results.append({'event_ref': event.event_ref, 'ok': False, 'status': error.status_code, 'detail': error.detail})
    return {'results': results, 'accepted': sum(r['ok'] for r in results)}

@router.patch('/extension/creators/{creator_id}/meta')
async def creator_meta(creator_id: str, body: CreatorMeta, user=Depends(extension_user)):
    """Grupo, etiqueta e anotações da criadora (app desktop). Gestor altera tudo; chatter só anotações."""
    from core import creator_access
    creator = await creator_access(creator_id, user)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if user['role'] != 'manager': patch = {k: v for k, v in patch.items() if k == 'notes'}
    if not patch: raise HTTPException(422, 'Nada para alterar.')
    await db.creators.update_one({'id': creator_id}, {'$set': patch})
    if 'group' in patch or 'tag' in patch: await audit(user, 'Organização da criadora alterada', creator['name'], {k: v for k, v in patch.items() if k != 'notes'})
    return {'ok': True, **patch}

# Instalador Windows (.exe) hospedado pelo próprio painel em backend/desktop_dist (partes < 100 MB por
# causa do limite do GitHub; o servidor concatena). Serve também latest.yml/blockmap para o
# electron-updater (provider "generic" em https://altapulse.com.br/api/desktop/updates).
DIST = Path(__file__).parent / 'desktop_dist'
def installer_info():
    """Lê latest.yml de desktop_dist; None se não houver instalador publicado."""
    meta = DIST / 'latest.yml'
    if not meta.exists(): return None
    text = meta.read_text(encoding='utf-8')
    version = re.search(r'^version:\s*(\S+)', text, re.M); path = re.search(r'^path:\s*(\S+)', text, re.M)
    if not version or not path: return None
    name = path.group(1); parts = sorted(DIST.glob(name + '.part*'))
    if not parts and not (DIST / name).exists(): return None
    size = sum(f.stat().st_size for f in parts) if parts else (DIST / name).stat().st_size
    return {'version': version.group(1), 'filename': name, 'size': size, 'url': f'{ORIGIN}/api/desktop/installer'}

def installer_stream(name):
    single = DIST / name
    files = [single] if single.exists() else sorted(DIST.glob(name + '.part*'))
    for part in files:
        with open(part, 'rb') as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b''): yield chunk

@router.get('/desktop/release')
async def desktop_release():
    installer = installer_info()
    return {'version': (installer or {}).get('version') or DESKTOP_VERSION, 'api_origin': ORIGIN, 'available': DESKTOP_VERSION is not None,
        'installer': installer, 'filename': (installer or {}).get('filename') or f'Alta-Pulse-Desktop-{DESKTOP_VERSION}.zip',
        'zip_version': DESKTOP_VERSION, 'zip_filename': f'Alta-Pulse-Desktop-{DESKTOP_VERSION}.zip'}

@router.get('/desktop/installer')
async def desktop_installer():
    """Instalador .exe mais recente (download direto)."""
    from fastapi.responses import StreamingResponse
    installer = installer_info()
    if not installer: raise HTTPException(404, 'Instalador ainda não publicado. Use o pacote .zip.')
    return StreamingResponse(installer_stream(installer['filename']), media_type='application/octet-stream',
        headers={'Content-Disposition': f'attachment; filename="{installer["filename"]}"', 'Content-Length': str(installer['size'])})

@router.get('/desktop/updates/{name}')
async def desktop_updates(name: str):
    """Arquivos do electron-updater: latest.yml, .exe e .blockmap."""
    from fastapi.responses import StreamingResponse, FileResponse
    if not re.fullmatch(r'[A-Za-z0-9._-]+', name) or name.startswith('.'): raise HTTPException(404)
    if name.endswith('.yml') or name.endswith('.blockmap'):
        file = DIST / name
        if not file.exists(): raise HTTPException(404)
        return FileResponse(file, media_type='text/yaml' if name.endswith('.yml') else 'application/octet-stream')
    if not name.endswith('.exe') or not (list(DIST.glob(name + '.part*')) or (DIST / name).exists()): raise HTTPException(404)
    size = sum(f.stat().st_size for f in DIST.glob(name + '.part*')) or (DIST / name).stat().st_size
    return StreamingResponse(installer_stream(name), media_type='application/octet-stream', headers={'Content-Length': str(size), 'Content-Disposition': f'attachment; filename="{name}"'})

@router.get('/desktop/download')
async def desktop_download():
    """Pacote do app desktop (fontes + Iniciar.bat). Sem segredos; o Electron é baixado pelo npm na primeira execução."""
    if not DESKTOP_VERSION: raise HTTPException(404, 'App desktop indisponível nesta versão.')
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as package:
        for file in DESKTOP.rglob('*'):
            if not file.is_file() or DESKTOP_SKIP & set(file.relative_to(DESKTOP).parts): continue
            name = 'Alta-Pulse-Desktop/' + str(file.relative_to(DESKTOP))
            if file.suffix in ['.js', '.json', '.md', '.html', '.css']:
                package.writestr(name, file.read_text(encoding='utf-8').replace('https://altapulse.com.br', ORIGIN))
            else: package.write(file, name)
    return Response(output.getvalue(), media_type='application/zip', headers={'Content-Disposition': f'attachment; filename="Alta-Pulse-Desktop-{DESKTOP_VERSION}.zip"'})


# ---------- cofre de acessos (bloco F) ----------
@router.get('/extension/credentials')
async def extension_credentials(creator_id: Optional[str] = None, user=Depends(extension_user)):
    """Acessos salvos (sem senha) das criadoras do usuário, para o app mostrar "Entrar com o acesso salvo"."""
    from vault import extension_list
    return await extension_list(user, creator_id)

@router.post('/extension/credentials/{credential_id}/use')
async def extension_credential_use(credential_id: str, request: Request, user=Depends(extension_user)):
    """Login e senha para o app preencher o formulário da plataforma. Auditado; chatter não vê a senha."""
    from vault import extension_use
    token = await db.extension_tokens.find_one({'token_hash': request.state.extension_token_hash}, {'_id': 0, 'device_name': 1})
    return await extension_use(credential_id, user, (token or {}).get('device_name'))

# ---------- retrato da criadora (bloco B) ----------
@router.post('/extension/samples')
async def extension_sample(body: SampleIn, user=Depends(extension_user)):
    from quality_ai import save_sample
    return await save_sample(body, user)

@router.post('/extension/snapshots')
async def extension_snapshot(body: SnapshotIn, user=Depends(extension_user)):
    """Retrato da "Visão geral" do Meu Privacy lido pelo app (uma vez por hora; painel guarda um por dia)."""
    from performance import save_snapshot
    return await save_snapshot(body, user)

@router.get('/extension/release')
async def release(): return {'version': VERSION, 'api_origin': ORIGIN, 'filename': f'Alta-Pulse-Extensao-{VERSION}.zip'}

class CalibrationIn(Strict):
    platform: str = Field(default='privacy', max_length=40)
    url_path: str = Field(default='', max_length=300)
    outline: str = Field(max_length=200000)

@router.post('/extension/calibration')
async def calibration(body: CalibrationIn, user=Depends(extension_user)):
    await db.calibrations.insert_one({'id': uid(), 'user_id': user['id'], 'user_name': user['name'], 'platform': body.platform,
        'url_path': body.url_path, 'outline': body.outline, 'captured_at': iso()})
    return {'ok': True}

@router.get('/extension/download')
async def download():
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as package:
        for file in SOURCE.rglob('*'):
            if not file.is_file() or '__pycache__' in file.parts: continue
            name = str(file.relative_to(SOURCE))
            if file.suffix in ['.json', '.js', '.html', '.css', '.md']:
                package.writestr(name, file.read_text(encoding='utf-8').replace('__API_ORIGIN__', ORIGIN))
            else: package.write(file, name)
    return Response(output.getvalue(), media_type='application/zip', headers={'Content-Disposition': f'attachment; filename="Alta-Pulse-Extensao-{VERSION}.zip"'})
