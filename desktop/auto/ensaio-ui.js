// AUTO (Grok) — quadro de ensaio
module.exports = String.raw`(() => {
  if (window.__altaEnsaio) return;
  window.__altaEnsaio = true;
  window.__altaShowEnsaio = (text, reason, product) => {
    let box = document.getElementById('alta-ensaio');
    if (!box) {
      box = document.createElement('div');
      box.id = 'alta-ensaio';
      box.style.cssText = 'position:fixed;bottom:80px;right:20px;background:#1a1a2e;color:#fff;padding:12px;border-radius:8px;z-index:99999;max-width:320px;font-size:13px;';
      document.body.appendChild(box);
    }
    const esc = (s) => String(s || '').replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
    let extra = '';
    if (product && product.item) {
      const cents = product.cents || 0;
      extra = '<br>📩 solicitaria ' + esc(product.item) + ' R$ ' + (cents/100).toFixed(2) + ' · legenda: ' + esc(product.caption || '-') + ' · depois: ' + esc(product.after || '-');
    }
    box.innerHTML = '<strong>ENSAIO — enviaria:</strong><br>' + esc(text || '(sem texto)') + extra + '<br><small>' + esc(reason || '') + '</small>';
  };
})();
`;
