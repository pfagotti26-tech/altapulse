#!/usr/bin/env bash
# Carrega o .zip de exportação do Emergent (um .json por coleção) no banco deste servidor.
# Uso:  bash /opt/altapulse/deploy/import-json.sh /root/ARQUIVO.zip
set -euo pipefail
cd "$(dirname "$0")"
Z="${1:?informe o arquivo .zip}"
[ -f "$Z" ] || { echo "Arquivo não encontrado: $Z"; exit 1; }
command -v unzip >/dev/null || apt-get install -y -qq unzip >/dev/null
D="backups/import-$(date +%s)"; mkdir -p "$D"
unzip -q -j "$Z" '*.json' -d "$D"
N=$(ls "$D"/*.json | wc -l)
echo "==> $N coleções no arquivo"
for must in users creators credentials secrets; do
  [ -s "$D/$must.json" ] || { echo "FALTA $must.json no arquivo — não vou carregar (sem ele o painel não funciona)."; rm -rf "$D"; exit 1; }
done
if grep -q '"\$date"' "$D"/*.json 2>/dev/null; then echo "    datas no formato do Mongo: sim"; else echo "    datas no formato do Mongo: não (corrijo depois)"; fi

echo "==> Backup de segurança do que já existe aqui"
./backup.sh || true

echo "==> Carregando"
# coleções grandes vêm em partes: limpa a coleção base antes, para não misturar com dados antigos
for b in $(ls "$D" | sed -nE 's/^(.+)_part[0-9]+\.json$/\1/p' | sort -u); do
  docker compose exec -T mongo mongosh altapulse --quiet --eval "db.getCollection('$b').deleteMany({})" >/dev/null
done
for f in "$D"/*.json; do
  c="$(basename "$f" .json)"
  arr=""; [ "$(head -c 1 "$f" | tr -d '[:space:]')" = "[" ] && arr="--jsonArray"
  docker compose exec -T mongo mongoimport --quiet --db altapulse --collection "$c" --drop $arr --file "/backups/$(basename "$D")/$(basename "$f")" \
    || { echo "ERRO ao carregar $c"; exit 1; }
done

echo "==> Juntando coleções que vieram divididas (_part1, _part2...)"
docker compose exec -T mongo mongosh altapulse --quiet --eval '
for (const c of db.getCollectionNames().filter(n => /_part\d+$/.test(n)).sort()) {
  const base = c.replace(/_part\d+$/, "");
  db[c].aggregate([{$merge: {into: base, on: "_id", whenMatched: "keepExisting", whenNotMatched: "insert"}}]);
  print("   ", c, "->", base); db[c].drop();
}'

echo "==> Ajustando validades (expires_at) para o formato de data"
docker compose exec -T mongo mongosh altapulse --quiet --eval '
for (const c of db.getCollectionNames()) {
  const r = db[c].updateMany({expires_at: {$type: "string"}}, [{$set: {expires_at: {$toDate: "$expires_at"}}}]);
  if (r.modifiedCount) print("   ", c, r.modifiedCount);
}'

echo "==> Conferindo"
docker compose exec -T mongo mongosh altapulse --quiet --eval \
 'for (const c of ["users","creators","credentials","secrets","events","subscribers","fan_radar","audit"]) print(c.padEnd(12), db[c].countDocuments())'
rm -rf "$D"
rm -f "$Z"
sed -i 's/^DB_NAME=.*/DB_NAME=altapulse/' .env
docker compose restart backend >/dev/null
echo; echo "Dados carregados. A API foi reiniciada. O .zip foi apagado do servidor."
