"""Alta Ajuda: sugestões de resposta para o chatter, geradas pela Grok (xAI) só quando pedidas.

- A chave da xAI fica só no servidor (db.secrets 'xai_key'); o app desktop nunca a recebe.
- Só vai para a xAI o texto que o próprio chatter escreveu (mascarado de novo aqui) e o perfil da criadora;
  nenhuma mensagem nem dado do assinante.
- O perfil da criadora (estilo, limites, teto de intensidade e tabela de preços) orienta o tom.
- Travas fixas: só adultos (sinal de menor -> nenhuma sugestão + alerta ao gestor); nada de encontro
  ou contato fora da plataforma; valores fora da tabela/ofertas do fã viram [preço] antes de chegar ao chatter.
- Nada é enviado ao fã pelo sistema: o chatter revisa e envia.
"""
import json, re
from datetime import datetime, timedelta, timezone
from typing import Optional, Literal
from zoneinfo import ZoneInfo
import httpx
from pydantic import Field
from fastapi import APIRouter, Depends, HTTPException
from core import db, now, iso, uid, manager, audit
from schemas import Strict
from extension_routes import extension_user
from fans import can_see
from fans import fan_card, money_br
from quality_ai import scrub

router = APIRouter()
BR = ZoneInfo('America/Sao_Paulo')
XAI = 'https://api.x.ai/v1'
LEVELS = ['leve', 'picante', 'explicito']
LEVEL_TEXT = {
    'leve': 'LEVE: flerte, carinho e insinuação; nada sexual explícito.',
    'picante': 'PICANTE: sensual e provocante, com duplo sentido e desejo claro, sem descrever atos sexuais em detalhe.',
    'explicito': 'EXPLÍCITO: linguagem sexual direta e sem rodeios, como numa conversa de sexting entre adultos que consentem.',
}
DEFAULT = {'id': 'main', 'enabled': False, 'daily_limit': 80, 'model': 'grok-4.7'}

def today(): return datetime.now(BR).strftime('%Y-%m-%d')
async def config():
    row = await db.assist_config.find_one({'id': 'main'}, {'_id': 0}) or {}
    return {**DEFAULT, **row}
async def xai_key():
    row = await db.secrets.find_one({'id': 'xai_key'}, {'_id': 0})
    return row.get('value') if row else None

# ---------- gestor: chave, liga/desliga, limite, modelo ----------
class ConfigIn(Strict):
    enabled: bool
    daily_limit: int = Field(ge=1, le=2000)
    model: str = Field(min_length=2, max_length=80, pattern=r'^[\w.\-:]+$')
class KeyIn(Strict):
    key: str = Field(min_length=20, max_length=300)

@router.get('/assist/config')
async def get_config(user=Depends(manager)):
    c = await config(); key = await xai_key()
    since = (datetime.now(BR) - timedelta(days=6)).strftime('%Y-%m-%d')
    usage = await db.assist_usage.aggregate([{'$match': {'day': {'$gte': since}}},
        {'$group': {'_id': {'user': '$user_id', 'day': '$day'}, 'n': {'$sum': 1}, 'name': {'$first': '$user_name'}}}]).to_list(2000)
    per = {}
    for u in usage:
        cell = per.setdefault(u['_id']['user'], {'user_id': u['_id']['user'], 'name': u['name'], 'today': 0, 'week': 0})
        cell['week'] += u['n']
        if u['_id']['day'] == today(): cell['today'] += u['n']
    alerts = await db.assist_alerts.find({}, {'_id': 0}).sort('created_at', -1).to_list(30)
    return {**c, 'key_set': bool(key), 'key_hint': ('…' + key[-4:]) if key else None,
            'usage': sorted(per.values(), key=lambda x: -x['week']), 'alerts': alerts}

@router.put('/assist/config')
async def put_config(body: ConfigIn, user=Depends(manager)):
    await db.assist_config.update_one({'id': 'main'}, {'$set': body.model_dump()}, upsert=True)
    await audit(user, 'Alta Ajuda configurada', 'assist', body.model_dump(), None)
    return await get_config(user)

