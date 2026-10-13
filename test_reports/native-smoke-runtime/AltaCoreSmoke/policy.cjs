const crypto = require('node:crypto');

function allowedUrl(value, origins) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && origins.includes(url.origin);
  } catch { return false; }
}
function profilePartition(machineId, creatorId) {
  if (!/^[a-f0-9-]{36}$/.test(machineId) || !/^[a-f0-9]{24}$/.test(creatorId)) throw new Error('Perfil inválido.');
  return `persist:alta-creator-${crypto.createHash('sha256').update(machineId + ':' + creatorId).digest('hex')}`;
}
function boundsFor(rect, width, height) {
  if (!rect || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k]))) return null;
  const x = Math.max(180, Math.round(rect.x)), y = Math.max(80, Math.round(rect.y));
  const w = Math.min(Math.round(rect.width), width - x), h = Math.min(Math.round(rect.height), height - y);
  return w >= 150 && h >= 120 ? { x, y, width: w, height: h } : null;
}
module.exports = { allowedUrl, profilePartition, boundsFor };