"""Ficha da criadora (modelo padrão): núcleo que toda criadora tem + módulos que o admin liga por criadora.

- normalize(): completa fichas antigas sem migrar o banco (categoria dos preços, módulos ligados pelo que já existe).
- completeness(): % e lista do que falta, para o selo "Ficha 85%" na página de Criadoras.
- compile_block(): monta o bloco da ficha que vai para a IA (sempre igual entre sugestões da mesma criadora,
  para aproveitar o cache da xAI). Só entra o que está preenchido e só módulos ligados.
"""
import re
from datetime import datetime
from typing import Literal, Optional
from pydantic import Field
from schemas import Strict

TONES = {'dominadora': 'Dominadora (manda, não pede)', 'namoradinha': 'Namoradinha carinhosa', 'safada': 'Safada experiente',
         'meiga': 'Meiga e tímida', 'divertida': 'Divertida e descontraída', 'elegante': 'Elegante e misteriosa', 'outro': 'Outro (descrito abaixo)'}
LIMIT_FLAGS = {'encontro': 'Encontro presencial / programa', 'contato': 'Passar contato pessoal (telefone, @, e-mail)', 'scat': 'Scat',
               'golden': 'Golden shower', 'ageplay': 'Ageplay', 'fisting': 'Fisting', 'traicao': 'Insinuação de traição',
               'incesto': 'Incesto (mesmo fantasia)', 'violencia': 'Violência / falta de consentimento', 'nome_fa': 'Falar o nome do fã',
               'trisal': 'Trisal', 'com_fa': 'Gravar com fã / assinante'}
PRICE_CATS = {'foto': 'Foto', 'pack_fotos': 'Pack de fotos', 'video': 'Vídeo', 'pack_videos': 'Pack de vídeos', 'personalizado': 'Personalizado',
              'chamada': 'Videochamada', 'chamada_gravada': 'Chamada gravada', 'avaliacao': 'Avaliação', 'audio': 'Áudio', 'sexting': 'Sexting',
              'itens': 'Itens pessoais', 'outro': 'Outro'}
MODULES = {'segments': 'Perfis de fã', 'call': 'Videochamada', 'openers': 'Aberturas', 'thermo': 'Termômetro (palavras próprias)',
           'items': 'Itens pessoais', 'promos': 'Promoções e campanhas', 'languages': 'Idiomas e moeda', 'custom': 'Personalizados (prazo)'}
DAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom']
DISCOUNT = {'nunca': 'Nunca dar desconto.', 'uma_vez': 'Desconto só uma vez por fã e com prazo curto; nunca baixar o preço do mesmo item, prefira oferecer um item menor.', 'livre': 'Pode negociar desconto quando ajudar a fechar.'}
PREVIEW = {'nao': 'Não manda prévia.', 'parcial': 'Prévia só parcial: um pedaço curto ou uma foto borrada; o resto é pago.', 'borrada': 'Prévia só borrada.', 'livre': 'Pode mandar prévia.'}

class Features(Strict):  # chaves do admin por criadora (todas ligadas por padrão)
    assist: bool = True   # Alta Ajuda inteira nesta criadora
    thermo: bool = True   # termômetro de venda
    sell: bool = True     # botão 💰 Vender e tabela de preços no cartão do fã
    content_read: bool = True     # Conteúdo: ler resultado dos posts (Engajamento) e o calendário da Privacy
    content_capture: bool = True  # Conteúdo: registrar quem disparou/postou pelo app
class Connection(Strict):  # fase de conexão com fã novo/sem histórico, antes de vender
    enabled: bool = True
    turns: int = Field(default=3, ge=1, le=8)
    questions: str = Field(default='', max_length=1200)
class Voice(Strict):
    tone: str = Field(default='', max_length=20)
    tone_notes: str = Field(default='', max_length=600)
    use_words: str = Field(default='', max_length=600)
    avoid_words: str = Field(default='', max_length=600)
    emojis: str = Field(default='', max_length=80)
class Sales(Strict):
    warm_first: bool = True
    discount: Literal['nunca', 'uma_vez', 'livre'] = 'uma_vez'
    script: str = Field(default='', max_length=2000)
class CallRules(Strict):
    days: list[str] = Field(default_factory=list, max_length=7)
    hours: str = Field(default='', max_length=60)
    notice_hours: int = Field(default=0, ge=0, le=168)
    confirm_first: bool = True
    notes: str = Field(default='', max_length=300)
class Promo(Strict):
    title: str = Field(min_length=1, max_length=80)
    text: str = Field(default='', max_length=400)
    starts: str = Field(default='', pattern=r'^(\d{4}-\d{2}-\d{2})?$')
    ends: str = Field(default='', pattern=r'^(\d{4}-\d{2}-\d{2})?$')
class Objection(Strict):
    q: str = Field(min_length=1, max_length=120)
    a: str = Field(min_length=1, max_length=400)
