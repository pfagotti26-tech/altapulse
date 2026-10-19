// AUTO (Grok) — fila de ensaio
// Critério: !ours, não está digitando, última msg do fã ≥ 45s.
// Tick 10s com variação. Prioriza recentes da automação.
module.exports = function createFila(deps) {
  const { api, getState, roomKey, openChat, getLastRooms, listAt, log, tabs, runJs, FF_CHAT_SCRIPT } = deps;
  let running = false;
  let timer = null;
  let ticking = false;
  let seen = new Set();
  let seenDay = '';
  const recentAuto = new Map(); // ref → timestamp
  const firstUnanswered = new Map(); // ref → timestamp da primeira msg não respondida
  let lastServed = null; // ref do último atendido
  const tempRetry = new Map(); // ref → timestamp
  const ffRooms = new Map(); // creatorId → rooms
  let lastFFUpdate = 0;
  let cycleIdx = 0;
  let lastAction = Date.now();

  function inWindow(windows) {
    const now = new Date();
    const h = parseInt(now.toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo', hour:'numeric', hourCycle:'h23'}));
    const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
    for (const w of windows || []) {
      if (w.days && !w.days.includes(dow)) continue;
      if (w.start === w.end) return true;
      if (w.start < w.end) { if (w.start <= h && h < w.end) return true; }
      else { if (h >= w.start || h < w.end) return true; }
    }
    return false;
  }
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
      const configs = await api('GET', '/auto/app-configs').catch(() => []);
      const enabled = (configs || []).filter(c => c.enabled && inWindow(c.windows));
      if (!enabled.length) return;
      // Reinicia se parada 5 min com fã esperando
      if (Date.now() - lastAction > 5 * 60 * 1000) {
        const anyWaiting = enabled.some(c => pendingCount(c.creator_id, 'privacy') + pendingCount(c.creator_id, 'fatalfans') > 0);
        if (anyWaiting) {
          ticking = false;
          lastServed = null;
          for (const c of enabled) {
            const rooms = [...(getLastRooms(c.creator_id, 'privacy') || []), ...(ffRooms.get(c.creator_id) || [])];
            for (const r of rooms) {
              if (!r.ours) { seen.delete(c.creator_id + ':privacy:' + roomKey(c.creator_id, r.name) + ':' + (r.when || '')); seen.delete(c.creator_id + ':fatalfans:' + roomKey(c.creator_id, r.name) + ':' + (r.when || '')); }
            }
          }
          lastAction = Date.now();
          if (log) log('fila reiniciada');
        }
      }
      // Atualiza FatalFans a cada 30s (todas as criadoras ligadas)
      const now = Date.now();
      if (now - lastFFUpdate > 30000) {
        for (const c of enabled) {
          if (!(c.platforms || []).includes('fatalfans')) continue;
          const view = (tabs && tabs() && tabs().get(c.creator_id) && tabs().get(c.creator_id).get('fatalfans'));
          if (!view || !/fatalfans\.com\/chat/.test(view.webContents.getURL())) continue;
          const data = await runJs(view, FF_CHAT_SCRIPT, 4000).catch(() => null);
          if (data && data.rooms) ffRooms.set(c.creator_id, data.rooms);
        }
        lastFFUpdate = now;
      }
      // Junta fãs esperando de todas as (criadora, plataforma)
      const waiting = [];
      for (const c of enabled) {
        if (c.limit_hit) continue;
        for (const platform of (c.platforms || ['privacy'])) {
          const creatorId = c.creator_id;
          const rooms = platform === 'fatalfans' ? (ffRooms.get(creatorId) || []) : (getLastRooms(creatorId, platform) || []);
          for (const r of rooms) {
        if (r.ours) { firstUnanswered.delete(creatorId + ':' + platform + ':' + roomKey(creatorId, r.name)); continue; }
        if (r.typing || r.verified) continue;
        const ref = roomKey(creatorId, r.name);
        const at = listAt ? listAt(r.when, new Date()) : null;
        const age = at ? (now - at.getTime()) : Infinity;
        const fKey = creatorId + ':' + platform + ':' + ref;
        if (at && !firstUnanswered.has(fKey)) firstUnanswered.set(fKey, at);
        const firstAge = firstUnanswered.has(fKey) ? (now - firstUnanswered.get(fKey).getTime()) : Infinity;
        if (r.typing && firstAge < 60 * 1000) continue;
        if (age < 30 * 1000 && firstAge < 60 * 1000) continue;
        const key = creatorId + ':' + platform + ':' + ref + ':' + (r.lastHash || '');
        if (seen.has(key)) continue;
        const tr = tempRetry.get(fKey);
        if (tr && (now - tr) < 5 * 60 * 1000) continue;
        waiting.push({ r, ref, fKey, firstAge, key, creatorId, platform, spent: r.spent || 0 });
          }
        }
      }
      waiting.sort((a, b) => b.firstAge - a.firstAge || (b.spent > 0) - (a.spent > 0));
      // Não atende o mesmo de novo se houver outro esperando
      let chosen = waiting[0];
      if (chosen && chosen.ref === lastServed && waiting.length > 1) chosen = waiting[1];
      if (chosen) {
        const { r, ref, fKey, key, creatorId, platform } = chosen;
        seen.add(key);
        firstUnanswered.delete(fKey);
        lastServed = ref;
        lastAction = Date.now();
        const result = openChat ? await Promise.race([
          openChat(creatorId, r.name, ref, platform),
          new Promise(res => setTimeout(() => res('timeout'), 90000))
        ]) : null;
        if (result === 'timeout') { seen.delete(key); lastServed = null; if (log) log('timeout 90s'); }
        if (result === 'retry' || result === 'temp') {
          seen.delete(key);
          lastServed = null;
          if (result === 'temp') tempRetry.set(fKey, Date.now());
        }
        // Espera a tela mudar (até 4s, checa a cada 300ms)
        const start = Date.now();
        while (Date.now() - start < 4000) {
          await new Promise(res => setTimeout(res, 300));
          break; // a confirmação é feita no tryAutoDecide
        }
        if (log) log(`abriu: ${r.name}`);
      }
    } catch (e) { if (log) log(String(e)); }
    finally { ticking = false; }
  }

  function pendingCount(creatorId, platform) {
    const rooms = platform === 'fatalfans' ? (ffRooms.get(creatorId) || []) : (getLastRooms(creatorId, platform || 'privacy') || []);
    const now = Date.now();
    let n = 0;
    for (const r of rooms) {
      if (r.ours || r.typing || r.verified) continue;
      const ref = roomKey(creatorId, r.name);
      const key = creatorId + ':' + platform + ':' + ref + ':' + (r.when || '');
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
  return { start, stop, markRecent, pendingCount, firstUnanswered, get running() { return running; } };
};
