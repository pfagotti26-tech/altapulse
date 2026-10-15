// AUTO (Grok) — fila de ensaio
// Critério: !ours, não está digitando, última msg do fã ≥ 45s.
// Tick 10s com variação. Prioriza recentes da automação.
module.exports = function createFila(deps) {
  const { api, getState, roomKey, openChat, getLastRooms, listAt, log } = deps;
  let running = false;
  let timer = null;
  let ticking = false;
  let seen = new Set();
  let seenDay = '';
  const recentAuto = new Map(); // ref → timestamp

  function todayBR() {
    return new Date().toLocaleDateString('sv', { timeZone: 'America/Sao_Paulo' });
  }

  function isTyping(r) {
    const t = String(r.last_line || r.when || '').toLowerCase();
    return /está escrevendo|digitando/.test(t);
  }

  async function tick() {
    if (!running || ticking) return;
    ticking = true;
    try {
      const day = todayBR();
      if (day !== seenDay) { seen = new Set(); seenDay = day; }
      const st = await api('GET', '/auto/status');
      if (!st || !st.enabled || !st.creator_id || (st.remaining != null && st.remaining <= 0)) {
        stop(); return;
      }
      const creatorId = st.creator_id;
      let rooms = getLastRooms(creatorId) || [];
      const now = Date.now();
      rooms = rooms.slice().sort((a, b) => {
        const ra = recentAuto.get(roomKey(creatorId, a.name)) || 0;
        const rb = recentAuto.get(roomKey(creatorId, b.name)) || 0;
        const aRecent = now - ra < 30 * 60 * 1000;
        const bRecent = now - rb < 30 * 60 * 1000;
        if (aRecent !== bRecent) return aRecent ? -1 : 1;
        return 0;
      });
      for (const r of rooms) {
        if (r.ours) continue;
        if (r.typing) continue;
        const ref = roomKey(creatorId, r.name);
        const at = listAt ? listAt(r.when, new Date()) : null;
        if (at && (now - at.getTime()) < 105 * 1000) continue;
        const key = creatorId + ':' + ref + ':' + (r.when || '');
        if (seen.has(key)) continue;
        seen.add(key);
        if (openChat) await openChat(creatorId, r.name, ref);
        await new Promise(res => setTimeout(res, 3000));
        if (log) log(`abriu: ${r.name}`);
        break;
      }
    } catch (e) { if (log) log(String(e)); }
    finally { ticking = false; }
  }

  function markRecent(ref) { recentAuto.set(ref, Date.now()); }

  function start() {
    if (running) return;
    running = true;
    const delay = () => 8000 + Math.floor(Math.random() * 4000); // 8–12s
    const loop = () => { tick(); timer = setTimeout(loop, delay()); };
    timer = setTimeout(loop, delay());
    tick();
  }
  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
  }
  return { start, stop, markRecent, get running() { return running; } };
};