class Preview(Strict):
    mode: Literal['nao', 'parcial', 'borrada', 'livre'] = 'parcial'
    gift: str = Field(default='', max_length=300)
class Languages(Strict):
    langs: list[Literal['pt', 'en', 'es']] = Field(default_factory=lambda: ['pt'])
    foreign_price: Literal['brl', 'usd_convert', 'usd_fixed'] = 'brl'
    notes: str = Field(default='', max_length=300)

CAT_RX = [('chamada_gravada', r'chamada.*gravad'), ('chamada', r'chamada|ao vivo|call'), ('personalizado', r'personaliz|cosplay'),
          ('pack_videos', r'pack.*v[ií]deo|v[ií]deos'), ('pack_fotos', r'pack.*foto|fotos'), ('video', r'v[ií]deo'), ('foto', r'foto|nude'),
          ('avaliacao', r'avalia'), ('audio', r'[áa]udio'), ('sexting', r'sexting'), ('itens', r'calcinha|meia|item|itens|camisinha|pe[çc]a')]
def guess_cat(item):
    t = (item or '').lower()
    for k, rx in CAT_RX:
        if re.search(rx, t): return k
    return 'outro'

def normalize(prof):
    """Ficha no formato novo, sem perder nada da antiga (não grava: quem grava é o admin ao salvar)."""
    p = dict(prof or {})
    p['prices'] = [{**x, 'category': x.get('category') or guess_cat(x.get('item')), 'explicit': bool(x.get('explicit', re.search(r'expl[íi]cit', x.get('item', ''), re.I)))} for x in p.get('prices') or []]
    persona = p.get('persona') or {}
    mods = dict(p.get('modules') or {})
    if 'modules' not in p:
        items_txt = (persona.get('itens_pessoais') or '').strip().lower()
        mods = {'segments': bool(p.get('fan_segments')), 'openers': bool(p.get('openers')), 'thermo': bool(p.get('hot_terms')),
                'call': any(x['category'] == 'chamada' for x in p['prices']), 'items': bool(items_txt) and not items_txt.startswith('n'),
                'custom': any(x['category'] == 'personalizado' for x in p['prices']), 'promos': False, 'languages': False}
    p['modules'] = {k: bool(mods.get(k)) for k in MODULES}
    for k, d in (('voice', {}), ('sales', {}), ('call', {}), ('preview', {}), ('languages', {'langs': ['pt']})):
        p[k] = {**d, **(p.get(k) or {})}
    p['features'] = {'assist': True, 'thermo': True, 'sell': True, 'content_read': True, 'content_capture': True, **(p.get('features') or {})}
    p['connection'] = {'enabled': True, 'turns': 3, 'questions': '', **(p.get('connection') or {})}
    p.setdefault('limit_flags', ['encontro', 'contato']); p.setdefault('promos', []); p.setdefault('objections', []); p.setdefault('custom_delivery', '')
    return p

def completeness(prof):
    p = normalize(prof); persona = p.get('persona') or {}; m = p['modules']
    checks = [
        ('Identidade (nome / como chamar)', bool(persona.get('nome_artistico') or persona.get('como_ser_chamada'))),
        ('Personalidade', bool(persona.get('personalidade'))),
        ('Tom de voz', bool((p['voice'] or {}).get('tone') or persona.get('como_fala'))),
        ('Vocabulário (usar / evitar)', bool((p['voice'] or {}).get('use_words') or (p['voice'] or {}).get('avoid_words') or persona.get('como_chama_assinantes'))),
        ('Frases de venda dela', bool(persona.get('frases_venda'))),
        ('Limites', bool(p.get('limits') or len(p.get('limit_flags') or []) > 2)),
        ('Tabela de preços (3+ itens)', len(p['prices']) >= 3),
        ('Roteiro de venda', bool((p['sales'] or {}).get('script') or p.get('style'))),
        ('Respostas a objeções (2+)', len(p.get('objections') or []) >= 2),
    ]
    if m['segments']: checks.append(('Perfis de fã', bool(p.get('fan_segments'))))
    if m['call']: checks.append(('Videochamada: dias e horário', bool((p['call'] or {}).get('days') and (p['call'] or {}).get('hours'))))
    if m['openers']: checks.append(('Aberturas (2+ situações)', len([v for v in (p.get('openers') or {}).values() if v.strip()]) >= 2))
    if m['thermo']: checks.append(('Palavras do termômetro', bool(p.get('hot_terms'))))
    if m['items']: checks.append(('Preço de itens pessoais', any(x['category'] == 'itens' for x in p['prices'])))
    if m['custom']: checks.append(('Prazo de personalizados', bool(p.get('custom_delivery'))))
    if m['languages']: checks.append(('Idiomas atendidos', len((p['languages'] or {}).get('langs') or []) > 1))
    done = sum(1 for _, ok in checks if ok)
    return {'pct': round(100 * done / len(checks)), 'missing': [l for l, ok in checks if not ok], 'total': len(checks)}

