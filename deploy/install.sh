#!/usr/bin/env bash
# Instala o Alta Pulse neste servidor (Ubuntu 24.04). Pode rodar de novo sem problema.
# Uso:  bash /opt/altapulse/deploy/install.sh
set -euo pipefail
cd "$(dirname "$0")"
[ "$(id -u)" = 0 ] || { echo "Rode como root."; exit 1; }

echo "==> 1/5 Instalando Docker e firewall"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 ufw cron git >/dev/null
systemctl enable --now docker cron >/dev/null

echo "==> 2/5 Firewall: só SSH (22) e site (80/443) abertos"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

echo "==> 3/5 Configuração (.env)"
IP="$(curl -4fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
TEST_HOST="$(echo "$IP" | tr . -).sslip.io"
if [ ! -f .env ]; then
  read -rp "E-mail do dono da conta [pfagotti26@gmail.com]: " OWNER; OWNER="${OWNER:-pfagotti26@gmail.com}"
  read -rsp "Chave do Resend (e-mail de 'esqueci a senha') — cole e Enter, ou só Enter para pular: " RESEND; echo
  umask 077
  cat > .env <<ENV
# --- Alta Pulse: configuração do servidor (NÃO enviar para o GitHub) ---
DB_NAME=altapulse
APP_ORIGIN=https://altapulse.com.br
INGRESS_APP_ORIGIN=https://${TEST_HOST}
# endereços atendidos pelo site (HTTPS automático). Na virada do DNS: bash deploy/go-live.sh
SITE_HOSTS=${TEST_HOST}
ACME_EMAIL=${OWNER}
OWNER_EMAIL=${OWNER}
RESEND_API_KEY=${RESEND}
MAIL_FROM=Alta Pulse <nao-responda@altapulse.com.br>
PRIVACY_URL=https://privacy.com.br/
WORKSPACE_ID=alta
# VAULT_KEY fica vazio de propósito: a chave do cofre viaja dentro do banco (coleção secrets)
ENV
  echo "    .env criado."
else
  echo "    .env já existe — mantido."
fi
mkdir -p backups

echo "==> 4/5 Subindo banco, API e site (a primeira vez leva uns 5–10 minutos)"
docker compose up -d --build

echo "==> 5/5 Backup automático diário (03:30, guarda 14 dias)"
chmod +x backup.sh migrate.sh update.sh go-live.sh
echo "30 3 * * * root $(pwd)/backup.sh >> /var/log/altapulse-backup.log 2>&1" > /etc/cron.d/altapulse-backup

echo; echo "Aguardando a API responder..."
for i in $(seq 1 60); do
  if docker compose exec -T backend python -c "import urllib.request;urllib.request.urlopen('http://localhost:8001/api/health')" 2>/dev/null; then OK=1; break; fi
  sleep 5
done
echo
if [ "${OK:-}" = 1 ]; then
  echo "PRONTO. Endereço de teste: https://${TEST_HOST}"
  echo "(o certificado HTTPS pode levar 1 minuto na primeira vez)"
else
  echo "A API não respondeu ainda. Veja: docker compose -f $(pwd)/docker-compose.yml logs backend --tail 50"
fi
