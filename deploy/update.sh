#!/usr/bin/env bash
# Atualiza o Alta Pulse com a versão mais recente do GitHub (main).
set -euo pipefail
cd "$(dirname "$0")"
git -C .. pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
echo "Atualizado: $(git -C .. log -1 --format='%h %s')"
