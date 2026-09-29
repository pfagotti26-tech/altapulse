import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from core import db, client, TRUSTED_ORIGINS
from auth_routes import router as auth
from people import router as people
from reporting import router as reporting
from stations import router as stations
from extension_routes import router as extension

@asynccontextmanager
async def lifespan(app):
    await db.users.create_index('email', unique=True)
    await db.creators.create_index('id', unique=True)
    await db.sessions.create_index('expires_at', expireAfterSeconds=0)
    await db.shifts.create_index('creator_id', unique=True, partialFilterExpression={'active': True})
    await db.events.create_index([('creator_id', 1), ('event_ref', 1)], unique=True)
    await db.extension_tokens.create_index('expires_at', expireAfterSeconds=0)
    await db.extension_tokens.create_index('token_hash', unique=True)
    for collection in ['events', 'reviews', 'audit', 'shifts', 'pairings', 'commands']:
        await db[collection].create_index('expires_at', expireAfterSeconds=0)
    yield
    client.close()

app = FastAPI(title='Alta Pulse • Gestão de operações', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=TRUSTED_ORIGINS, allow_origin_regex=r'chrome-extension://.*', allow_credentials=True,
                   allow_methods=['GET', 'POST', 'PATCH', 'DELETE'], allow_headers=['Content-Type', 'Authorization'])

@app.middleware('http')
async def origin_guard(request: Request, call_next):
    origin = request.headers.get('origin')
    extension_call = request.url.path.startswith('/api/extension/') and (origin or '').startswith('chrome-extension://')
    if request.method in ['POST', 'PATCH', 'DELETE'] and origin and origin not in TRUSTED_ORIGINS and not extension_call:
        return JSONResponse({'detail': 'Origem não autorizada.'}, status_code=403)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response

for router in [auth, people, reporting, stations, extension]:
    app.include_router(router, prefix='/api')

@app.get('/api/health')
async def health():
    await db.command('ping')
    return {'status': 'ok', 'product': 'Alta Pulse'}