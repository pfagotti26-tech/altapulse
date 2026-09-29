const { allowedUrl } = require('./policy.cjs');
const { supportSummary } = require('./navigation.cjs');

function createExternalActions({ window, browser, config, shell, dialog, clipboard, electronVersion }) {
  let opening = false;
  const requireView = () => {
    if (!browser.lease || !browser.state.creator_id) throw new Error('Abra um perfil autorizado antes desta ação.');
  };
  return {
    async copySupport() {
      requireView();
      const text = supportSummary(config, browser.state, electronVersion);
      clipboard.writeText(text);
      return { ok: true };
    },
    async support() {
      requireView();
      const origin = new URL(config.privacy_support_url).origin;
      if (!allowedUrl(config.privacy_support_url, [origin])) throw new Error('Endereço de suporte não autorizado.');
      await shell.openExternal(config.privacy_support_url);
      return { ok: true };
    },
    async privacy() {
      requireView();
      if (opening) return { cancelled: true };
      if (browser.state.status !== 'blocked') throw new Error('Esta alternativa está disponível após uma recusa HTTP da página.');
      if (!allowedUrl(config.privacy_url, config.privacy_origins)) throw new Error('Endereço de entrada não autorizado.');
      opening = true;
      const lease = browser.lease;
      try {
        const result = await dialog.showMessageBox(window, {
          type: 'warning', title: 'Continuar fora do Alta Pulse?',
          message: 'A Privacy será aberta no navegador padrão do computador, em uma janela separada.',
          detail: 'Essa janela NÃO usa o perfil isolado desta criadora. Nenhuma sessão ou cookie será transferido e não haverá acompanhamento pelo Alta Pulse. Confira a conta correta antes de atender. Isso não corrige o bloqueio do navegador integrado.',
          buttons: ['Cancelar', 'Abrir navegador padrão'], defaultId: 0, cancelId: 0, noLink: true
        });
        if (result.response !== 1) return { cancelled: true };
        if (browser.lease?.id !== lease.id) throw new Error('O perfil mudou ou foi fechado. Abertura cancelada.');
        await browser.api('POST', `/desktop/leases/${lease.id}/heartbeat`);
        await browser.close();
        await shell.openExternal(config.privacy_url);
        browser.send({ status: 'external', creator_id: lease.creator_id, http_status: null, http_observed_at: null,
          message: 'Abertura solicitada no navegador padrão. A conta e a sessão externas não são verificadas pelo Alta Pulse.' });
        return { ok: true, external: true };
      } finally { opening = false; }
    }
  };
}

module.exports = { createExternalActions };