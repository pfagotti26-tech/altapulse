"""Conteúdo e disparos: quem fez cada post e cada mensagem em massa, e quanto vendeu.

De onde vem cada dado:
- AUTORIA: o app desktop registra o disparo/post no momento em que a pessoa clica em Enviar/Agendar/Postar
  no app dela (cada app tem o seu usuário). Com o código que a Privacy devolve = "confirmado"; só pelo clique
  = "provável". Itens feitos fora do app aparecem pelo calendário da Privacy como "sem atribuição".
  O admin pode atribuir ou trocar o dono (fica no histórico).
- RESULTADO DO POST: Meu Privacy → Engajamento (compras, faturamento, curtidas, comentários, mimos por post).
- RESULTADO DA MENSAGEM EM MASSA: a Privacy não mostra vendas por disparo. Estimativa pelo extrato: vendas
  de mensagem paga no MESMO valor do disparo, depois do envio (até 7 dias ou até o próximo disparo no mesmo
  valor). Valor "quebrado" e único (ex.: R$ 49,87) deixa a atribuição praticamente exata.
- Nada aqui envia ou posta: só registra e mede.
"""
import csv, io, re, hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional, Literal
from pydantic import Field
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from core import db, now, iso, uid, current_user, has_perm, audit, is_staff
from schemas import Strict
from extension_routes import extension_user
import profile_model as PM

router = APIRouter()
BRT = timezone(timedelta(hours=-3))
PERMS = ('conteudo_app', 'conteudo_planejar', 'conteudo_proprio', 'conteudo_relatorio', 'conteudo_atribuir')
KIND_LABEL = {'mass': 'Mensagem em massa', 'post': 'Postagem', 'live': 'Live'}
STATUS_LABEL = {'done': 'Concluído', 'scheduled': 'Agendado', 'canceled': 'Cancelado'}
ATTR_LABEL = {'auto': 'Confirmado', 'probable': 'Provável', 'manual': 'Manual', 'none': 'Sem atribuição'}
MATCH_MIN = 4  # minutos de folga para casar o clique no app com o item do calendário/engajamento

def text_key(t):
    t = re.sub(r'[^a-z0-9à-ÿ]+', '', (t or '').lower())
    return t[:60]
def parse_at(v):
    if not v: return None
    try:
        d = datetime.fromisoformat(str(v).replace('Z', '+00:00'))
        return d if d.tzinfo else d.replace(tzinfo=BRT)
    except ValueError: return None
def norm_iso(v):
    d = parse_at(v); return d.astimezone(timezone.utc).isoformat() if d else None

async def features(creator_id):
    prof = await db.assist_profiles.find_one({'creator_id': creator_id}, {'_id': 0, 'features': 1}) or {}
    return PM.normalize(prof)['features']
def perms_of(user):
    return {p: has_perm(user, p) for p in PERMS}
async def allowed_creator(user, creator_id):
    if not is_staff(user) and creator_id not in (user.get('creator_ids') or []): raise HTTPException(403, 'Criadora não autorizada.')

# ---------------------------------------------------------------- app desktop
class ActionIn(Strict):
    creator_id: str
    kind: Literal['mass', 'post']
    action: Literal['send', 'schedule', 'edit', 'cancel'] = 'send'
    text: str = Field(default='', max_length=2000)
    price_cents: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    scheduled_for: Optional[str] = Field(default=None, max_length=40)
    audience: list[str] = Field(default_factory=list, max_length=12)
    media_count: int = Field(default=0, ge=0, le=50)
    privacy_ref: str = Field(default='', max_length=120)
    confidence: Literal['confirmed', 'probable'] = 'probable'
    net_path: str = Field(default='', max_length=200)
class PostRow(Strict):
    posted_at: str = Field(max_length=40)
    caption: str = Field(default='', max_length=2000)
    price_cents: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    revenue_cents: int = Field(default=0, ge=0, le=1_000_000_000)
    tips_cents: int = Field(default=0, ge=0, le=1_000_000_000)
    likes: int = Field(default=0, ge=0, le=10_000_000)
    comments: int = Field(default=0, ge=0, le=10_000_000)
    purchases: int = Field(default=0, ge=0, le=10_000_000)
