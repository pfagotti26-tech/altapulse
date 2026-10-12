// Observador leve de envio de mídia na Privacy (modo sombra).
module.exports = String.raw`(() => {
  if (window.__altaMediaObs) return;
  window.__altaMediaObs = true;

  const report = (payload) => {
    try {
      if (window.pulse && typeof window.pulse.assistMediaSent === 'function') {
        window.pulse.assistMediaSent(payload);
      }
    } catch (e) {}
  };

  const obs = new MutationObserver(() => {
    const modals = document.querySelectorAll('div, section');
    for (const modal of modals) {
      if (!/ALTERAR PRE[ÇC]O|Adicionar pre[çc]o/i.test(modal.textContent || '')) continue;
      const confirmBtn = [...modal.querySelectorAll('button')].find(b => /confirmar|ok|adicionar/i.test(b.textContent || ''));
      if (confirmBtn && !confirmBtn.__altaBound) {
        confirmBtn.__altaBound = true;
        confirmBtn.addEventListener('click', () => {
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
