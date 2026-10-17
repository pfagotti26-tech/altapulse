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
  const firstUnanswered = new Map(); // ref → timestamp da primeira msg não respondida
  let lastServed = null; // ref do último atendido
  const tempRetry = new Map(); // ref → timestamp

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
      // Fila por ordem de espera (mais antigo primeiro)
      const waiting = [];
      for (const r of rooms) {
        if (r.ours) { firstUnanswered.delete(roomKey(creatorId, r.name)); continue; }
        if (r.typing || r.verified) continue;
        const ref = roomKey(creatorId, r.name);
        const at = listAt ? listAt(r.when, new Date()) : null;
        const age = at ? (now - at.getTime()) : Infinity;
        if (at && !firstUnanswered.has(ref)) firstUnanswered.set(ref, at);
        const firstAge = firstUnanswered.has(ref) ? (now - firstUnanswered.get(ref).getTime()) : Infinity;
        if (r.typing && firstAge < 60 * 1000) continue;
        if (age < 30 * 1000 && firstAge < 60 * 1000) continue;
        const key = creatorId + ':' + ref + ':' + (r.when || '');
        if (seen.has(key)) continue;
        const tr = tempRetry.get(ref);
        if (tr && (now - tr) < 5 * 60 * 1000) continue;
        waiting.push({ r, ref, firstAge, key });
      }
      waiting.sort((a, b) => b.firstAge - a.firstAge); // mais antigo primeiro
      // Não atende o mesmo de novo se houver outro esperando
      let chosen = waiting[0];
      if (chosen && chosen.ref === lastServed && waiting.length > 1) chosen = waiting[1];
      if (chosen) {
        const { r, ref, key } = chosen;
        seen.add(key);
        firstUnanswered.delete(ref);
        lastServed = ref;
        const result = openChat ? await openChat(creatorId, r.name, ref) : null;
        if (result === 'retry' || result === 'temp') {
          seen.delete(key);
          lastServed = null;
          if (result === 'temp') tempRetry.set(ref, Date.now());
        }
        await new Promise(res => setTimeout(res, 3000));
        if (log) log(`abriu: ${r.name}`);
      }
    } catch (e) { if (log) log(String(e)); }
    finally { ticking = false; }
  }

  function pendingCount(creatorId) {
    const rooms = getLastRooms(creatorId) || [];
    const now = Date.now();
    let n = 0;
    for (const r of rooms) {
      if (r.ours || r.typing || r.verified) continue;
      const ref = roomKey(creatorId, r.name);
      const key = creatorId + ':' + ref + ':' + (r.when || '');
      if (seen.has(key)) continue;
      const at = listAt ? listAt(r.when, new Date()) : null;
      const age = at ? (now - at.getTime()) : Infinity;
      if (age < 30 * 1000) continue;
      n++;
    }
    return n;
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
  return { start, stop, markRecent, pendingCount, get running() { return running; } };
};
