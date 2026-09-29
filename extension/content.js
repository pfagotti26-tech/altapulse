// Content script Alta Pulse na Privacy. Não lê mensagens, cookies ou tokens da Privacy.
// Avisa o service worker quando a aba/URL muda e, sob pedido, envia a ESTRUTURA da tela
// (esqueleto: tags, classes e horários) para calibrar a leitura — sem texto de mensagens.
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

  // Palavras de sistema (não pessoais) mantidas para eu reconhecer vendas/eventos.
  const KEEP = /(r\$|\bcompr|desbloque|gorjeta|\bpago|pagou|\bppv\b|assinat|presente|enviou|\bvisto|entregue|digitando|online|agora|ontem|hoje|há\s|\bmin\b|\bh\b)/i;
  const TIME = /^\s*\d{1,2}:\d{2}(\s?[ap]\.?m\.?)?\s*$/i;
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH", "IMG", "VIDEO", "SOURCE", "CANVAS"]);

  function serialize(node, depth) {
    if (depth > 22) return "";
    if (node.nodeType === 3) {
      const t = node.textContent.trim();
      if (!t) return "";
      if (TIME.test(t)) return "«TIME»";
      if (KEEP.test(t)) return "«" + t.slice(0, 40) + "»";
      return "«t" + Math.min(t.length, 99) + "»";
    }
    if (node.nodeType !== 1 || SKIP.has(node.tagName)) return "";
    const tag = node.tagName.toLowerCase();
    const cls = node.getAttribute("class");
    const data = [...node.attributes].filter(a => a.name.startsWith("data-")).map(a => `${a.name}="${(a.value || "").slice(0, 30)}"`).join(" ");
    const role = node.getAttribute("role");
    let inner = "";
    for (const ch of node.childNodes) inner += serialize(ch, depth + 1);
    const attrs = [cls ? `class="${cls}"` : "", data, role ? `role="${role}"` : ""].filter(Boolean).join(" ");
    return `<${tag}${attrs ? " " + attrs : ""}>${inner}</${tag}>`;
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg && msg.type === "calibrateChat") {
      try { reply({ outline: serialize(document.body, 0).slice(0, 190000) }); }
      catch (e) { reply({ error: String(e) }); }
      return true;
    }
  });
})();
