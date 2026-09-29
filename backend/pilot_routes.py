"""Distribuição separada do piloto Chrome; não altera o release público regular."""
import json
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from core import manager

router = APIRouter()
RELEASE = Path(__file__).parent.parent / 'desktop' / 'pilot' / 'release'

def pilot_release():
    manifest = RELEASE / 'manifest.json'
    if not manifest.exists(): return {'available': False, 'experimental': True, 'message': 'O piloto está sendo preparado.'}
    info = json.loads(manifest.read_text())
    file = RELEASE / info['filename']
    if file.parent != RELEASE or not file.is_file() or file.stat().st_size != info['size_bytes']:
        return {'available': False, 'experimental': True, 'message': 'O piloto está temporariamente indisponível.'}
    return {'available': True, **info}

@router.get('/desktop/pilot/release')
async def get_pilot_release(user=Depends(manager)):
    return pilot_release()

@router.get('/desktop/pilot/download/windows')
async def download_pilot(user=Depends(manager)):
    release = pilot_release()
    if not release['available']: raise HTTPException(503, release['message'])
    return FileResponse(RELEASE / release['filename'], filename=release['filename'], media_type='application/octet-stream',
        headers={'X-Checksum-SHA256': release['sha256']})