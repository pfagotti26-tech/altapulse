// Ponto de entrada do app. A versão sem instalador se atualiza baixando o app inteiro num arquivo NOVO
// (resources/app-<versão>.asar) e apontando para ele em resources/alta-atual.json. Assim nenhum arquivo
// em uso precisa ser trocado (no Windows o app.asar fica travado enquanto o app roda).
'use strict';
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
let external = null;
try {
  if (app.isPackaged) {
    const ptr = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'alta-atual.json'), 'utf8'));
    const dir = path.join(process.resourcesPath, path.basename(ptr.file || ''));
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    // só usa a versão baixada se ela for mais nova que a que veio no pacote (um pacote completo novo vence)
    if (newer(pkg.version, app.getVersion()) && fs.existsSync(path.join(dir, 'main.js'))) external = { dir, version: pkg.version };
  }
} catch { /* sem atualização baixada */ }
if (external) {
  const bundled = app.getVersion();
  app.getVersion = () => external.version;
  global.altaLoader = { dir: external.dir, bundled };
  require(path.join(external.dir, 'main.js'));
} else {
  global.altaLoader = { dir: __dirname, bundled: app.getVersion() };
  require('./main.js');
}
