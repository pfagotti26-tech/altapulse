// AUTO (Grok) — fila de ensaio para a Aline
// Abre conversas onde o fã falou por último, chama /auto/decide e passa para a próxima.
// Respeita tetos. Só roda no app de teste.
module.exports = function createFila(deps) {
  const { api, getState, roomKey, openChat, readChat } = deps;
  let running = false;
  let timer = null;
  const seen = new Set();

  async function tick() {
    if (!running) return;
    try {
      const st = await api('GET', '/auto/status');
      if (!st || !st.enabled || !st.creator_id) return;
      const creatorId = st.creator_id;
      const state = getState();
      const creator = (state.creators || []).find(c => c.id === creatorId);
      if (!creator) return;
      // rooms from the reader summary (same source Plantão uses)
      const rooms = (state.readers && state.readers[creatorId] && state.readers[creatorId].rooms) || [];
      for (const r of rooms) {
        if (r.ours) continue; // last message is ours
        const ref = roomKey(creatorId, r.name);
        const key = creatorId + ':' + ref;
        if (seen.has(key)) continue;
        seen.add(key);
        // open conversation
        if (openChat) await openChat(creatorId, r.name, ref);
        await new Promise(res => setTimeout(res, 1500));
        // read and decide
        const read = readChat ? await readChat(creatorId) : null;
        if (!read || !read.msgs || !read.msgs.length || read.msgs[read.msgs.length - 1].ours) continue;
        const payload = {
          creator_id: creatorId,
          fan_ref: ref,
          messages: read.msgs.slice(-8).map(m => ({ ours: !!m.ours, text: m.text || '' })),
        };
        await api('POST', '/auto/decide', payload);
        // respect limits — stop if server says so (next tick will check)
        break;
      }
    } catch (e) { /* silencioso */ }
  }

  function start() {
    if (running) return;
    running = true;
    timer = setInterval(tick, 20000); // ritmo de 20s
    tick();
  }
  function stop() {
    running = false;
    if (timer) clearInterval(timer);
  }
  return { start, stop, get running() { return running; } };
};
