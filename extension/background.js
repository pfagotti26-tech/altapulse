// Service worker Alta Pulse. Guarda o token, fala com a API e envia heartbeats.
// Nenhum cookie, senha ou conteúdo de conversa da Privacy é lido ou transmitido.
const RAW_ORIGIN = "__API_ORIGIN__";
const API = (RAW_ORIGIN.startsWith("http") ? RAW_ORIGIN : "https://privacy-agent-hub.preview.emergentagent.com") + "/api";

const store = {
  get: keys => chrome.storage.local.get(keys),
  set: obj => chrome.storage.local.set(obj),
  clear: () => chrome.storage.local.remove(["token", "user", "expires_at", "creators", "settings", "activeCreatorId"])
};

async function authHeaders() {
  const { token } = await store.get("token");
  return token ? { "Content-Type": "application/json", Authorization: "Bearer " + token } : null;
}

async function call(path, method = "GET", body) {
  const headers = await authHeaders();
  if (!headers) return { error: "unauthenticated" };
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) { await store.clear(); return { error: data.detail || "unauthenticated", status: res.status }; }
  if (!res.ok) return { error: data.detail || "Falha na comunicação.", status: res.status };
  return { data };
}

async function login({ email, password, device_name }) {
  const res = await fetch(API + "/extension/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, device_name }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.detail || "Não foi possível entrar." };
  await store.set({ token: data.token, user: data.user, expires_at: data.expires_at });
  return { data };
}

async function refreshState() {
  const res = await call("/extension/state");
  if (res.data) await store.set({ creators: res.data.creators, settings: { storage_allowed: res.data.storage_allowed, sla_minutes: res.data.sla_minutes }, user: res.data.user });
  return res;
}

async function currentPageType() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !/privacy\.com\.br/.test(tab.url || "")) return "away";
  return /(chat|messages|mensagens|inbox)/i.test(tab.url) ? "chat" : "other";
}

async function heartbeat() {
  const { token, activeCreatorId } = await store.get(["token", "activeCreatorId"]);
  if (!token || !activeCreatorId) return;
  const page = await currentPageType();
  if (page === "away") return;
  await call("/extension/heartbeat", "POST", { creator_id: activeCreatorId, page, observation_state: page === "chat" ? "validation_required" : "no_data" });
}

async function calibrate() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !/privacy\.com\.br/.test(tab.url || "")) return { error: "Abra uma conversa da Privacy na aba ativa e tente de novo." };
  let outline;
  try { const r = await chrome.tabs.sendMessage(tab.id, { type: "calibrateChat" }); outline = r && r.outline; }
  catch (e) { return { error: "Recarregue a página da Privacy (F5) e tente novamente." }; }
  if (!outline) return { error: "Nada foi capturado nesta tela." };
  const path = (() => { try { return new URL(tab.url).pathname; } catch (e) { return ""; } })();
  return await call("/extension/calibration", "POST", { platform: "privacy", url_path: path, outline });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    switch (msg.type) {
      case "login": return reply(await login(msg.payload));
      case "state": return reply(await refreshState());
      case "startShift": return reply(await call("/extension/shifts", "POST", { creator_id: msg.creatorId }));
      case "shiftAction": return reply(await call(`/extension/shifts/${msg.shiftId}/action`, "POST", { action: msg.action }));
      case "setActiveCreator": await store.set({ activeCreatorId: msg.creatorId }); await heartbeat(); return reply({ ok: true });
      case "calibrate": return reply(await calibrate());
      case "logout": await call("/extension/logout", "POST"); await store.clear(); return reply({ ok: true });
      case "session": { const s = await store.get(["token", "user", "expires_at", "activeCreatorId"]); return reply(s); }
      case "pageChanged": await heartbeat(); return reply({ ok: true });
      default: return reply({ error: "unknown" });
    }
  })();
  return true;
});

chrome.alarms.create("alta-pulse-heartbeat", { periodInMinutes: 0.25 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === "alta-pulse-heartbeat") heartbeat(); });
chrome.runtime.onInstalled.addListener(() => refreshState());
