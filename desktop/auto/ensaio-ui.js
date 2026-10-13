// AUTO (Grok) — quadro de ensaio
module.exports = String.raw`(() => {
  if (window.__altaEnsaio) return;
  window.__altaEnsaio = true;
  window.__altaShowEnsaio = (text, reason) => {
    let box = document.getElementById('alta-ensaio');
    if (!box) {
      box = document.createElement('div');
      box.id = 'alta-ensaio';
      box.style.cssText = 'position:fixed;bottom:80px;right:20px;background:#1a1a2e;color:#fff;padding:12px;border-radius:8px;z-index:99999;max-width:320px;font-size:13px;';
      document.body.appendChild(box);
    }
    box.innerHTML = '<strong>ENSAIO — enviaria:</strong><br>' + (text || '(sem texto)') + '<br><small>' + (reason || '') + '</small>';
  };
})();