class PostsIn(Strict):
    creator_id: str
    rows: list[PostRow] = Field(max_length=500)
class CalRow(Strict):
    at: str = Field(max_length=40)
    kind: Literal['mass', 'post', 'live']
    status: Literal['done', 'scheduled', 'canceled', 'unknown'] = 'unknown'
    text: str = Field(default='', max_length=2000)
class CalendarIn(Strict):
    creator_id: str
    rows: list[CalRow] = Field(max_length=600)
class NetEntry(Strict):
    method: str = Field(max_length=10)
    path: str = Field(max_length=200)
    status: int = 0
    context: str = Field(default='', max_length=20)
    req_keys: list[str] = Field(default_factory=list, max_length=60)
    res_keys: list[str] = Field(default_factory=list, max_length=60)
class NetIn(Strict):
    creator_id: str
    entries: list[NetEntry] = Field(max_length=50)

async def find_match(creator_id, kind, at, text, window_min=MATCH_MIN, extra=None):
    """Item já registrado que é o mesmo: horário próximo ou o mesmo texto em até 2 dias."""
    q = {'creator_id': creator_id, 'kind': kind, **(extra or {})}
    if at:
        lo, hi = (at - timedelta(minutes=window_min)).isoformat(), (at + timedelta(minutes=window_min)).isoformat()
        rows = await db.content_items.find({**q, 'at': {'$gte': lo, '$lte': hi}}, {'_id': 0}).to_list(20)
        k = text_key(text)
        if rows:
            same = [r for r in rows if k and r.get('text_key') == k]
            return same[0] if same else rows[0]
    k = text_key(text)
    if k and len(k) >= 12 and at:
        lo, hi = (at - timedelta(days=2)).isoformat(), (at + timedelta(days=2)).isoformat()
        hit = await db.content_items.find_one({**q, 'text_key': k, 'at': {'$gte': lo, '$lte': hi}}, {'_id': 0})
        if hit: return hit
        # agendado pelo app sem o horário lido da tela: casa pelo texto até 14 dias depois do clique
        lo = (at - timedelta(days=14)).isoformat()
        return await db.content_items.find_one({**q, 'text_key': k, 'at_unknown': True, 'at': {'$gte': lo, '$lte': hi}}, {'_id': 0})
    return None
def real_time(cur, at):
    return {'at': at.astimezone(timezone.utc).isoformat(), 'at_unknown': False} if cur.get('at_unknown') else {}

@router.get('/extension/content/config')
async def ext_config(user=Depends(extension_user)):
    ids = None if is_staff(user) else set(user.get('creator_ids') or [])
    rows = await db.assist_profiles.find({}, {'_id': 0, 'creator_id': 1, 'features': 1}).to_list(2000)
    feats = {r['creator_id']: PM.normalize(r)['features'] for r in rows}
    creators = await db.creators.find({'deleted_at': None}, {'_id': 0, 'id': 1}).to_list(2000)
    out = {}
    for c in creators:
        if ids is not None and c['id'] not in ids: continue
        f = feats.get(c['id']) or PM.normalize({})['features']
        out[c['id']] = {'read': bool(f.get('content_read')), 'capture': bool(f.get('content_capture'))}
    return {'perms': perms_of(user), 'creators': out}

