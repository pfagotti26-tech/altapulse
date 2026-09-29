import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import dotenv from 'dotenv';

const root = path.dirname(fileURLToPath(import.meta.url)), desktop = path.dirname(root);
const env = dotenv.parse(fs.readFileSync(path.join(desktop, '../backend/.env')));
const frontend = dotenv.parse(fs.readFileSync(path.join(desktop, '../frontend/.env')));
const version = env.ALTA_CHROME_PILOT_VERSION, loginUrl = env.PRIVACY_LOGIN_URL;
if (!version || !loginUrl || !frontend.REACT_APP_BACKEND_URL) throw new Error('Configuração do piloto incompleta.');
if (!/^https:\/\//.test(loginUrl)) throw new Error('O endereço de entrada precisa usar HTTPS.');
const stage = path.join(root, 'staging'), release = path.join(root, 'release'), native = path.join(root, 'native');
fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true }); fs.mkdirSync(release, { recursive: true });
fs.writeFileSync(path.join(native, 'pilot_config.h'), `#pragma once\n#define PILOT_LOGIN_URL L${JSON.stringify(loginUrl)}\n`);
execFileSync('x86_64-w64-mingw32-windres', ['helper.rc', '-O', 'coff', '-o', 'helper-resource.o'], { cwd: native, stdio: 'inherit' });
execFileSync('x86_64-w64-mingw32-g++-posix', ['-std=c++17', '-O2', '-municode', '-D_WIN32_WINNT=0x0A00',
  '-static', '-static-libgcc', '-static-libstdc++', 'chrome_host.cpp', 'helper-resource.o', '-o', 'chrome-host.exe',
  '-lwintrust', '-lcrypt32', '-lshell32', '-lole32', '-luser32', '-lgdi32', '-luuid'
], { cwd: native, stdio: 'inherit' });
for (const file of ['main.cjs', 'preload.cjs', 'chrome-browser.cjs', 'host-protocol.cjs', 'LEIA-ME.md']) fs.copyFileSync(path.join(root, file), path.join(stage, file));
fs.copyFileSync(path.join(desktop, 'policy.cjs'), path.join(stage, 'policy.cjs'));
fs.mkdirSync(path.join(stage, 'brand'), { recursive: true });
fs.copyFileSync(path.join(desktop, '../frontend/public/brand/favicon.png'), path.join(stage, 'brand/favicon.png'));
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'alta-pulse-chrome-pilot', productName: 'Alta Pulse Chrome Pilot',
  version, main: 'main.cjs', author: 'Alta Agency', license: 'UNLICENSED', description: 'Piloto experimental de janela Chrome real integrada' }, null, 2));
fs.writeFileSync(path.join(stage, 'config.json'), JSON.stringify({ version, app_url: frontend.REACT_APP_BACKEND_URL, engine: 'chrome-pilot', experimental: true }, null, 2));
const electronVersion = JSON.parse(fs.readFileSync(path.join(desktop, 'node_modules/electron/package.json'))).version;
await packager({ dir: stage, name: 'AltaPulseChromePilot', platform: 'win32', arch: 'x64', electronVersion,
  out: path.join(root, 'dist'), overwrite: true, asar: true, prune: false, executableName: 'AltaPulseChromePilot',
  appVersion: version, buildVersion: version, icon: path.join(desktop, '../frontend/public/favicon.ico'),
  win32metadata: { CompanyName: 'Alta Agency', FileDescription: 'Alta Pulse - Piloto Chrome', ProductName: 'Alta Pulse Chrome Pilot', OriginalFilename: 'AltaPulseChromePilot.exe' } });
const bundle = path.join(root, 'dist/AltaPulseChromePilot-win32-x64');
fs.copyFileSync(path.join(native, 'chrome-host.exe'), path.join(bundle, 'resources/chrome-host.exe'));
const files = [], folders = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) { folders.push(full); collect(full); }
    else files.push(full);
  }
}
collect(bundle);
const nsisPath = file => path.relative(bundle, file).split(path.sep).join('\\').replaceAll('$', '$$');
fs.writeFileSync(path.join(root, 'uninstall-files.nsh'), [
  ...files.map(file => `Delete "$INSTDIR\\${nsisPath(file)}"`),
  ...folders.sort((a, b) => b.length - a.length).map(folder => `RMDir "$INSTDIR\\${nsisPath(folder)}"`)
].join('\n') + '\n');
execFileSync('makensis', ['-V2', `-DVERSION=${version}`, path.join(root, 'installer.nsi')], { cwd: root, stdio: 'inherit' });
const filename = `Alta-Pulse-Chrome-Pilot-${version}-Setup-x64.exe`, file = path.join(root, 'dist', filename);
const bytes = fs.readFileSync(file);
if (bytes.subarray(0, 2).toString() !== 'MZ') throw new Error('Instalador inválido.');
const manifest = { version, product_name: 'Alta Pulse Chrome Pilot', filename, size_bytes: bytes.length,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'), built_at: new Date().toISOString(),
  platform: 'Windows 11 x64', electron_version: electronVersion, engine: 'installed_google_chrome', experimental: true,
  signed: false, windows_validated: false, privacy_validated: false, session_sync: false, requires_chrome: true };
fs.renameSync(file, path.join(release, filename));
fs.writeFileSync(path.join(release, 'manifest.json.tmp'), JSON.stringify(manifest, null, 2));
fs.renameSync(path.join(release, 'manifest.json.tmp'), path.join(release, 'manifest.json'));
fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), `${manifest.sha256}  ${filename}\n`);
console.log('PILOTO COMPILADO', JSON.stringify(manifest));