@router.put('/assist/key')
async def put_key(body: KeyIn, user=Depends(manager)):
    await db.secrets.update_one({'id': 'xai_key'}, {'$set': {'id': 'xai_key', 'value': body.key.strip(), 'set_at': iso(), 'set_by': user['id']}}, upsert=True)
    await audit(user, 'Chave da Alta Ajuda cadastrada', 'assist', {'hint': body.key.strip()[-4:]}, None)
    return {'ok': True, 'key_hint': '…' + body.key.strip()[-4:]}

@router.delete('/assist/key')
async def delete_key(user=Depends(manager)):
    await db.secrets.delete_one({'id': 'xai_key'})
    await audit(user, 'Chave da Alta Ajuda removida', 'assist', None, None)
    return {'ok': True}

@router.post('/assist/test')
async def test_key(user=Depends(manager)):
    key = await xai_key()
    if not key: raise HTTPException(409, 'Cadastre a chave da xAI primeiro.')
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(f'{XAI}/models', headers={'Authorization': f'Bearer {key}'})
    except httpx.HTTPError as error: raise HTTPException(502, f'Não consegui falar com a xAI: {error.__class__.__name__}')
    if r.status_code in (401, 403): raise HTTPException(400, 'A xAI recusou a chave. Confira se copiou inteira e se a conta tem crédito.')
    if r.status_code >= 400: raise HTTPException(502, f'A xAI respondeu {r.status_code}.')
    models = sorted(m.get('id') for m in (r.json().get('data') or []) if m.get('id'))
    return {'ok': True, 'models': models}

# ---------- perfil da criadora ----------
# ficha da criadora: os mesmos campos do formulário de personalidade da agência (altaagency.com.br)
PERSONA = [  # (chave, rótulo, seção)
    ('nome_artistico', 'Nome artístico', 'basico'), ('como_ser_chamada', 'Como ser chamada', 'basico'), ('idade', 'Idade', 'basico'),
    ('cidade_estado', 'Cidade/Estado', 'basico'), ('personalidade', 'Personalidade', 'basico'), ('como_fala', 'Como fala', 'basico'),
    ('fantasias', 'Fantasias', 'basico'), ('assuntos_conversa', 'Assuntos de conversa', 'basico'), ('nao_gosta', 'O que NÃO gosta', 'basico'),
    ('bordoes', 'Bordões', 'basico'), ('como_chama_assinantes', 'Como chama assinantes', 'basico'), ('apresentacao', 'Apresentação', 'basico'),
    ('o_que_vende', 'O que vende', 'conteudo'), ('itens_pessoais', 'Vende itens pessoais', 'conteudo'),
    ('mensagens_bom_dia', 'Mensagens bom dia/boa noite', 'conteudo'), ('diferencial', 'Diferencial', 'conteudo'),
    ('estilo_visual', 'Tema/Estilo', 'visual'), ('como_falar_conteudos', 'Como falar dos conteúdos', 'visual'), ('frases_venda', 'Frases de venda', 'visual'),
    ('status_relacionamento', 'Status de relacionamento', 'extras'), ('informacoes_extras', 'Informações extras', 'extras'),
    ('resumo_ia', 'Resumo da persona (gerado por IA na agência)', 'extras'),
]
PERSONA_KEYS = {k for k, _, _ in PERSONA}
# tabela de preços mínimos (mesmos itens da agência) + itens livres
PRICE_ITEMS = ['Foto com nudez', 'Pack de fotos', 'Vídeo único', 'Pack 2-3 vídeos', 'Pack 4+ vídeos', 'Vídeo chamada ao vivo',
    'Vídeo chamada gravada', 'Vídeo personalizado', 'Solicitação de mídia', 'Sexting']
class PriceItem(Strict):
    item: str = Field(min_length=1, max_length=80)
    cents: int = Field(ge=0, le=10000000)
    obs: str = Field(default='', max_length=300)
class ProfileIn(Strict):
    style: str = Field(default='', max_length=2000)
    limits: str = Field(default='', max_length=3000)
    max_level: Literal['leve', 'picante', 'explicito'] = 'picante'
    prices: list[PriceItem] = Field(default_factory=list, max_length=40)
    persona: dict[str, str] = Field(default_factory=dict)