@router.post('/extension/content/action')
async def ext_action(body: ActionIn, user=Depends(extension_user)):
    await allowed_creator(user, body.creator_id)
    if not (await features(body.creator_id)).get('content_capture'): return {'ok': False, 'detail': 'registro desligado para esta criadora'}
    at = parse_at(body.scheduled_for) if body.scheduled_for else None
    at_unknown = at is None and body.action == 'schedule'
    at = at or now()
    attr = 'auto' if body.confidence == 'confirmed' else 'probable'
    who = {'author_id': user['id'], 'author_name': user['name'], 'author_role': user.get('role')}
    hist = {'at': iso(), 'by_id': user['id'], 'by_name': user['name'], 'what': {'send': 'enviou', 'schedule': 'agendou', 'edit': 'editou', 'cancel': 'cancelou'}[body.action]}
    cur = None
    if body.privacy_ref: cur = await db.content_items.find_one({'creator_id': body.creator_id, 'privacy_ref': body.privacy_ref}, {'_id': 0})
    if not cur: cur = await find_match(body.creator_id, body.kind, at, body.text)
    if cur and body.action in ('edit', 'cancel'):
        patch = {'updated_at': iso()}
        if body.action == 'cancel': patch['status'] = 'canceled'
        if body.text: patch.update(text=body.text[:2000], text_key=text_key(body.text))
        if body.price_cents is not None: patch['price_cents'] = body.price_cents
        await db.content_items.update_one({'id': cur['id']}, {'$set': patch, '$push': {'history': hist}})
        return {'ok': True, 'id': cur['id'], 'matched': True}
    if cur:
        patch = {'updated_at': iso(), 'sources': sorted(set((cur.get('sources') or []) + ['app']))}
        # quem clicou no app passa a ser o dono, a não ser que o admin já tenha definido à mão
        if cur.get('attribution') in (None, 'none', 'probable') or (cur.get('attribution') == 'auto' and attr == 'auto' and not cur.get('author_id')):
            patch.update(who); patch['attribution'] = 'auto' if (attr == 'auto' or 'calendar' in (cur.get('sources') or []) or 'stats' in (cur.get('sources') or [])) else attr
        for k, v in (('text', body.text[:2000]), ('price_cents', body.price_cents), ('privacy_ref', body.privacy_ref)):
            if v and not cur.get(k): patch[k] = v
        if body.text and not cur.get('text_key'): patch['text_key'] = text_key(body.text)
        if body.audience: patch['audience'] = body.audience
        await db.content_items.update_one({'id': cur['id']}, {'$set': patch, '$push': {'history': hist}})
        return {'ok': True, 'id': cur['id'], 'matched': True}
    row = {'id': uid(), 'creator_id': body.creator_id, 'kind': body.kind, 'at': at.astimezone(timezone.utc).isoformat(),
           'status': 'scheduled' if body.action == 'schedule' and (at_unknown or at > now()) else 'done', 'text': body.text[:2000], 'text_key': text_key(body.text),
           'price_cents': body.price_cents, 'audience': body.audience, 'media_count': body.media_count, 'privacy_ref': body.privacy_ref or '',
           'at_unknown': at_unknown, 'attribution': attr, **who, 'sources': ['app'], 'net_path': body.net_path, 'history': [hist], 'created_at': iso(), 'updated_at': iso()}
    await db.content_items.insert_one(dict(row))
    return {'ok': True, 'id': row['id'], 'matched': False}

