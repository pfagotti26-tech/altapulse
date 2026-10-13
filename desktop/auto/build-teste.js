const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const cfg = require('./teste.config.js');
const pkgPath = path.join(__dirname, '..', 'package.json');
const orig = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(orig);

// Backup and override
const backup = pkgPath + '.bak';
fs.writeFileSync(backup, orig);
pkg.productName = cfg.productName;
pkg.build = pkg.build || {};
pkg.build.appId = cfg.appId;
pkg.build.productName = cfg.productName;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// Write a runtime config marker
const marker = path.join(__dirname, '..', 'auto', 'is-teste.json');
fs.writeFileSync(marker, JSON.stringify({ origin: cfg.origin, userDataFolder: cfg.userDataFolder }));

try {
  console.log('Empacotando Alta Pulse Teste...');
  execSync('npx electron-builder --win nsis --x64 --publish never', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  console.log('Instalador gerado em desktop/dist/');
} finally {
  fs.writeFileSync(pkgPath, orig);
  fs.unlinkSync(backup);
  console.log('package.json restaurado');
}
