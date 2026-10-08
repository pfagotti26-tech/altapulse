import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from core import db, client, TRUSTED_ORIGINS, ensure_owner
from auth_routes import router as auth
from people import router as people
from reporting import router as reporting
from stations import router as stations
from extension_routes import router as extension
from vault import router as vault
from performance import router as performance
from fans import router as fans
from quality_ai import router as quality_ai
from assist import router as assist
from scorecard import router as scorecard
from team_live import router as team_live
from radar import router as radar
from password_reset import router as password_reset
from plantao import router as plantao

@asynccontextmanager
async def lifespan(app):
    await db.users.create_index('email', unique=True)
    await ensure_owner()
    await db.creators.create_index('id', unique=True)
    await db.sessions.create_index('expires_at', expireAfterSeconds=0)
    await db.shifts.create_index('creator_id', unique=True, partialFilterExpression={'active': True})
    await db.events.create_index([('creator_id', 1), ('event_ref', 1)], unique=True)
    await db.extension_tokens.create_index('expires_at', expireAfterSeconds=0)
    await db.extension_tokens.create_index('token_hash', unique=True)
    await db.password_resets.create_index('token_hash', sparse=True)
    await db.password_resets.create_index([('limit_key', 1), ('created_at', -1)])
    for collection in ['events', 'reviews', 'audit', 'shifts', 'pairings', 'commands', 'creator_snapshots', 'plantao_log']:
        await db[collection].create_index('expires_at', expireAfterSeconds=0)
    await db.creator_snapshots.create_index([('creator_id', 1), ('day', 1)], unique=True)
    await db.samples.create_index('expires_at', expireAfterSeconds=0)
    await db.subscribers.create_index('expires_at', expireAfterSeconds=0)
    for collection in ['fan_notes', 'fan_tasks']: await db[collection].create_index('expires_at', expireAfterSeconds=0)
    await db.fan_notes.create_index([('creator_id', 1), ('fan_ref', 1)])
    await db.fan_segments.create_index([('creator_id', 1), ('fan_ref', 1)], unique=True)
    await db.fan_tasks.create_index([('assigned_to', 1), ('status', 1)])
    await db.subscribers.create_index([('creator_id', 1), ('fan_ref', 1)], unique=True)
    await db.samples.create_index([('creator_id', 1), ('fan_ref', 1), ('day', 1)], unique=True)
    # velocidade da Operação, do cartão do fã e das listas
    await db.events.create_index([('observed_at', -1)])
    await db.events.create_index([('creator_id', 1), ('kind', 1), ('fan_ref', 1)])
    await db.events.create_index([('kind', 1), ('creator_id', 1)])
    await db.shifts.create_index([('creator_id', 1), ('started_at', 1)])
    await db.assist_usage.create_index('expires_at', expireAfterSeconds=0)
    await db.assist_usage.create_index([('user_id', 1), ('day', 1)])
    await db.assist_alerts.create_index('expires_at', expireAfterSeconds=0)
    await db.assist_profiles.create_index('creator_id', unique=True)
    await db.credentials.create_index([('creator_id', 1), ('platform', 1)], unique=True)
    await db.shifts.create_index([('active', 1), ('operator_id', 1)])
    await db.presence.create_index('user_id', unique=True)
    await db.fan_radar.create_index([('creator_id', 1), ('fan_ref', 1)], unique=True)
    await db.fan_radar.create_index('expires_at', expireAfterSeconds=0)
    await db.opportunities.create_index([('creator_id', 1), ('fan_ref', 1), ('ref', 1)], unique=True)
    await db.opportunities.create_index([('status', 1), ('due_at', 1)])
    await db.opportunities.create_index('expires_at', expireAfterSeconds=0)
    await db.creator_notes.create_index([('creator_id', 1), ('created_at', -1)])
    import asyncio
    from shift_clock import sweep_loop
    clock = asyncio.create_task(sweep_loop())  # encerra turnos esquecidos (app fechado)
    yield
    clock.cancel()
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

for router in [auth, people, reporting, stations, extension, vault, performance, fans, quality_ai, assist, scorecard, team_live, radar, password_reset, plantao]:
    app.include_router(router, prefix='/api')

@app.get('/api/health')
async def health():
    await db.command('ping')
    return {'status': 'ok', 'product': 'Alta Pulse'}