@router.post('/extension/content/posts')
async def ext_posts(body: PostsIn, user=Depends(extension_user)):
    """Meu Privacy → Engajamento: resultado de cada post (lido na aba oculta)."""
    await allowed_creator(user, body.creator_id)
    if not (await features(body.creator_id)).get('content_read'): return {'ok': False, 'saved': 0}
    saved = 0; t = iso()
    for r in body.rows:
        at = parse_at(r.posted_at)
        if not at: continue
        stats = {'purchases': r.purchases, 'revenue_cents': r.revenue_cents, 'tips_cents': r.tips_cents, 'likes': r.likes, 'comments': r.comments, 'read_at': t}
        cur = await find_match(body.creator_id, 'post', at, r.caption)
        if cur:
            patch = {'stats': stats, 'updated_at': t, 'sources': sorted(set((cur.get('sources') or []) + ['stats'])), 'status': 'done', **real_time(cur, at)}
            if r.price_cents is not None: patch['price_cents'] = r.price_cents
            if r.caption and not cur.get('text'): patch.update(text=r.caption, text_key=text_key(r.caption))
            if cur.get('attribution') == 'probable': patch['attribution'] = 'auto'  # o clique no app bateu com um post real
            last = (cur.get('stats_hist') or [{}])[-1]
            upd = {'$set': patch}
            if last.get('purchases') != r.purchases or last.get('revenue_cents') != r.revenue_cents:
                upd['$push'] = {'stats_hist': {'$each': [{'at': t, 'purchases': r.purchases, 'revenue_cents': r.revenue_cents}], '$slice': -60}}
            await db.content_items.update_one({'id': cur['id']}, upd)
        else:
            await db.content_items.insert_one({'id': uid(), 'creator_id': body.creator_id, 'kind': 'post', 'at': at.astimezone(timezone.utc).isoformat(), 'status': 'done',
                'text': r.caption, 'text_key': text_key(r.caption), 'price_cents': r.price_cents, 'audience': [], 'privacy_ref': '', 'attribution': 'none',
                'author_id': None, 'author_name': None, 'sources': ['stats'], 'stats': stats, 'stats_hist': [{'at': t, 'purchases': r.purchases, 'revenue_cents': r.revenue_cents}],
                'history': [], 'created_at': t, 'updated_at': t})
        saved += 1
    await db.content_reads.update_one({'creator_id': body.creator_id}, {'$set': {'creator_id': body.creator_id, 'posts_at': t, 'posts_n': saved}}, upsert=True)
    return {'ok': True, 'saved': saved}

@router.post('/extension/content/calendar')
async def ext_calendar(body: CalendarIn, user=Depends(extension_user)):
    """Calendário da Privacy (lista do mês): mostra também o que foi feito fora do app."""
    await allowed_creator(user, body.creator_id)
    if not (await features(body.creator_id)).get('content_read'): return {'ok': False, 'saved': 0}
    saved = 0; t = iso()
    for r in body.rows:
        at = parse_at(r.at)
        if not at or r.kind == 'live': continue
        cur = await find_match(body.creator_id, r.kind, at, r.text)
        status = {'done': 'done', 'scheduled': 'scheduled', 'canceled': 'canceled'}.get(r.status)
        if cur:
            patch = {'updated_at': t, 'sources': sorted(set((cur.get('sources') or []) + ['calendar'])), **real_time(cur, at)}
            if status: patch['status'] = status
            if r.text and not cur.get('text'): patch.update(text=r.text, text_key=text_key(r.text))
            if cur.get('attribution') == 'probable': patch['attribution'] = 'auto'
            await db.content_items.update_one({'id': cur['id']}, {'$set': patch})
        else:
            await db.content_items.insert_one({'id': uid(), 'creator_id': body.creator_id, 'kind': r.kind, 'at': at.astimezone(timezone.utc).isoformat(), 'status': status or 'done',
                'text': r.text, 'text_key': text_key(r.text), 'price_cents': None, 'audience': [], 'privacy_ref': '', 'attribution': 'none',
                'author_id': None, 'author_name': None, 'sources': ['calendar'], 'history': [], 'created_at': t, 'updated_at': t})
        saved += 1
    await db.content_reads.update_one({'creator_id': body.creator_id}, {'$set': {'creator_id': body.creator_id, 'calendar_at': t, 'calendar_n': saved}}, upsert=True)
    return {'ok': True, 'saved': saved}

@router.post('/extension/content/netlog')
async def ext_netlog(body: NetIn, user=Depends(extension_user)):
    """Diagnóstico: formato (só nomes de campos, nunca valores) das chamadas da Privacy ao enviar/postar."""
    await allowed_creator(user, body.creator_id)
    rows = [{**e.model_dump(), 'creator_id': body.creator_id, 'user_name': user['name'], 'at': iso()} for e in body.entries]
    if rows: await db.content_netlog.insert_many(rows)
    n = await db.content_netlog.count_documents({})
    if n > 600:
        old = await db.content_netlog.find({}, {'_id': 1}).sort('at', 1).limit(n - 500).to_list(n)
        await db.content_netlog.delete_many({'_id': {'$in': [o['_id'] for o in old]}})
    return {'ok': True}