def clean_persona(d):
    return {k: str(v).strip()[:6000] for k, v in (d or {}).items() if k in PERSONA_KEYS and str(v or '').strip()}

@router.get('/assist/profiles')
async def list_profiles(user=Depends(manager)):
    return await db.assist_profiles.find({}, {'_id': 0}).to_list(1000)

@router.put('/assist/profiles/{creator_id}')
async def put_profile(creator_id: str, body: ProfileIn, user=Depends(manager)):
    if not await db.creators.find_one({'id': creator_id}, {'_id': 1}): raise HTTPException(404, 'Criadora não encontrada.')
    row = {'creator_id': creator_id, **body.model_dump(), 'persona': clean_persona(body.persona), 'updated_at': iso(), 'updated_by': user['name']}
    await db.assist_profiles.update_one({'creator_id': creator_id}, {'$set': row}, upsert=True)
    return row

@router.get('/assist/fields')
async def fields(user=Depends(manager)):
    return {'persona': [{'key': k, 'label': l, 'section': s} for k, l, s in PERSONA], 'price_items': PRICE_ITEMS}

class ImportItem(Strict):
    creator_id: str
    persona: dict[str, str] = Field(default_factory=dict)
    limits: str = Field(default='', max_length=3000)
    prices: list[PriceItem] = Field(default_factory=list, max_length=40)
class ImportIn(Strict):
    items: list[ImportItem] = Field(max_length=300)
    source: str = Field(default='altaagency.com.br', max_length=60)

@router.post('/assist/profiles/import')
async def import_profiles(body: ImportIn, user=Depends(manager)):
    """Traz os perfis de outra base: só preenche o que está VAZIO aqui (nunca apaga o que o gestor já escreveu)."""
    done = []
    for it in body.items:
        creator = await db.creators.find_one({'id': it.creator_id}, {'_id': 0, 'name': 1})
        if not creator: continue
        cur = await db.assist_profiles.find_one({'creator_id': it.creator_id}, {'_id': 0}) or {}
        persona = dict(cur.get('persona') or {}); added = 0
        for k, v in clean_persona(it.persona).items():
            if not persona.get(k): persona[k] = v; added += 1
        upd = {'creator_id': it.creator_id, 'persona': persona, 'imported_from': body.source, 'imported_at': iso()}
        if not cur.get('limits') and it.limits.strip(): upd['limits'] = it.limits.strip(); added += 1
        if not cur.get('prices') and it.prices: upd['prices'] = [p.model_dump() for p in it.prices]; added += 1
        if not cur: upd.update({'style': '', 'max_level': 'picante', 'updated_at': iso(), 'updated_by': user['name']})
        await db.assist_profiles.update_one({'creator_id': it.creator_id}, {'$set': upd}, upsert=True)
        done.append({'creator': creator['name'], 'fields': added})
    await audit(user, 'Perfis importados', body.source, {'creators': len(done)}, None)
    return {'ok': True, 'imported': done}

@router.get('/extension/assist/profile')
async def app_profile(creator_id: str, user=Depends(extension_user)):
    """Ficha da criadora para o chatter consultar no app (persona, limites e preços)."""
    await can_see(user, creator_id)
    prof = await db.assist_profiles.find_one({'creator_id': creator_id}, {'_id': 0}) or {}
    persona = prof.get('persona') or {}
    return {'fields': [{'label': l, 'section': s, 'value': persona[k]} for k, l, s in PERSONA if persona.get(k)],
            'limits': prof.get('limits', ''), 'style': prof.get('style', ''), 'prices': prof.get('prices') or [], 'max_level': prof.get('max_level', 'picante')}

@router.post('/assist/alerts/{alert_id}/resolve')
async def resolve_alert(alert_id: str, user=Depends(manager)):
    await db.assist_alerts.update_one({'id': alert_id}, {'$set': {'resolved_at': iso(), 'resolved_by': user['name']}})
    return {'ok': True}

# ---------- app desktop ----------
async def used_today(user_id): return await db.assist_usage.count_documents({'user_id': user_id, 'day': today()})

