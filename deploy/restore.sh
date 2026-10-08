#!/usr/bin/env bash
# Carrega um arquivo de dump (mongodump --archive --gzip) no banco deste servidor.
# Uso:  bash /opt/altapulse/deploy/restore.sh /root/altapulse-prod.archive.gz
set -euo pipefail
cd "$(dirname "$0")"
F="${1:?informe o arquivo, ex.: bash restore.sh /root/altapulse-prod.archive.gz}"
[ -f "$F" ] || { echo "Arquivo não encontrado: $F"; exit 1; }
echo "==> Backup de segurança do que já existe aqui"
./backup.sh || true
echo "==> Carregando $(basename "$F") ($(du -h "$F" | cut -f1))"
# qualquer que seja o nome do banco de origem, entra como 'altapulse'
docker compose exec -T mongo mongorestore --archive --gzip --drop \
  --nsInclude='*.*' --nsExclude='admin.*' --nsExclude='config.*' --nsExclude='local.*' \
  --nsFrom='$db$.$coll$' --nsTo='altapulse.$coll$' < "$F"
echo "==> Conferindo"
docker compose exec -T mongo mongosh altapulse --quiet --eval \
 'for (const c of ["users","creators","credentials","events","subscribers","fan_radar","secrets"]) print(c.padEnd(12), db[c].countDocuments())'
sed -i 's/^DB_NAME=.*/DB_NAME=altapulse/' .env
docker compose restart backend >/dev/null
echo; echo "Dados carregados. A API foi reiniciada."