# ---------------------------------------------------------------- resultado
async def mass_results(items):
    """Vendas de mensagem paga no valor de cada disparo, depois do envio (estimativa pelo extrato)."""
    by_creator = {}
    for it in items:
        if it['kind'] == 'mass' and it.get('price_cents'): by_creator.setdefault(it['creator_id'], []).append(it)
    for cid, lst in by_creator.items():
        prof = await db.assist_profiles.find_one({'creator_id': cid}, {'_id': 0, 'prices': 1}) or {}
        table = {int(p['cents']) for p in prof.get('prices') or [] if p.get('cents')}
        # todos os disparos da criadora no período (mesmo fora do filtro) para dividir janelas
        allm = await db.content_items.find({'creator_id': cid, 'kind': 'mass', 'price_cents': {'$gt': 0}}, {'_id': 0, 'id': 1, 'at': 1, 'price_cents': 1}).sort('at', 1).to_list(5000)
        for it in lst:
            start = parse_at(it['at']); end = start + timedelta(days=7)
            later = [parse_at(m['at']) for m in allm if m['price_cents'] == it['price_cents'] and m['id'] != it['id'] and parse_at(m['at']) > start]
            if later: end = min(end, min(later))
            sales = await db.events.find({'creator_id': cid, 'kind': 'sale', 'sale_source': 'extrato', 'sale_origin': 'chat', 'amount_cents': it['price_cents'],
                                          'sale_status': {'$ne': 'refunded'}, 'confirmed_at': {'$gte': start.isoformat(), '$lt': end.isoformat()}},
                                         {'_id': 0, 'confirmed_at': 1, 'amount_cents': 1}).to_list(5000)
            win = lambda h: sum(1 for s in sales if parse_at(s['confirmed_at']) < start + timedelta(hours=h))
            cents = it['price_cents']; round_price = cents % 100 in (0, 90, 99, 50) or cents in table
            it['result'] = {'purchases': len(sales), 'revenue_cents': sum(s['amount_cents'] for s in sales), 'h24': win(24), 'h72': win(72), 'd7': len(sales),
                            'quality': 'estimado' if round_price else 'forte', 'until': end.isoformat(), 'source': 'extrato'}
    for it in items:
        if it['kind'] == 'post':
            st = it.get('stats') or {}; hist = it.get('stats_hist') or []; start = parse_at(it['at'])
            def at_h(h):
                lim = start + timedelta(hours=h); best = None
                for x in hist:
                    if parse_at(x['at']) <= lim + timedelta(hours=3): best = x
                return best['purchases'] if best and parse_at(hist[-1]['at']) >= lim else None
            it['result'] = {'purchases': st.get('purchases', 0), 'revenue_cents': st.get('revenue_cents', 0), 'tips_cents': st.get('tips_cents', 0), 'likes': st.get('likes', 0),
                            'comments': st.get('comments', 0), 'h24': at_h(24), 'h72': at_h(72), 'd7': at_h(168), 'quality': 'exato' if st else 'sem leitura', 'source': 'engajamento'}
        it.setdefault('result', {'purchases': 0, 'revenue_cents': 0, 'quality': 'sem valor' if it['kind'] == 'mass' else 'sem leitura'})
    return items

async def report_user(user):
    p = perms_of(user)
    if not (p['conteudo_relatorio'] or p['conteudo_proprio']): raise HTTPException(403, 'Você não tem acesso a Conteúdo e disparos.')
    return user, p

async def query_items(user, p, start, end, creator_id, kind, author, attribution):
    q = {}
    if start or end: q['at'] = {}
    if start: q['at']['$gte'] = norm_iso(start) or start
    if end: q['at']['$lt'] = norm_iso(end) or end
    if creator_id: q['creator_id'] = creator_id
    if kind: q['kind'] = kind
    if attribution: q['attribution'] = attribution
    if author == 'none': q['author_id'] = None
    elif author: q['author_id'] = author
    if not p['conteudo_relatorio']: q['author_id'] = user['id']  # só os próprios números
    q['status'] = {'$ne': 'canceled'}
    rows = await db.content_items.find(q, {'_id': 0, 'stats_hist': 0}).sort('at', -1).to_list(3000)
    names = {c['id']: c['name'] for c in await db.creators.find({}, {'_id': 0, 'id': 1, 'name': 1}).to_list(2000)}
    for r in rows: r['creator_name'] = names.get(r['creator_id'], '—')
    return await mass_results(rows)

