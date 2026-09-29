import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import dotenv from 'dotenv';

const root = path.dirname(fileURLToPath(import.meta.url));
const env = dotenv.parse(fs.readFileSync(path.join(root, '../backend/.env')));
const frontend = dotenv.parse(fs.readFileSync(path.join(root, '../frontend/.env')));
const stage = path.join(root, 'staging'), release = path.join(root, 'release');
fs.mkdirSync(stage, { recursive: true }); fs.mkdirSync(release, { recursive: true });
const version = env.ALTA_DESKTOP_VERSION;
if (!version || !frontend.REACT_APP_BACKEND_URL || !env.PRIVACY_URL) throw new Error('Configuração de release incompleta.');
const electronVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'))).version;
for (const file of ['main.cjs', 'preload.cjs', 'browser.cjs', 'policy.cjs', 'LEIA-ME.md']) fs.copyFileSync(path.join(root, file), path.join(stage, file));
fs.mkdirSync(path.join(stage, 'brand'), { recursive: true });
fs.copyFileSync(path.join(root, '../frontend/public/brand/favicon.png'), path.join(stage, 'brand/favicon.png'));
// Metadata gerada somente no estágio de empacotamento; não altera o package.json do projeto.
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'alta-core-desktop', productName: 'Alta Core', version, main: 'main.cjs', author: 'Alta Agency', license: 'UNLICENSED', description: 'Alta Core — navegador de perfis locais autorizados' }, null, 2));
fs.writeFileSync(path.join(stage, 'config.json'), JSON.stringify({ version, app_url: frontend.REACT_APP_BACKEND_URL,
  privacy_url: env.PRIVACY_URL, privacy_origins: [new URL(env.PRIVACY_URL).origin] }, null, 2));
await packager({ dir: stage, name: 'AltaCore', platform: 'win32', arch: 'x64', electronVersion,
  out: path.join(root, 'dist'), overwrite: true, asar: true, prune: false,
  executableName: 'AltaCore', appVersion: version, buildVersion: version,
  win32metadata: { CompanyName: 'Alta Agency', FileDescription: 'Alta Core', ProductName: 'Alta Core', OriginalFilename: 'AltaCore.exe' },
  icon: path.join(root, '../frontend/public/favicon.ico') });
execFileSync('makensis', ['-V2', `-DVERSION=${version}`, path.join(root, 'installer.nsi')], { cwd: root, stdio: 'inherit' });
const filename = `Alta-Core-${version}-Setup-x64.exe`;
const file = path.join(root, 'dist', filename);
const bytes = fs.readFileSync(file);
if (bytes.subarray(0, 2).toString() !== 'MZ') throw new Error('Instalador PE inválido.');
const manifest = { version, filename, size_bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  built_at: new Date().toISOString(), platform: 'Windows 10/11 x64', electron_version: electronVersion };
fs.renameSync(file, path.join(release, filename));
fs.writeFileSync(path.join(release, 'manifest.json.tmp'), JSON.stringify(manifest, null, 2));
fs.renameSync(path.join(release, 'manifest.json.tmp'), path.join(release, 'manifest.json'));
fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), `${manifest.sha256}  ${filename}\n`);
fs.rmSync(path.join(release, 'blocked.flag'), { force: true });
console.log('Instalador compilado:', JSON.stringify(manifest));