@router.get('/extension/assist/status')
async def status(creator_id: str, user=Depends(extension_user)):
    await can_see(user, creator_id)
    c = await config(); key = await xai_key()
    prof = await db.assist_profiles.find_one({'creator_id': creator_id}, {'_id': 0}) or {}
    return {'enabled': bool(c['enabled'] and key), 'max_level': prof.get('max_level', 'picante'),
            'has_profile': bool(prof), 'has_prices': bool(prof.get('prices')), 'remaining': max(0, c['daily_limit'] - await used_today(user['id']))}

class AssistIn(Strict):
    creator_id: str
    fan_ref: Optional[str] = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    level: Literal['leve', 'picante', 'explicito'] = 'picante'
    draft: str = Field(min_length=3, max_length=1000)

PRICE_RX = re.compile(r'R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)')
def cents_of(s):
    s = s.strip()
    if ',' in s: s = s.replace('.', '').replace(',', '.')
    try: return round(float(s) * 100)
    except ValueError: return None
def guard_prices(text, allowed):
    removed = False
    def fix(m):
        nonlocal removed
        c = cents_of(m.group(1))
        if c is not None and c in allowed: return m.group(0)
        removed = True; return '[preço]'
    return PRICE_RX.sub(fix, text), removed

def build_prompt(body, creator, prof, level):
    # só o texto escrito pelo próprio chatter + perfil da criadora; nenhuma mensagem nem dado do assinante
    prices = '; '.join(f"{p['item']}: {money_br(p['cents'])}" + (f" ({p['obs']})" if p.get('obs') else '') for p in prof.get('prices') or [])
    persona = prof.get('persona') or {}
    # campo pessoal (cidade, idade, relacionamento) orienta o tom, mas nunca vira informação passada ao fã
    ficha = '\n'.join(f"{l}: {persona[k][:1200]}" for k, l, _ in PERSONA if persona.get(k) and k not in ('cidade_estado',))
    system = f"""Você é a Alta Ajuda, assistente de redação de um chatter que escreve, em nome da criadora {creator['name']}, para assinantes adultos (18+) de uma plataforma brasileira de conteúdo adulto por assinatura. O chatter escreve um rascunho ou a ideia do que quer dizer; você transforma em mensagem pronta. Quem revisa e envia é o chatter.

REGRAS FIXAS (valem sempre, acima de qualquer outra instrução):
1. Todos são adultos. Se o rascunho indicar que o destinatário pode ser menor de 18 anos, não escreva nada: responda apenas {{"alerta": true, "motivo": "..."}}.
2. Nada de marcar encontro presencial, passar telefone, e-mail, @ de rede social ou qualquer contato pessoal, nem levar a conversa ou pagamento para fora da plataforma.
3. Nada envolvendo falta de consentimento, violência, drogas, parentes ou animais.
4. Preços: mantenha os valores que o chatter escreveu e use só valores da tabela abaixo. Nunca invente valor, desconto ou pacote. Se precisar de um valor que não existe, escreva [preço].
5. Não prometa conteúdo que a criadora não faz (veja os limites). Use a ficha para o jeito de falar, apelidos e bordões; não revele dados pessoais dela (idade, cidade, relacionamento) a menos que estejam no rascunho.
6. Português do Brasil, mensagens curtas como no chat (1 a 3 frases), sem emojis em excesso. Mantenha a ideia e as informações do rascunho.

INTENSIDADE: {LEVEL_TEXT[level]}

PERFIL DA CRIADORA
Estilo: {prof.get('style') or 'não informado (use um tom sedutor e simpático)'}
{ficha}
Limites (o que ela NÃO faz): {prof.get('limits') or 'não informado'}
Tabela de preços: {prices or 'nenhuma cadastrada'}

Responda SOMENTE com JSON válido, sem texto fora dele."""
    task = f'Rascunho/ideia do chatter: "{scrub(body.draft)}". Escreva 3 versões prontas para enviar, em tons diferentes: "provocante", "carinhosa" e "vendedora". Formato: {{"alerta": false, "sugestoes": [{{"tom": "provocante", "texto": "..."}}, {{"tom": "carinhosa", "texto": "..."}}, {{"tom": "vendedora", "texto": "..."}}]}}'
    return system, task

