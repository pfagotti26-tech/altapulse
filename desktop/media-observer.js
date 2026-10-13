// Observador de envio de mídia na Privacy (modo sombra).
module.exports = String.raw`(() => {
  if (window.__altaMediaObs) return;
  window.__altaMediaObs = true;
  const report = (p) => {
    try { if (window.pulse && window.pulse.assistMediaSent) window.pulse.assistMediaSent(p); } catch {}
  };
  const obs = new MutationObserver(() => {
    const modals = document.querySelectorAll('div, section');
    for (const modal of modals) {
      if (!/ALTERAR PRE[ÇC]O|Adicionar pre[çc]o/i.test(modal.textContent || '')) continue;
      const btn = [...modal.querySelectorAll('button')].find(b => /confirmar|ok|adicionar/i.test(b.textContent || ''));
      if (btn && !btn.__altaBound) {
        btn.__altaBound = true;
        btn.addEventListener('click', () => {
          let cents = 0;
          const input = modal.querySelector('input');
          if (input && input.value) {
            const n = parseFloat(String(input.value).replace(/\./g, '').replace(',', '.'));
            if (!isNaN(n)) cents = Math.round(n * 100);
          }
          report({
            creator_id: window.__altaCreatorId || null,
            media_type: 'foto',
            source: 'acervo',
            price_cents: cents,
            description: 'modal de preço confirmado'
          });
        }, { once: true });
      }
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
