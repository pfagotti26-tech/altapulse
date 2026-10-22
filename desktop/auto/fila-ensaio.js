// AUTO (Grok) — fila de ensaio
// Critério: !ours, não está digitando, última msg do fã ≥ 45s.
// Tick 10s com variação. Prioriza recentes da automação.
module.exports = function createFila(deps) {
  const { api, getState, roomKey, openChat, getLastRooms, listAt, log, tabs, runJs, FF_CHAT_SCRIPT, scanRooms } = deps;
  // lote 177 (revisão Claude): memória das conversas. A lista da Privacy só mostra as linhas carregadas (e, com o filtro
  // "só online", some quem ficou offline): quem estava esperando e saiu da lista era esquecido. Agora fica lembrado por 6 h.
  const mem = new Map(); // creatorId:platform → Map(nome → { r, seenAt })
  const lastScan = new Map(); // creatorId → timestamp da última varredura
  const MEM_MS = 6 * 60 * 60 * 1000;
  const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // conversa parada há mais de 2 dias não entra
  function remember(creatorId, platform, rooms) {
    const k = creatorId + ':' + platform; const now = Date.now();
    if (!mem.has(k)) mem.set(k, new Map());
    const m = mem.get(k);
    for (const r of rooms || []) if (r && r.name) m.set(r.name, { r, seenAt: now });
    for (const [n, e] of m) if (now - e.seenAt > MEM_MS) m.delete(n);
  }
  function roomsOf(creatorId, platform, current) {
    remember(creatorId, platform, current);
    const names = new Set((current || []).map(r => r.name));
    const extra = [];
    for (const [n, e] of (mem.get(creatorId + ':' + platform) || new Map())) {
      if (names.has(n) || e.r.ours) continue;
      const at = listAt ? listAt(e.r.when, new Date()) : null;
      if (!at || Date.now() - at.getTime() > MAX_AGE_MS) continue; // lote 181: sem data legível ou mais de 2 dias: não entra
      extra.push(e.r);
    }
    return [...(current || []), ...extra];
  }
  let running = false;
  let timer = null;
  let ticking = false;
  let seen = new Set();
  let seenDay = '';
  const recentAuto = new Map(); // ref → timestamp
  const firstUnanswered = new Map(); // ref → timestamp da primeira msg não respondida
  let lastServed = null; // ref do último atendido
  const tempRetry = new Map(); // ref → timestamp
  const failCount = new Map(); // fKey → falhas seguidas
  const ffRooms = new Map(); // creatorId → rooms
  const ffNav = new Map(); // lote 181: creatorId → última vez que a aba FatalFans foi levada ao chat
  let lastFFUpdate = 0;
  let pendingNow = 0; // fãs esperando na última volta (define o ritmo)
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
              if (!r.ours) { seen.delete(c.creator_id + ':privacy:' + roomKey(c.creator_id, r.name) + ':' + (r.lastHash || '')); seen.delete(c.creator_id + ':fatalfans:' + roomKey(c.creator_id, r.name) + ':' + (r.lastHash || '')); }
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
          if (!view || view.webContents.isDestroyed()) continue;
          if (!/fatalfans\.com\/chat/.test(view.webContents.getURL())) {
            // lote 181: a aba FatalFans abre no feed e a fila só lê no chat — leva ao chat sozinha (no máximo a cada 5 min,
            // só se ninguém estiver olhando essa aba agora e fora da tela de login)
            const last = ffNav.get(c.creator_id) || 0;
            const shown = deps.isShown && deps.isShown(c.creator_id, 'fatalfans');
            if (!shown && now - last > 5 * 60 * 1000 && !/login|entrar|signin/i.test(view.webContents.getURL())) {
              ffNav.set(c.creator_id, now);
              view.webContents.loadURL('https://fatalfans.com/chat').catch(() => {});
              if (log) log(`FatalFans ${c.name || c.creator_id}: aba levada para o chat`);
            }
            continue;
          }
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
          const rooms = roomsOf(creatorId, platform, platform === 'fatalfans' ? (ffRooms.get(creatorId) || []) : (getLastRooms(creatorId, platform) || []));
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
      pendingNow = waiting.length;
      // lote 177: fila vazia → varredura (uma criadora por vez, cada uma a cada 10 min): carrega as conversas mais antigas da lista
      if (!waiting.length && scanRooms) {
        const due = enabled.filter(c => (c.platforms || ['privacy']).includes('privacy') && !c.limit_hit && Date.now() - (lastScan.get(c.creator_id) || 0) > 10 * 60 * 1000);
        if (due.length) {
          const c = due[0]; lastScan.set(c.creator_id, Date.now());
          const rooms = await scanRooms(c.creator_id).catch(() => null);
          if (rooms) { remember(c.creator_id, 'privacy', rooms); if (log) log(`varredura ${c.name || c.creator_id}: ${rooms.length} conversas na lista, ${rooms.filter(r => !r.ours).length} com o fã por último`); }
        }
      }
      // lote 181 (revisão Claude): conversa nova primeiro. Antes ganhava quem esperava há mais tempo, e as conversas antigas
      // achadas pela varredura (dias paradas) passavam na frente de quem acabou de escrever (deo, FatalFans, 22/10 14h43).
      // Agora: até 2 h esperando = fila principal (a mais antiga primeiro); mais que isso = fila de trás (a mais recente primeiro).
      const FRESH = 2 * 60 * 60 * 1000;
      const rank = (w) => (isFinite(w.firstAge) && w.firstAge <= FRESH) ? 0 : (isFinite(w.firstAge) ? 1 : 2);
      waiting.sort((a, b) => rank(a) - rank(b)
        || (rank(a) === 0 ? b.firstAge - a.firstAge : rank(a) === 1 ? a.firstAge - b.firstAge : 0)
        || (b.spent > 0) - (a.spent > 0));
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
          openChat(creatorId, r.name, ref, platform, Number.isFinite(chosen.firstAge) ? Math.round(chosen.firstAge / 1000) : 0),
          new Promise(res => setTimeout(() => res('timeout'), 90000))
        ]) : null;
        // revisão Claude: fã que dá timeout/retry não pode voltar na hora (travava a fila inteira num fã só, ex.: conversa sem assinatura).
        // Espera 5 min; a partir da 3ª falha seguida, 60 min.
        if (result === 'busy') {  // lote 177: a aba estava ocupada com outra decisão — tenta este fã de novo em ~30 s, sem contar falha
          seen.delete(key);
          lastServed = null;
          tempRetry.set(fKey, Date.now() - 4.5 * 60 * 1000);
          if (log) log(`ocupada: ${r.name} volta em 30 s`);
        } else if (result === 'timeout' || result === 'retry' || result === 'temp') {
          seen.delete(key);
          lastServed = null;
          const n = (failCount.get(fKey) || 0) + 1; failCount.set(fKey, n);
          tempRetry.set(fKey, Date.now() + (n >= 3 ? 55 * 60 * 1000 : 0));
          if (log) log(`${result}: ${r.name} (${platform}) volta em ${n >= 3 ? 60 : 5} min`);
        } else failCount.delete(fKey);

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
      const key = creatorId + ':' + platform + ':' + ref + ':' + (r.lastHash || '');
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
    const delay = () => pendingNow > 1 ? 1000 : 5000;
    const loop = () => { tick(); timer = setTimeout(loop, delay()); };
    timer = setTimeout(loop, delay());
    tick();
  }
  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
  }
  // lote 179: quantos fãs a fila viu esperando resposta na última volta (o puxar conversa dá a vez quando há alguém)
  return { start, stop, markRecent, pendingCount, firstUnanswered, waitingNow: () => pendingNow, get running() { return running; } };
};
