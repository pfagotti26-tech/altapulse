"""Memória do fã: o que o assinante conta no chat (pet, gostos, viagem, fantasias…), confirmado pelo chatter.

- A IA SUGERE fatos novos junto com cada sugestão de mensagem; nada é salvo sem o clique do chatter.
- Separada por criadora (a memória do fã da Feli não aparece para outra criadora). Toda a equipe da criadora vê.
- Nunca guarda dado sensível: telefone, e-mail, @ de rede, links, documentos, endereço, local de trabalho,
  saúde, religião, política. O servidor filtra de novo, mesmo que a IA erre.
- Validade: "momento" (viagem, prova, aniversário da semana) some em 30 dias; o resto em 12 meses.
"""
import re
from datetime import datetime, timedelta, timezone
from typing import Literal
from pydantic import Field
from fastapi import APIRouter, Depends, HTTPException
from core import db, now, iso, uid
from schemas import Strict
from extension_routes import extension_user
from fans import can_see

router = APIRouter()
KINDS = {'sobre': 'Sobre ele', 'gostos': 'Gostos', 'fantasia': 'Fantasias e conteúdo', 'momento': 'Momentos', 'compras': 'Compras e objeções'}
SENSITIVE = re.compile(
    r'(\+?\d[\d\s().-]{7,}\d|@[\w.]{3,}|https?://|www\.|\S+@\S+\.\w+|\bcpf\b|\brg\b|\bcnpj\b|\brua\b|\bavenida\b|\bav\.\s|\bcep\b|endere[çc]o|'
    r'trabalh\w* (na|no|em) [A-Z]|\bempresa\b|whats|zap\b|telegram|instagram|insta\b|tiktok|twitter|facebook|'
    r'doen[çc]a|c[âa]ncer|\bhiv\b|depress|ansiedade|rem[ée]dio|diagn[óo]st|igreja|religi|evang[ée]l|cat[óo]lic|partido|bolsonar|\blula\b|'
    r'senha|cart[ãa]o de cr[ée]dito|conta banc)', re.I)

def clean_fact(text):
    t = re.sub(r'\s+', ' ', str(text or '')).strip()[:140]
    if len(t) < 3 or SENSITIVE.search(t): return None
    return t

class FactIn(Strict):
    kind: Literal['sobre', 'gostos', 'fantasia', 'momento', 'compras'] = 'sobre'
    text: str = Field(min_length=2, max_length=140)
    date: str = Field(default='', pattern=r'^(\d{4}-\d{2}-\d{2})?$')
class FactsIn(Strict):
    creator_id: str
    fan_ref: str = Field(pattern=r'^[a-f0-9]{64}$')
    items: list[FactIn] = Field(min_length=1, max_length=10)
class SkipIn(Strict):
    creator_id: str
    fan_ref: str = Field(pattern=r'^[a-f0-9]{64}$')
    skip: bool = True

async def list_facts(creator_id, fan_ref, limit=40):
    rows = await db.fan_memory.find({'creator_id': creator_id, 'fan_ref': fan_ref}, {'_id': 0, 'expires_at': 0}).sort('created_at', -1).to_list(limit)
    return rows

def facts_block(rows, today=None):
    """Bloco para a IA: o que a equipe já sabe do fã (momentos com quantos dias faz)."""
    if not rows: return ''
    d0 = datetime.now(timezone.utc).date()
    out = []
    for r in rows[:25]:
        when = ''
        ref = r.get('date') or (r.get('created_at') or '')[:10]
        try:
            days = (d0 - datetime.strptime(ref, '%Y-%m-%d').date()).days
            if r['kind'] == 'momento': when = ' (hoje)' if days == 0 else (f' (há {days} dias)' if days > 0 else f' (daqui a {-days} dias)')
        except ValueError: pass
        out.append(f"- [{KINDS.get(r['kind'], r['kind'])}] {r['text']}{when}")
    return 'O QUE A EQUIPE JÁ SABE DESTE FÃ (use para criar intimidade e puxar assunto; não pergunte de novo o que já está aqui):\n' + '\n'.join(out)

def pick_new_facts(raw, existing):
    """Filtra os fatos que a IA sugeriu: tira sensíveis, repetidos e vazios."""
    have = {re.sub(r'\W+', '', (x.get('text') or '').lower()) for x in existing}
    out, seen = [], set()
    for f in (raw or [])[:6]:
        if not isinstance(f, dict): continue
        t = clean_fact(f.get('texto') or f.get('text'))
        if not t: continue
        k = re.sub(r'\W+', '', t.lower())
        if k in have or k in seen: continue
        seen.add(k)
        kind = f.get('tipo') if f.get('tipo') in KINDS else 'sobre'
        date = str(f.get('data') or '')
        out.append({'kind': kind, 'text': t, 'date': date if re.match(r'^\d{4}-\d{2}-\d{2}$', date) else ''})
    return out

@router.get('/extension/fan/memory')
async def get_memory(creator_id: str, fan_ref: str, user=Depends(extension_user)):
    await can_see(user, creator_id)
    st = await db.fan_state.find_one({'creator_id': creator_id, 'fan_ref': fan_ref}, {'_id': 0}) or {}
    return {'facts': await list_facts(creator_id, fan_ref), 'kinds': KINDS, 'skip_connection': bool(st.get('skip_connection'))}

@router.post('/extension/fan/memory')
async def add_memory(body: FactsIn, user=Depends(extension_user)):
    await can_see(user, body.creator_id)
    existing = await list_facts(body.creator_id, body.fan_ref, 200)
    have = {re.sub(r'\W+', '', x['text'].lower()) for x in existing}
    added = 0
    for f in body.items:
        t = clean_fact(f.text)
        if not t: continue
        k = re.sub(r'\W+', '', t.lower())
        if k in have: continue
        have.add(k)
        ttl = timedelta(days=30) if f.kind == 'momento' else timedelta(days=365)
        await db.fan_memory.insert_one({'id': uid(), 'creator_id': body.creator_id, 'fan_ref': body.fan_ref, 'kind': f.kind, 'text': t, 'date': f.date,
                                        'by_id': user['id'], 'by_name': user['name'], 'created_at': iso(), 'expires_at': now() + ttl})
        added += 1
    if not added and body.items: raise HTTPException(422, 'Nada foi salvo: o texto parece ter dado pessoal (telefone, @, endereço, trabalho, saúde…) ou já estava anotado.')
    return {'added': added, 'facts': await list_facts(body.creator_id, body.fan_ref)}

@router.delete('/extension/fan/memory/{fact_id}')
async def del_memory(fact_id: str, user=Depends(extension_user)):
    row = await db.fan_memory.find_one({'id': fact_id}, {'_id': 0, 'creator_id': 1})
    if not row: raise HTTPException(404, 'Anotação não encontrada.')
    await can_see(user, row['creator_id'])
    await db.fan_memory.delete_one({'id': fact_id})
    return {'ok': True}

@router.put('/extension/fan/connection')
async def skip_connection(body: SkipIn, user=Depends(extension_user)):
    """Chatter encerra (ou volta) a fase de conexão deste fã."""
    await can_see(user, body.creator_id)
    await db.fan_state.update_one({'creator_id': body.creator_id, 'fan_ref': body.fan_ref},
                                  {'$set': {'creator_id': body.creator_id, 'fan_ref': body.fan_ref, 'skip_connection': body.skip, 'at': iso(), 'by_name': user['name']}}, upsert=True)
    return {'ok': True, 'skip_connection': body.skip}