def active_promos(p, day=None):
    day = day or datetime.now().strftime('%Y-%m-%d')
    return [x for x in p.get('promos') or [] if (not x.get('starts') or x['starts'] <= day) and (not x.get('ends') or x['ends'] >= day)]

def compile_block(creator, prof, money_br, persona_fields, day=None):
    p = normalize(prof); persona = p.get('persona') or {}; m = p['modules']; v = p['voice']; s = p['sales']
    L = [f"PERFIL DA CRIADORA ({creator['name']})"]
    for k, label, _ in persona_fields:
        if persona.get(k) and k != 'cidade_estado' and not (k == 'itens_pessoais' and not m['items']): L.append(f"{label}: {persona[k][:1500]}")
    voz = []
    if v.get('tone'): voz.append('tom: ' + TONES.get(v['tone'], v['tone']) + (f" ({v['tone_notes']})" if v.get('tone_notes') else ''))
    elif v.get('tone_notes'): voz.append('tom: ' + v['tone_notes'])
    if v.get('use_words'): voz.append('usar: ' + v['use_words'])
    if v.get('avoid_words'): voz.append('evitar: ' + v['avoid_words'])
    if v.get('emojis'): voz.append('emojis: ' + v['emojis'])
    if voz: L.append('VOZ: ' + ' | '.join(voz))
    L.append('ESTRATÉGIA: ' + ('aquece a conversa antes de vender (nunca oferta fria). ' if s.get('warm_first', True) else 'pode oferecer direto quando o fã der abertura. ') + DISCOUNT[s.get('discount') or 'uma_vez'] + ' ' + PREVIEW[(p['preview'] or {}).get('mode') or 'parcial'] + (f" Mimo grátis: {p['preview']['gift']}" if (p['preview'] or {}).get('gift') else ''))
    if s.get('script'): L.append('ROTEIRO DE VENDA:\n' + s['script'])
    if p.get('style'): L.append('OBSERVAÇÕES DA AGÊNCIA (siga à risca): ' + p['style'])
    flags = [LIMIT_FLAGS[f] for f in p.get('limit_flags') or [] if f in LIMIT_FLAGS]
    L.append('LIMITES (o que ela NÃO faz): ' + '; '.join(flags + ([p['limits']] if p.get('limits') else [])) if (flags or p.get('limits')) else 'LIMITES: não informado')
    if p['prices']:
        L.append('TABELA DE PREÇOS (mínimos): ' + '; '.join(f"{x['item']} [{PRICE_CATS.get(x['category'], 'Outro')}{', explícito' if x.get('explicit') else ''}]: {money_br(x['cents'])}" + (f" ({x['obs']})" if x.get('obs') else '') for x in p['prices']))
    else: L.append('TABELA DE PREÇOS: nenhuma cadastrada')
    if p.get('objections'): L.append('RESPOSTAS DELA A OBJEÇÕES (use como base): ' + ' | '.join(f"\"{o['q']}\" → {o['a']}" for o in p['objections']))
    if m['call']:
        c = p['call']; parts = []
        if c.get('days'): parts.append('dias: ' + ', '.join(c['days']))
        if c.get('hours'): parts.append('horário: ' + c['hours'])
        if c.get('notice_hours'): parts.append(f"aviso prévio de {c['notice_hours']} h")
        if c.get('confirm_first', True): parts.append('confirmar com ela ANTES de o fã pagar; nunca fechar horário sozinho')
        if c.get('notes'): parts.append(c['notes'])
        L.append('VIDEOCHAMADA: ' + '; '.join(parts))
    else: L.append('VIDEOCHAMADA: ela não faz; não ofereça.')
    if m['custom'] and p.get('custom_delivery'): L.append('PERSONALIZADOS: prazo de entrega ' + p['custom_delivery'] + '; nunca prometa entrega mais rápida.')
    if m['languages']:
        lg = p['languages']; names = {'pt': 'português', 'en': 'inglês', 'es': 'espanhol'}
        fp = {'brl': 'preços sempre em reais', 'usd_convert': 'para estrangeiro, dê o preço em dólar convertido do valor em reais', 'usd_fixed': 'para estrangeiro, use os valores em dólar das observações'}[lg.get('foreign_price') or 'brl']
        L.append('IDIOMAS: atende em ' + ', '.join(names[x] for x in lg.get('langs') or ['pt']) + '; responda no idioma do fã se for um desses; ' + fp + (f"; {lg['notes']}" if lg.get('notes') else ''))
    return '\n'.join(L)

def promo_block(prof, day=None):
    p = normalize(prof)
    if not p['modules']['promos']: return ''
    act = active_promos(p, day)
    return ('PROMOÇÕES VALENDO HOJE (pode usar): ' + ' | '.join(f"{x['title']}" + (f": {x['text']}" if x.get('text') else '') + (f" (até {x['ends'][8:10]}/{x['ends'][5:7]})" if x.get('ends') else '') for x in act)) if act else ''
