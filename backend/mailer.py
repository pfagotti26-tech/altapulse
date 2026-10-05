"""E-mails transacionais do painel (Resend).

Configuração (variáveis de ambiente):
  RESEND_API_KEY  chave da conta Resend (sem ela nenhum e-mail sai; o painel avisa "fale com seu gestor")
  MAIL_FROM       remetente, ex.: "Alta Pulse <nao-responda@altapulse.com.br>" (o domínio precisa estar verificado no Resend)
"""
import os, html, logging
import httpx
from core import ORIGIN, settings

log = logging.getLogger('alta.mail')
API_KEY = os.environ.get('RESEND_API_KEY', '').strip()
MAIL_FROM = os.environ.get('MAIL_FROM', 'Alta Pulse <nao-responda@altapulse.com.br>').strip()
def configured(): return bool(API_KEY)

async def send(to, subject, html_body):
    """Envia e devolve True/False. Nunca levanta exceção: quem chama decide o que fazer sem e-mail."""
    if not configured(): return False
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.post('https://api.resend.com/emails', headers={'Authorization': f'Bearer {API_KEY}'},
                json={'from': MAIL_FROM, 'to': [to], 'subject': subject, 'html': html_body})
        if r.status_code >= 300:
            log.warning('Resend respondeu %s: %s', r.status_code, r.text[:300]); return False
        return True
    except Exception as e:
        log.warning('Falha ao enviar e-mail: %s', e); return False

def layout(agency, title, intro, button_text, link, footer):
    """Molde único dos e-mails: cabeçalho escuro com a marca, texto curto, um botão e o link em texto para copiar."""
    e = html.escape
    return f"""<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f3f3f5;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1c22">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f5;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border-radius:14px;overflow:hidden">
<tr><td style="background:#121216;padding:22px 28px;color:#fff;font-size:20px;font-weight:700;letter-spacing:.2px">alta<span style="font-weight:300">pulse</span><span style="float:right;font-size:11px;font-weight:500;opacity:.7;margin-top:6px">{e(agency)}</span></td></tr>
<tr><td style="padding:28px 28px 8px"><h1 style="margin:0 0 12px;font-size:21px;line-height:1.3">{e(title)}</h1><p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#3a3a44">{intro}</p>
<a href="{e(link)}" style="display:inline-block;background:#c8102e;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 22px;border-radius:9px">{e(button_text)}</a>
<p style="margin:22px 0 0;font-size:12.5px;line-height:1.5;color:#7a7a86">Se o botão não abrir, copie este endereço no navegador:<br><a href="{e(link)}" style="color:#c8102e;word-break:break-all">{e(link)}</a></p></td></tr>
<tr><td style="padding:18px 28px 26px;font-size:12.5px;line-height:1.5;color:#7a7a86;border-top:1px solid #ececf0;margin-top:16px">{footer}</td></tr>
</table><p style="margin:16px 0 0;font-size:11px;color:#9a9aa6">Alta Pulse · mensagem automática, não responda.</p></td></tr></table></body></html>"""

async def send_reset(user, link):
    agency = (await settings()).get('agency_name', 'Alta Pulse')
    first = html.escape((user.get('name') or '').split(' ')[0] or 'Olá')
    body = layout(agency, 'Redefinir sua senha', f'{first}, recebemos um pedido para redefinir a senha do seu acesso ao Alta Pulse. O link vale por <b>30 minutos</b> e só pode ser usado uma vez.',
        'Criar nova senha', link, 'Se você não pediu isso, pode ignorar este e-mail: sua senha continua a mesma e ninguém consegue entrar sem este link.')
    return await send(user['email'], 'Redefinir senha · Alta Pulse', body)

async def send_invite(user, link, inviter=None):
    agency = (await settings()).get('agency_name', 'Alta Pulse')
    first = html.escape((user.get('name') or '').split(' ')[0] or 'Olá')
    who = f' por <b>{html.escape(inviter)}</b>' if inviter else ''
    body = layout(agency, f'Bem-vindo(a) ao Alta Pulse', f'{first}, seu acesso foi criado{who}. Clique abaixo para definir a sua senha pessoal — o link vale por <b>48 horas</b>. Depois é só entrar com este e-mail ({html.escape(user["email"])}).',
        'Definir minha senha', link, 'Seu acesso é individual: não compartilhe a senha. Se o link expirar, peça ao seu gestor para reenviar o convite ou use "Esqueci minha senha" na tela de entrada.')
    return await send(user['email'], f'Seu acesso ao Alta Pulse · {agency}', body)
