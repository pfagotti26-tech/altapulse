"""Bloco E: qualidade de conversa por IA, sem custo extra.
O app desktop manda, com a opção 'análise por IA' ligada em Configurações, amostras ANONIMIZADAS da
conversa aberta (só texto e quem falou; sem nome, telefone, e-mail, link ou número longo). Uma tarefa
agendada do Claude (assinatura que a agência já paga) lê as amostras pendentes por uma chave própria,
avalia e devolve os insights, que aparecem em Qualidade. Amostras expiram em 14 dias.
"""
import re, json, secrets
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import unquote
from pydantic import Field
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from core import db, now, iso, uid, digest, manager, settings, audit, assign_shift, clean_time
from schemas import Strict

router = APIRouter()
SAMPLE_DAYS = 14
MAX_MESSAGES = 40
PAGE_CHARS = 14000

class SampleMessage(Strict):
    ours: bool
    at: Optional[datetime] = None
    text: str = Field(min_length=1, max_length=400)
class SampleIn(Strict):
    creator_id: str
    fan_ref: str = Field(pattern=r'^[a-f0-9]{64}$')
    captured_at: datetime
    messages: list[SampleMessage] = Field(min_length=3, max_length=MAX_MESSAGES)
class InsightItem(Strict):
    operator_name: str = Field(default='', max_length=80)
    creator_name: str = Field(default='', max_length=80)
    score: Optional[int] = Field(default=None, ge=0, le=10)
    strengths: str = Field(default='', max_length=1500)
    improve: str = Field(default='', max_length=1500)
    example: str = Field(default='', max_length=600)
class InsightIn(Strict):
    period_start: datetime
    period_end: datetime
    summary: str = Field(min_length=10, max_length=6000)
    recommendations: str = Field(default='', max_length=4000)
    items: list[InsightItem] = Field(default_factory=list, max_length=60)
    samples: int = Field(default=0, ge=0)

# anonimização de segurança no servidor (o app já faz o mesmo antes de enviar)
SCRUB = [(re.compile(r'[\w.+-]+@[\w-]+\.[\w.]+'), '[e-mail]'), (re.compile(r'https?://\S+|www\.\S+'), '[link]'),
         (re.compile(r'\+?\d[\d\s().-]{7,}\d'), '[número]'), (re.compile(r'@[\w.]{3,}'), '[@usuário]'), (re.compile(r'\d{5,}'), '[número]')]
def scrub(text):
    for rx, rep in SCRUB: text = rx.sub(rep, text)
    return text.strip()[:400]

async def ai_allowed():
    config = await settings()
    if not config.get('storage_allowed') or not config.get('quality_ai_allowed'):
        raise HTTPException(409, 'Análise por IA desligada em Configurações.')
    return config

async def key_user(request: Request, key: str = ''):
    """A tarefa agendada do Claude se identifica pela chave gerada em Configurações (só GET)."""
    config = await settings()
    given = key or request.headers.get('x-quality-key', '')
    if not given or not config.get('quality_key_hash') or digest(given) != config['quality_key_hash']:
        raise HTTPException(401, 'Chave da tarefa inválida. Gere uma nova em Configurações.')
    return {'id': 'claude-task', 'name': 'Tarefa do Claude', 'role': 'manager'}

async def manager_or_key(request: Request, key: str = ''):
    if key or request.headers.get('x-quality-key'): return await key_user(request, key)
    from core import current_user
    user = await current_user(request)
    if user['role'] != 'manager': raise HTTPException(403, 'Somente gestores.')
    return user

async def save_sample(body: SampleIn, user):
    await ai_allowed()
    creator = await db.creators.find_one({'id': body.creator_id}, {'_id': 0, 'id': 1, 'name': 1})
    if not creator: raise HTTPException(404, 'Criadora não cadastrada.')
    if user['role'] != 'manager' and body.creator_id not in user['creator_ids']: raise HTTPException(403, 'Criadora não autorizada.')
    captured = clean_time(body.captured_at)
    shift = await assign_shift(body.creator_id, captured)
    messages = [{'ours': m.ours, 'at': clean_time(m.at) if m.at else None, 'text': scrub(m.text)} for m in body.messages]
    messages = [m for m in messages if m['text']][-MAX_MESSAGES:]
    if len(messages) < 3: return {'ok': True, 'skipped': 'curta'}
    day = captured[:10]
    row = {'creator_id': body.creator_id, 'creator_name': creator['name'], 'fan_ref': body.fan_ref, 'day': day, 'captured_at': captured,
        'operator_id': shift['operator_id'] if shift else None, 'operator_name': shift['operator_name'] if shift else 'Sem turno',
        'sent_by': user['id'], 'messages': messages, 'analyzed_at': None, 'expires_at': now() + timedelta(days=SAMPLE_DAYS)}
    # uma amostra por conversa por dia: a mais recente substitui (a conversa cresceu)
    await db.samples.update_one({'creator_id': body.creator_id, 'fan_ref': body.fan_ref, 'day': day}, {'$set': row, '$setOnInsert': {'id': uid()}}, upsert=True)
    return {'ok': True}

