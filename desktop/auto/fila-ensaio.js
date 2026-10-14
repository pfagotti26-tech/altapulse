// AUTO (Grok) — fila de ensaio
// Só abre a conversa. Quem decide é tryAutoDecide.
// Para quando enabled:false ou remaining <= 0.
module.exports = function createFila(deps) {
  const { api, getState, roomKey, openChat, getLastRooms, listAt, getReader } = deps;
  let running = false;
  let timer = null;
  let seen = new Set();
  let seenDay = '';

  function todayBR() {
    return new Date().toLocaleDateString('sv', { timeZone: 'America/Sao_Paulo' });
  }

  async function tick() {
    if (!running) return;
    const day = todayBR();
    if (day !== seenDay) { seen = new Set(); seenDay = day; }
    try {
      const st = await api('GET', '/auto/status');
      if (!st || !st.enabled || !st.creator_id || (st.remaining != null && st.remaining <= 0)) {
        stop();
        return;
      }
      const creatorId = st.creator_id;
      const rooms = getLastRooms(creatorId) || [];
      const now = Date.now();
      for (const r of rooms) {
        if (r.ours) continue;
        const ref = roomKey(creatorId, r.name);
        const reader = getReader ? getReader(creatorId) : null;
        if (reader && reader.s && reader.s.creators && reader.s.creators[ref]) continue;
        const at = listAt ? listAt(r.when, new Date()) : null;
        if (at && (Date.now() - at.getTime()) < 10 * 60 * 1000) continue;
        const ref = roomKey(creatorId, r.name);
        const key = creatorId + ':' + ref;
        if (seen.has(key)) continue;
        seen.add(key);
        if (openChat) await openChat(creatorId, r.name, ref);
        // tryAutoDecide cuida da decisão ao abrir
        break;
      }
    } catch (e) { /* silencioso */ }
  }

  function start() {
    if (running) return;
    running = true;
    timer = setInterval(tick, 20000);
    tick();
  }
  function stop() {
    running = false;
    if (timer) clearInterval(timer);
  }
  return { start, stop, get running() { return running; } };
};
