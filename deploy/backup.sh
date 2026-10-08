#!/usr/bin/env bash
# Backup do banco em deploy/backups (um arquivo por dia, guarda 14). Roda sozinho todo dia às 03:30.
set -euo pipefail
cd "$(dirname "$0")"
F="altapulse-$(date +%F-%H%M).archive.gz"
docker compose exec -T mongo mongodump --db=altapulse --archive="/backups/$F" --gzip --quiet
find backups -name 'altapulse-*.archive.gz' -mtime +14 -delete
echo "$(date -Is) backup ok: $F ($(du -h "backups/$F" | cut -f1))"
