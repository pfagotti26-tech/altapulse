#!/usr/bin/env bash
# Copia o banco de produção atual (Emergent) para o banco deste servidor — direto, sem passar por mais ninguém.
# Uso:  bash /opt/altapulse/deploy/migrate.sh   (vai pedir o endereço do banco atual; ele não fica salvo)
# Pode repetir: cada vez substitui os dados daqui pela cópia mais recente.
set -euo pipefail
cd "$(dirname "$0")"
SRC=""
while [ -z "$SRC" ]; do
  read -rsp "Cole a 'URL do Mongo' do Emergent (Banco de dados > Detalhes) e Enter: " RAW; echo
  # pega só a primeira URL colada e sem as opções depois do "?" (evita colagem dupla e opções repetidas)
  SRC="$(printf '%s' "$RAW" | grep -oE 'mongodb(\+srv)?://[^?[:space:]]+' | head -1 || true)"
  unset RAW
  [ -n "$SRC" ] || echo "Não reconheci uma URL do Mongo. Tente de novo (botão direito uma vez, depois Enter)."
done
echo "    URL recebida: servidor $(printf '%s' "$SRC" | sed -E 's#^.*@([^/]+).*#\1#')"

echo "==> Procurando o banco do app na origem"
SRCDB="$(docker compose exec -T mongo mongosh "$SRC" --quiet --eval \
 'db.adminCommand({listDatabases:1,nameOnly:true,authorizedDatabases:true}).databases.map(d=>d.name).filter(n=>!["admin","local","config"].includes(n)).join(" ")' | tr -d '\r')"
set -- $SRCDB
if [ $# -ne 1 ]; then
  echo "Encontrei estes bancos: $SRCDB"
  read -rp "Qual é o do app? " SRCDB
else SRCDB="$1"; fi
echo "    banco de origem: $SRCDB"

echo "==> Backup de segurança do que já existe aqui"
./backup.sh || true

echo "==> Copiando (pode levar alguns minutos)"
docker compose exec -T mongo sh -c "mongodump --uri=\"\$0\" --db=\"\$1\" --archive --gzip" "$SRC" "$SRCDB" \
 | docker compose exec -T mongo mongorestore --archive --gzip --drop --nsFrom="${SRCDB}.*" --nsTo="altapulse.*"
unset SRC

echo "==> Conferindo"
docker compose exec -T mongo mongosh altapulse --quiet --eval \
 'for (const c of ["users","creators","credentials","events","fan_radar","secrets"]) print(c.padEnd(12), db[c].countDocuments())'
sed -i 's/^DB_NAME=.*/DB_NAME=altapulse/' .env
docker compose restart backend >/dev/null
echo; echo "Cópia concluída. A API foi reiniciada com os dados novos."
