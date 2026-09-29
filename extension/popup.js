const send = (msg) => chrome.runtime.sendMessage(msg);
const $ = (id) => document.getElementById(id);
const initials = (name) => (name || "").split(" ").slice(0, 2).map(n => n[0]).join("").toUpperCase();

let state = { creators: [], activeCreatorId: null, user: null };

function show(view) {
  ["login-view", "dash-view", "loading"].forEach(v => $(v).hidden = v !== view);
}

async function boot() {
  show("loading");
  const session = await send({ type: "session" });
  if (!session?.token) { show("login-view"); return; }
  state.activeCreatorId = session.activeCreatorId || null;
  const res = await send({ type: "state" });
  if (res?.error) { show("login-view"); return; }
  state.creators = res.data.creators || [];
  state.user = res.data.user;
  renderDash();
  show("dash-view");
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("login-submit"); const err = $("login-error");
  err.hidden = true; btn.disabled = true; btn.textContent = "Entrando…";
  const res = await send({ type: "login", payload: { email: $("email").value.trim(), password: $("password").value, device_name: "Chrome" } });
  btn.disabled = false; btn.textContent = "Entrar";
  if (res?.error) { err.textContent = res.error; err.hidden = false; return; }
  await boot();
});

$("logout").addEventListener("click", async () => { await send({ type: "logout" }); show("login-view"); $("logout").hidden = true; });

$("calibrate-btn").addEventListener("click", async () => {
  const btn = $("calibrate-btn"); const status = $("calibrate-status");
  btn.disabled = true; btn.textContent = "Capturando…";
  const res = await send({ type: "calibrate" });
  btn.disabled = false; btn.textContent = "Capturar estrutura da tela (calibração)";
  if (res?.error) { status.textContent = "⚠ " + res.error; status.style.color = "#c0392b"; }
  else { status.textContent = "✓ Estrutura enviada! Já pode me avisar no chat que enviou."; status.style.color = "#1e874b"; }
});

$("active-creator").addEventListener("change", async (e) => {
  state.activeCreatorId = e.target.value || null;
  await send({ type: "setActiveCreator", creatorId: state.activeCreatorId });
  const res = await send({ type: "state" }); if (res?.data) state.creators = res.data.creators;
  renderActivePanel();
  renderList();
});

function renderDash() {
  $("logout").hidden = false;
  $("user-avatar").textContent = initials(state.user.name);
  $("user-name").textContent = state.user.name;
  $("user-role").textContent = state.user.role === "manager" ? "Gestor" : "Chatter";
  $("calibrate-box").hidden = state.user.role !== "manager";
  const sel = $("active-creator");
  sel.innerHTML = '<option value="">Selecione uma criadora…</option>' +
    state.creators.map(c => `<option value="${c.id}" ${c.id === state.activeCreatorId ? "selected" : ""}>${c.name}</option>`).join("");
  $("creator-count").textContent = state.creators.length;
  renderActivePanel();
  renderList();
}

function shiftBadge(c) {
  if (c.review) return ["amber", "Em revisão"];
  if (!c.shift) return ["ink", "Sem turno"];
  if (c.shift.paused) return ["amber", "Pausado"];
  return ["green", "Em atendimento"];
}

function renderActivePanel() {
  const panel = $("active-panel");
  const c = state.creators.find(x => x.id === state.activeCreatorId);
  if (!c) { panel.hidden = true; return; }
  panel.hidden = false;
  const [tone, label] = shiftBadge(c);
  $("shift-state").className = "badge " + tone;
  $("shift-state").textContent = label;
  $("shift-operator").textContent = c.shift ? c.shift.operator_name : "";
  const actions = $("shift-actions"); actions.innerHTML = "";
  const mine = !c.shift || c.shift.operator_id === state.user.id || state.user.role === "manager";
  if (!c.shift) {
    addAction(actions, "Iniciar turno", "solid", () => act(() => send({ type: "startShift", creatorId: c.id })));
  } else if (mine) {
    addAction(actions, c.shift.paused ? "Retomar" : "Pausar", c.shift.paused ? "solid" : "", () => act(() => send({ type: "shiftAction", shiftId: c.shift.id, action: c.shift.paused ? "resume" : "pause" })));
    addAction(actions, "Encerrar", "", () => act(() => send({ type: "shiftAction", shiftId: c.shift.id, action: "end" })));
  } else {
    const span = document.createElement("span"); span.className = "muted"; span.style.fontSize = "10.5px";
    span.textContent = `Turno de ${c.shift.operator_name}`; actions.appendChild(span);
  }
}

function addAction(parent, label, cls, onClick) {
  const b = document.createElement("button"); b.textContent = label; if (cls) b.className = cls; b.onclick = onClick; parent.appendChild(b);
}

async function act(fn) {
  const res = await fn();
  if (res?.error) { alert(res.error); }
  const st = await send({ type: "state" }); if (st?.data) state.creators = st.data.creators;
  renderActivePanel(); renderList();
}

function renderList() {
  const ul = $("creator-list"); ul.innerHTML = "";
  if (!state.creators.length) { ul.innerHTML = '<div class="empty">Nenhuma criadora autorizada para você.</div>'; return; }
  state.creators.forEach(c => {
    const [tone, label] = shiftBadge(c);
    const li = document.createElement("li");
    if (c.id === state.activeCreatorId) li.className = "active";
    li.innerHTML = `<span class="c-avatar">${initials(c.name)}</span><div class="c-info"><strong>${c.name}</strong><small>${label}${c.shift ? " · " + c.shift.operator_name : ""}</small></div><span class="badge ${tone}">${label}</span>`;
    li.onclick = () => { $("active-creator").value = c.id; $("active-creator").dispatchEvent(new Event("change")); };
    ul.appendChild(li);
  });
}

boot();