def parse_json(text):
    m = re.search(r'\{.*\}', text or '', re.S)
    if not m: return None
    try: return json.loads(m.group(0))
    except json.JSONDecodeError: return None

@router.post('/extension/assist')
async def assist(body: AssistIn, user=Depends(extension_user)):
    creator = await can_see(user, body.creator_id)
    c = await config(); key = await xai_key()
    if not c['enabled'] or not key: raise HTTPException(409, 'A Alta Ajuda está desligada. O gestor liga em Configurações.')
    if await used_today(user['id']) >= c['daily_limit']: raise HTTPException(429, f"Você usou as {c['daily_limit']} ajudas de hoje. O limite volta amanhã.")
    if len(body.draft.strip()) < 3: raise HTTPException(422, 'Escreva o que você quer dizer ao fã.')
    prof = await db.assist_profiles.find_one({'creator_id': body.creator_id}, {'_id': 0}) or {}
    level = LEVELS[min(LEVELS.index(body.level), LEVELS.index(prof.get('max_level', 'picante')))]
    # ofertas pendentes do fã só entram na trava de preço (no servidor); não vão para a xAI
    card = await fan_card(body.creator_id, body.fan_ref, user['id']) if body.fan_ref else None
    if not isinstance(creator, dict) or 'name' not in creator: creator = await db.creators.find_one({'id': body.creator_id}, {'_id': 0, 'name': 1}) or {'name': 'a criadora'}
    system, prompt = build_prompt(body, creator, prof, level)
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post(f'{XAI}/chat/completions', headers={'Authorization': f'Bearer {key}'},
                json={'model': c['model'], 'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': prompt}], 'temperature': 0.9})
    except httpx.HTTPError as error: raise HTTPException(502, f'A Grok não respondeu a tempo ({error.__class__.__name__}). Tente de novo.')
    if r.status_code in (401, 403): raise HTTPException(502, 'A xAI recusou a chave. Avise o gestor.')
    if r.status_code == 429: raise HTTPException(502, 'A xAI está limitando os pedidos ou a conta ficou sem crédito. Avise o gestor.')
    if r.status_code >= 400: raise HTTPException(502, f'A xAI respondeu {r.status_code}. Tente de novo.')
    data = r.json(); text = ((data.get('choices') or [{}])[0].get('message') or {}).get('content', '')
    out = parse_json(text)
    usage = data.get('usage') or {}
    await db.assist_usage.insert_one({'id': uid(), 'user_id': user['id'], 'user_name': user['name'], 'creator_id': body.creator_id, 'mode': 'improve',
        'level': level, 'day': today(), 'at': iso(), 'tokens': usage.get('total_tokens'), 'expires_at': now() + timedelta(days=120)})
    if out and out.get('alerta'):
        alert = {'id': uid(), 'creator_id': body.creator_id, 'creator_name': creator.get('name'), 'user_id': user['id'], 'user_name': user['name'],
                 'fan_ref': body.fan_ref, 'reason': str(out.get('motivo') or 'possível menor de idade')[:300], 'created_at': iso(), 'expires_at': now() + timedelta(days=400)}
        await db.assist_alerts.insert_one(dict(alert))
        return {'alert': True, 'reason': alert['reason'], 'suggestions': [], 'level': level}
    if not out: raise HTTPException(502, 'A Grok respondeu fora do formato. Tente de novo.')
    allowed = {p['cents'] for p in prof.get('prices') or []} | {o['amount_cents'] for o in ((card or {}).get('pending_offers') or [])}
    if card and (card.get('subscription') or {}).get('price_cents'): allowed.add(card['subscription']['price_cents'])
    suggestions, fixed = [], False
    for s in (out.get('sugestoes') or [])[:4]:
        t = str(s.get('texto') or '').strip()
        if not t: continue
        t, removed = guard_prices(t, allowed); fixed = fixed or removed
        suggestions.append({'tone': str(s.get('tom') or '')[:30], 'text': t[:800]})
    return {'alert': False, 'suggestions': suggestions, 'level': level, 'price_fixed': fixed,
            'remaining': max(0, c['daily_limit'] - await used_today(user['id']))}
