// Define ícone e informações de versão do executável sem precisar de wine (resedit em JS puro).
const fs = require('fs'); const path = require('path');
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const resedit = await import('resedit');
  const exe = path.join(context.appOutDir, 'Alta Pulse.exe');
  const data = fs.readFileSync(exe);
  const pe = resedit.NtExecutable.from(data);
  const res = resedit.NtExecutableResource.from(pe);
  const ico = resedit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  resedit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, ico.icons.map((i) => i.data));
  const vi = resedit.Resource.VersionInfo.createEmpty();
  vi.setFileVersion(1, 1, 0, 0, 1033); vi.setProductVersion(1, 1, 0, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: 'Alta Pulse', ProductName: 'Alta Pulse', CompanyName: 'Alta Agency', LegalCopyright: 'Copyright © 2026 Alta Agency', OriginalFilename: 'Alta Pulse.exe', InternalName: 'Alta Pulse', FileVersion: '1.1.0', ProductVersion: '1.1.0' });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
  console.log('  • ícone e versão gravados em', exe);
};