@router.get('/content/meta')
async def content_meta(user=Depends(current_user)):
    user, p = await report_user(user)
    creators = await db.creators.find({'deleted_at': None}, {'_id': 0, 'id': 1, 'name': 1}).sort('name', 1).to_list(2000)
    people = await db.users.find({'active': True}, {'_id': 0, 'id': 1, 'name': 1, 'role': 1}).sort('name', 1).to_list(500) if p['conteudo_relatorio'] else [{'id': user['id'], 'name': user['name'], 'role': user.get('role')}]
    reads = {r['creator_id']: r for r in await db.content_reads.find({}, {'_id': 0}).to_list(2000)}
    return {'perms': p, 'creators': creators, 'people': people, 'reads': reads}

@router.get('/content/items')
async def content_items(start: str = '', end: str = '', creator_id: str = '', kind: str = '', author: str = '', attribution: str = '', user=Depends(current_user)):
    user, p = await report_user(user)
    rows = await query_items(user, p, start, end, creator_id, kind, author, attribution)
    for r in rows: r.pop('history', None) if not p['conteudo_relatorio'] else None
    return {'items': rows[:1500], 'total': len(rows)}

@router.get('/content/summary')
async def content_summary(start: str = '', end: str = '', creator_id: str = '', kind: str = '', author: str = '', attribution: str = '', user=Depends(current_user)):
    user, p = await report_user(user)
    rows = await query_items(user, p, start, end, creator_id, kind, author, attribution)
    def bucket(key_fn, label_fn):
        out = {}
        for r in rows:
            k = key_fn(r); b = out.setdefault(k, {'key': k, 'name': label_fn(r), 'mass': 0, 'post': 0, 'purchases': 0, 'revenue_cents': 0, 'mass_cents': 0, 'post_cents': 0, 'creators': set()})
            res = r.get('result') or {}
            b[r['kind']] = b.get(r['kind'], 0) + 1; b['purchases'] += res.get('purchases') or 0; b['revenue_cents'] += res.get('revenue_cents') or 0
            b[f"{r['kind']}_cents"] = b.get(f"{r['kind']}_cents", 0) + (res.get('revenue_cents') or 0); b['creators'].add(r['creator_name'])
        lst = []
        for b in out.values():
            n = b['mass'] + b['post']; b['per_item_cents'] = round(b['revenue_cents'] / n) if n else 0; b['creators'] = sorted(b['creators']); lst.append(b)
        return sorted(lst, key=lambda b: -b['revenue_cents'])
    by_author = bucket(lambda r: r.get('author_id') or 'none', lambda r: r.get('author_name') or 'Sem atribuição')
    by_creator = bucket(lambda r: r['creator_id'], lambda r: r['creator_name'])
    tot = {'items': len(rows), 'mass': sum(1 for r in rows if r['kind'] == 'mass'), 'post': sum(1 for r in rows if r['kind'] == 'post'),
           'revenue_cents': sum((r.get('result') or {}).get('revenue_cents') or 0 for r in rows), 'purchases': sum((r.get('result') or {}).get('purchases') or 0 for r in rows),
           'unattributed': sum(1 for r in rows if not r.get('author_id')),
           'by_attr': {k: sum(1 for r in rows if r.get('attribution') == k) for k in ATTR_LABEL}}
    return {'totals': tot, 'by_author': by_author, 'by_creator': by_creator if p['conteudo_relatorio'] else []}

class AssignIn(Strict):
    author_id: Optional[str] = None
    reason: str = Field(default='', max_length=200)

