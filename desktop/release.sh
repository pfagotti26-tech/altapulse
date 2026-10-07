#!/usr/bin/env bash
# Empacota o app desktop (Windows) e publica em backend/desktop_dist, de onde o painel serve a atualização.
# Uso (Node 18+ e 7-Zip):  bash desktop/release.sh 1.4.20
# Roda no Git Bash do windows-latest (onde o NSIS não precisa de Wine) e também em Linux x86-64 com Wine.
set -euo pipefail
V="${1:?informe a versão, ex.: 1.4.20}"
case "$V" in *[!0-9.]*|'') echo "versão inválida: $V" >&2; exit 1;; esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; D="$ROOT/desktop"; DIST="$ROOT/backend/desktop_dist"
cd "$D"
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version=process.argv[1];fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')" "$V"
[ -d node_modules/electron ] || npm install --no-audit --no-fund
rm -rf dist
npx electron-builder --win nsis --x64 --publish never
[ -f "dist/AltaPulse-Setup-$V.exe" ] || { echo "instalador não foi gerado" >&2; exit 1; }
mkdir -p "$DIST"; cd "$DIST"
for f in AltaPulse-* app-*.asar app-*.json latest.yml; do [ -e "$f" ] && { git -C "$ROOT" rm -q --cached "backend/desktop_dist/$f" 2>/dev/null || true; rm -f "$f"; }; done
cp "$D/dist/latest.yml" "$D/dist/AltaPulse-Setup-$V.exe.blockmap" .
split -b 60m -d -a 2 "$D/dist/AltaPulse-Setup-$V.exe" "AltaPulse-Setup-$V.exe.part"
cp "$D/dist/win-unpacked/resources/app.asar" "app-$V.asar"
ELECTRON="$(node -p "require('$D/node_modules/electron/package.json').version")"
SHA="$(node -e "const c=require('crypto'),fs=require('fs');process.stdout.write(c.createHash('sha512').update(fs.readFileSync(process.argv[1])).digest('base64'))" "app-$V.asar")"
printf '{"sha512": "%s", "electron": "%s"}\n' "$SHA" "$ELECTRON" > "app-$V.json"
( cd "$D/dist/win-unpacked" && rm -f "/tmp/AltaPulse-$V-sem-instalador.zip" && \
  if command -v 7z >/dev/null 2>&1; then 7z a -tzip -bso0 -bsp0 "/tmp/AltaPulse-$V-sem-instalador.zip" . ; \
  else zip -qr -X "/tmp/AltaPulse-$V-sem-instalador.zip" . ; fi )
split -b 60m -d -a 2 "/tmp/AltaPulse-$V-sem-instalador.zip" "AltaPulse-$V-sem-instalador.zip.part"; rm -f "/tmp/AltaPulse-$V-sem-instalador.zip"
git -C "$ROOT" add -A backend/desktop_dist desktop/package.json
echo; echo "Publicado em backend/desktop_dist:"; ls -la "$DIST"