@router.post('/quality/key')
async def make_key(user=Depends(manager)):
    key = 'ap_' + secrets.token_urlsafe(30)
    await db.settings.update_one({'id': 'main'}, {'$set': {'quality_key_hash': digest(key), 'quality_key_at': iso()}}, upsert=True)
    await audit(user, 'Chave da tarefa de IA gerada', 'Qualidade')
    return {'key': key}

@router.get('/quality/status')
async def status(user=Depends(manager)):
    config = await settings()
    pending = await db.samples.count_documents({'analyzed_at': None, 'expires_at': {'$gt': now()}})
    total = await db.samples.count_documents({'expires_at': {'$gt': now()}})
    last = await db.insights.find_one({}, {'_id': 0, 'created_at': 1}, sort=[('created_at', -1)])
    return {'enabled': bool(config.get('quality_ai_allowed')), 'key_set': bool(config.get('quality_key_hash')), 'key_at': config.get('quality_key_at'),
        'samples_pending': pending, 'samples_total': total, 'last_insight_at': last['created_at'] if last else None}

@router.get('/quality/samples', response_class=PlainTextResponse)
async def samples_text(request: Request, key: str = '', part: int = 1, user=Depends(manager_or_key)):
    """Amostras pendentes em texto simples, paginadas (part=1..N), para a tarefa do Claude ler."""
    rows = await db.samples.find({'analyzed_at': None, 'expires_at': {'$gt': now()}}, {'_id': 0}).sort('captured_at', 1).to_list(2000)
    blocks = []
    for r in rows:
        lines = [f"### Amostra {r['id']} · criadora: {r['creator_name']} · chatter: {r['operator_name']} · capturada em {r['captured_at'][:16]}"]
        for m in r['messages']:
            who = 'CHATTER (em nome da criadora)' if m['ours'] else 'FÃ'
            lines.append(f"[{(m['at'] or '')[11:16]}] {who}: {m['text']}")
        blocks.append('\n'.join(lines))
    pages, cur = [], ''
    for b in blocks:
        if cur and len(cur) + len(b) > PAGE_CHARS: pages.append(cur); cur = ''
        cur += b + '\n\n'
    if cur: pages.append(cur)
    total = max(len(pages), 1)
    head = f"ALTA PULSE · amostras anonimizadas de conversa · {len(rows)} conversas pendentes · página {part} de {total}\n\n"
    if not rows: return head + 'Nenhuma amostra pendente.'
    if part < 1 or part > total: raise HTTPException(404, f'Página inexistente (1 a {total}).')
    return head + pages[part - 1]

async def store_insight(body: InsightIn, user):
    start, end = clean_time(body.period_start), clean_time(body.period_end)
    row = {'id': uid(), 'period_start': start, 'period_end': end, 'summary': body.summary.strip(), 'recommendations': body.recommendations.strip(),
        'items': [i.model_dump() for i in body.items], 'samples': body.samples, 'created_at': iso(), 'by': user['name']}
    await db.insights.insert_one(dict(row))
    marked = await db.samples.update_many({'analyzed_at': None, 'captured_at': {'$lte': iso()}}, {'$set': {'analyzed_at': iso(), 'insight_id': row['id']}})
    row['samples_marked'] = marked.modified_count
    return row

@router.post('/quality/insights')
async def post_insight(body: InsightIn, request: Request, user=Depends(manager_or_key)):
    return await store_insight(body, user)

@router.get('/quality/insights/ingest')
async def ingest_insight(request: Request, key: str = '', payload: str = '', user=Depends(key_user)):
    """Entrada por GET para a tarefa agendada (que só consegue abrir URLs): payload = JSON codificado na URL."""
    try: data = json.loads(unquote(payload))
    except Exception: raise HTTPException(422, 'payload não é JSON válido.')
    try: body = InsightIn(**data)
    except Exception as error: raise HTTPException(422, f'payload inválido: {str(error)[:300]}')
    row = await store_insight(body, user)
    return {'ok': True, 'id': row['id'], 'samples_marked': row['samples_marked']}

@router.get('/quality/insights')
async def list_insights(user=Depends(manager)):
    return await db.insights.find({}, {'_id': 0}).sort('created_at', -1).to_list(30)

@router.delete('/quality/insights/{insight_id}')
async def delete_insight(insight_id: str, user=Depends(manager)):
    await db.insights.delete_one({'id': insight_id}); return {'ok': True}
