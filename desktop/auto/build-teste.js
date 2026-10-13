const { build, Platform, Arch } = require('electron-builder');
const path = require('path');
const fs = require('fs');
const cfg = require('./teste.config.js');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const base = pkg.build || {};

const config = {
  ...base,
  appId: cfg.appId,
  productName: cfg.productName,
  nsis: {
    ...(base.nsis || {}),
    shortcutName: cfg.productName,
    uninstallDisplayName: cfg.productName,
  },
  win: {
    ...(base.win || {}),
    artifactName: 'AltaPulse-Teste-Setup-${version}.exe',
  },
  extraMetadata: {
    altaTeste: {
      origin: cfg.origin,
      userDataFolder: cfg.userDataFolder,
    },
  },
};

console.log('Empacotando Alta Pulse Teste...');
build({
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  config,
  publish: 'never',
}).then(() => {
  console.log('Instalador gerado em desktop/dist/');
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
