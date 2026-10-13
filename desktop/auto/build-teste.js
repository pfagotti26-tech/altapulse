const { execSync } = require('child_process');
const path = require('path');
const cfg = require('./teste.config.js');

const extra = JSON.stringify({
  origin: cfg.origin,
  userDataFolder: cfg.userDataFolder,
});

const cmd = [
  'npx electron-builder --win nsis --x64 --publish never',
  `--config.extraMetadata.altaTeste='${extra}'`,
  `--config.appId=${cfg.appId}`,
  `--config.productName="${cfg.productName}"`,
  `--config.nsis.shortcutName="${cfg.productName}"`,
  `--config.nsis.uninstallDisplayName="${cfg.productName}"`,
  `--config.win.artifactName="AltaPulse-Teste-Setup-\\${version}.exe"`,
].join(' ');

console.log('Empacotando Alta Pulse Teste...');
execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
console.log('Instalador gerado em desktop/dist/');
