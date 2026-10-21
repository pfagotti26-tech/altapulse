"""Lote 161: meio de pagamento do WhatsApp de vendas, plugável.

Hoje: "manual" — a IA manda o texto de Pix da agência (configurado na criadora) e o chatter confere e marca pago.
Depois: "asaas" ou "mercadopago" com split agência/criadora (creator_pct no pedido) e aviso automático de pago,
que chama whatsapp.mark_paid(order_id). Enquanto não estiver integrado, cai no manual.
"""
import logging
log = logging.getLogger('payments')

async def create_charge(cfg, contact, order):
    provider = (cfg.get('pay') or {}).get('provider') or 'manual'
    if provider != 'manual':
        log.info('pagamento %s ainda não integrado: usando manual', provider)
    text = ((cfg.get('pay') or {}).get('pix_text') or '').strip() or 'já já te mando a chave Pix por aqui'
    return {'provider': 'manual', 'text': text, 'link': None}