@router.patch('/content/items/{item_id}/author')
async def assign(item_id: str, body: AssignIn, user=Depends(current_user)):
    if not has_perm(user, 'conteudo_atribuir'): raise HTTPException(403, 'Só quem tem a permissão "atribuir" pode trocar o dono.')
    item = await db.content_items.find_one({'id': item_id}, {'_id': 0})
    if not item: raise HTTPException(404, 'Item não encontrado.')
    who = None
    if body.author_id:
        who = await db.users.find_one({'id': body.author_id}, {'_id': 0, 'id': 1, 'name': 1, 'role': 1})
        if not who: raise HTTPException(404, 'Pessoa não encontrada.')
    patch = {'author_id': who['id'] if who else None, 'author_name': who['name'] if who else None, 'author_role': who.get('role') if who else None,
             'attribution': 'manual' if who else 'none', 'updated_at': iso()}
    hist = {'at': iso(), 'by_id': user['id'], 'by_name': user['name'], 'what': f"atribuiu a {who['name']}" if who else 'removeu a atribuição',
            'from': item.get('author_name'), 'reason': body.reason}
    await db.content_items.update_one({'id': item_id}, {'$set': patch, '$push': {'history': hist}})
    await audit(user, 'Atribuiu disparo/post', item_id, {'de': item.get('author_name'), 'para': patch['author_name']}, body.reason or None)
    return {'ok': True, **patch}

@router.get('/content/export.csv')
async def export(start: str = '', end: str = '', creator_id: str = '', kind: str = '', author: str = '', attribution: str = '', user=Depends(current_user)):
    user, p = await report_user(user)
    rows = await query_items(user, p, start, end, creator_id, kind, author, attribution)
    buf = io.StringIO(); w = csv.writer(buf, delimiter=';')
    w.writerow(['Data (Brasília)', 'Criadora', 'Tipo', 'Situação', 'Texto', 'Preço', 'Autor', 'Atribuição', 'Compras', 'Receita', 'Compras 24h', 'Compras 72h', 'Qualidade'])
    money = lambda c: '' if c is None else f"{c / 100:.2f}".replace('.', ',')
    for r in rows:
        res = r.get('result') or {}; d = parse_at(r['at']).astimezone(BRT).strftime('%d/%m/%Y %H:%M')
        w.writerow([d, r['creator_name'], KIND_LABEL.get(r['kind'], r['kind']), STATUS_LABEL.get(r.get('status'), r.get('status')), (r.get('text') or '').replace('\n', ' ')[:300], money(r.get('price_cents')),
                    r.get('author_name') or 'Sem atribuição', ATTR_LABEL.get(r.get('attribution'), r.get('attribution')), res.get('purchases', 0), money(res.get('revenue_cents', 0)),
                    '' if res.get('h24') is None else res.get('h24'), '' if res.get('h72') is None else res.get('h72'), res.get('quality', '')])
    data = '﻿' + buf.getvalue()
    return StreamingResponse(iter([data]), media_type='text/csv; charset=utf-8', headers={'Content-Disposition': 'attachment; filename="conteudo-e-disparos.csv"'})

@router.get('/content/netlog')
async def netlog(user=Depends(current_user)):
    if not user.get('owner'): raise HTTPException(403, 'Só o dono da conta.')
    return await db.content_netlog.find({}, {'_id': 0}).sort('at', -1).to_list(300)

