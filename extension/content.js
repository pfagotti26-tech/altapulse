// Content script Alta Pulse na Privacy. Não lê mensagens, cookies ou tokens da Privacy.
// Apenas avisa o service worker quando a aba/URL muda, para atualizar presença e turno.
(function () {
  let lastUrl = location.href;
  const notify = () => { try { chrome.runtime.sendMessage({ type: "pageChanged" }); } catch (e) {} };
  notify();
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; notify(); }
  });
  observer.observe(document, { subtree: true, childList: true });
  window.addEventListener("focus", notify);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) notify(); });
})();
