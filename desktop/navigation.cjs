// Apenas eventos de navegação da janela principal: sem interceptação de tráfego ou leitura de DOM.
const { allowedUrl } = require('./policy.cjs');

function classifyHttpStatus(code) {
  if (code === 403) return { status: 'blocked', http_status: 403, message: 'A Privacy recusou o acesso deste navegador integrado (HTTP 403). Não haverá nova tentativa automática.' };
  if (code === 429) return { status: 'blocked', http_status: 429, message: 'A Privacy limitou as solicitações (HTTP 429). Não haverá nova tentativa automática.' };
  if (Number.isInteger(code) && code >= 400) return { status: 'http_error', http_status: code, message: `A página respondeu com erro HTTP ${code}. Isso não confirma acesso à conta.` };
  if (Number.isInteger(code) && code >= 200 && code < 400) return { status: 'open', http_status: code, message: '' };
  return { status: 'unconfirmed', http_status: null, message: 'O navegador não confirmou o resultado HTTP desta navegação.' };
}

function watchNavigation(wc, { origins, isCurrent, publish, networkFailure, processGone }) {
  let navigationStatus = 'loading';
  const history = () => {
    if (isCurrent() && !wc.isDestroyed()) publish({ can_back: wc.navigationHistory.canGoBack(), can_forward: wc.navigationHistory.canGoForward() });
  };
  wc.on('did-start-navigation', (_event, url, inPlace, mainFrame) => {
    if (!isCurrent() || !mainFrame || inPlace || !allowedUrl(url, origins)) return;
    navigationStatus = 'loading';
    publish({ status: 'loading', http_status: null, http_observed_at: null, message: '', notice: '' });
  });
  wc.on('did-navigate', (_event, url, code) => {
    if (!isCurrent() || !allowedUrl(url, origins)) return;
    const result = classifyHttpStatus(code);
    navigationStatus = result.status;
    publish({ ...result, http_observed_at: new Date().toISOString() });
    history();
  });
  wc.on('did-stop-loading', () => {
    if (!isCurrent()) return;
    // Um spinner parado não é sucesso HTTP. Nunca sobrescreve 403/429/erro com "open".
    if (navigationStatus === 'loading') {
      navigationStatus = 'unconfirmed';
      publish(classifyHttpStatus(null));
    }
    history();
  });
  wc.on('did-navigate-in-page', history);
  wc.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (!isCurrent() || !mainFrame || code === -3) return;
    navigationStatus = 'error';
    networkFailure();
    publish({ status: 'error', http_status: null, message: 'A página não carregou. Verifique a conexão. Uma falha de rede não confirma um bloqueio da Privacy.' });
  });
  wc.on('render-process-gone', () => { if (isCurrent()) processGone(); });
}

module.exports = { classifyHttpStatus, watchNavigation };