# ---------------------------------------------------------------- modo Conteúdo no app (painel da direita)
@router.get('/extension/content/panel')
async def ext_panel(creator_id: str, user=Depends(extension_user)):
    """Raio-X da criadora aberta: hoje x média, agenda das próximas 48 h, buracos, últimos itens, melhor horário."""
    await allowed_creator(user, creator_id)
    if not has_perm(user, 'conteudo_app'): raise HTTPException(403, 'Modo Conteúdo não liberado para você.')
    n = now(); nb = n.astimezone(BRT); day0 = nb.replace(hour=0, minute=0, second=0, microsecond=0)
    # vendas: hoje até agora x média dos últimos 14 dias até o mesmo horário; faturamento por hora (30 dias)
    since = (day0 - timedelta(days=30)).astimezone(timezone.utc).isoformat()
    sales = await db.events.find({'creator_id': creator_id, 'kind': 'sale', 'sale_status': {'$ne': 'refunded'}, 'confirmed_at': {'$gte': since}},
                                 {'_id': 0, 'confirmed_at': 1, 'amount_cents': 1, 'sale_origin': 1}).to_list(50000)
    today_c, prev, hours = 0, {}, [0] * 24
    secs = nb.hour * 3600 + nb.minute * 60
    for s in sales:
        d = parse_at(s['confirmed_at']); 
        if not d: continue
        d = d.astimezone(BRT); c = s.get('amount_cents') or 0; hours[d.hour] += c
        if d >= day0: today_c += c
        elif d >= day0 - timedelta(days=14) and d.hour * 3600 + d.minute * 60 <= secs: prev[d.date()] = prev.get(d.date(), 0) + c
    avg = round(sum(prev.values()) / 14) if prev else 0
    best = sorted(range(24), key=lambda h: -hours[h])[:3]
    # agenda e itens
    lo = (day0 - timedelta(days=7)).astimezone(timezone.utc).isoformat(); hi = (n + timedelta(hours=48)).isoformat()
    items = await db.content_items.find({'creator_id': creator_id, 'status': {'$ne': 'canceled'}, 'at': {'$gte': lo, '$lte': hi}}, {'_id': 0, 'stats_hist': 0, 'history': 0}).sort('at', -1).to_list(500)
    items = await mass_results(items)
    def bday(it): return parse_at(it['at']).astimezone(BRT).date()
    posts_today = sum(1 for i in items if i['kind'] == 'post' and bday(i) == day0.date())
    mass_today = sum(1 for i in items if i['kind'] == 'mass' and bday(i) == day0.date())
    upcoming = sorted([i for i in items if parse_at(i['at']) > n], key=lambda i: i['at'])
    gaps = []
    for k, label in ((0, 'hoje'), (1, 'amanhã')):
        d = (day0 + timedelta(days=k)).date()
        if not any(i['kind'] == 'post' and bday(i) == d for i in items): gaps.append(f'Sem post {label}')
    night = [h for h in best if h > nb.hour]
    if nb.hour < 23 and not any(i['kind'] == 'mass' and parse_at(i['at']) > n and bday(i) == day0.date() for i in items):
        gaps.append('Sem mensagem em massa programada para hoje' + (f' (pico de vendas às {night[0]}h)' if night else ''))
    recent = [i for i in items if parse_at(i['at']) <= n][:8]
    slim = lambda i: {'id': i['id'], 'kind': i['kind'], 'at': i['at'], 'status': i.get('status'), 'text': (i.get('text') or '')[:140], 'price_cents': i.get('price_cents'),
                      'author_name': i.get('author_name'), 'attribution': i.get('attribution'), 'result': i.get('result')}
    prof = await db.assist_profiles.find_one({'creator_id': creator_id}, {'_id': 0, 'prices': 1}) or {}
    table = sorted({int(p['cents']) for p in prof.get('prices') or [] if p.get('cents')})
    # preços já usados em disparos dos últimos 7 dias (para sugerir um valor que não repete)
    used = sorted({i['price_cents'] for i in items if i['kind'] == 'mass' and i.get('price_cents')})
    rd = await db.content_reads.find_one({'creator_id': creator_id}, {'_id': 0}) or {}
    return {'today_cents': today_c, 'avg_cents': avg, 'hours': hours, 'best_hours': best, 'posts_today': posts_today, 'mass_today': mass_today,
            'limits': {'posts': 25, 'scheduled': 25, 'mass': 4}, 'upcoming': [slim(i) for i in upcoming[:12]], 'gaps': gaps, 'recent': [slim(i) for i in recent],
            'table_cents': table, 'used_mass_cents': used, 'reads': rd, 'now': n.isoformat()}
