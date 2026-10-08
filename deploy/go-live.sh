#!/usr/bin/env bash
# Virada: depois de apontar o DNS de altapulse.com.br para este servidor, passa a atender o domínio oficial.
set -euo pipefail
cd "$(dirname "$0")"
IP="$(curl -4fsS https://api.ipify.org)"
got="$(getent ahostsv4 altapulse.com.br | awk 'NR==1{print $1}')"
[ "$got" = "$IP" ] || { echo "altapulse.com.br ainda aponta para '$got' (esperado $IP). Espere o DNS propagar e rode de novo."; exit 1; }
HOSTS="altapulse.com.br"
[ "$(getent ahostsv4 www.altapulse.com.br | awk 'NR==1{print $1}')" = "$IP" ] && HOSTS="$HOSTS, www.altapulse.com.br"
TEST_HOST="$(grep '^SITE_HOSTS=' .env | cut -d= -f2 | tr ',' '\n' | grep sslip | head -1 | tr -d ' ')"
sed -i "s|^SITE_HOSTS=.*|SITE_HOSTS=${HOSTS}${TEST_HOST:+, $TEST_HOST}|" .env
docker compose up -d
echo "No ar em https://altapulse.com.br (o certificado sai em até 1 minuto)."
