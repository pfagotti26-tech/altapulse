'use strict';
// Lote 118 — Puxar conversa (app): lista quem está ONLINE agora (bolinha verde na lista de conversas da Privacy) nas criadoras
// ligadas no painel, tirando quem o servidor excluiu (intervalo por fã, bloqueado, mídia paga aguardando, falou há pouco…).
// Um clique: o main.js abre a conversa, lê o fim dela, pede a frase ao servidor (que confere TODAS as travas e devolve uma
// autorização) e deixa o texto na caixa. Quem envia é a pessoa. O app registra o envio (quando a nova mensagem nossa aparece
// na conversa) e a resposta do fã (quando a última da conversa volta a ser dele). Separado do plantão e da automação.
function create(deps) {
  const { api, log, getState, roomKey } = deps;
  const px = { configs: [], fetchedAt: 0, rooms: new Map(),
    pending: new Map(), // `${creatorId}|${ref}` -> { name, text, token, at, lastOurs }
    sent: new Map(),    // `${creatorId}|${ref}` -> { name, text, at, replied }
  };
  async function fetchConfigs() {
    try { const r = await api('GET', '/extension/puxada'); px.configs = r.configs || []; px.fetchedAt = Date.now(); }
    catch (e) { log('config', e.message); }
  }
  const on = () => px.configs.length > 0;
  const cfgOf = (creatorId) => px.configs.find((c) => c.creator_id === creatorId) || null;
  // a cada leitura das conversas (10 s): guarda a lista e confere quem respondeu à puxada
  function onRooms(creatorId, rooms) {
    if (!Array.isArray(rooms)) return;
    px.rooms.set(creatorId, { at: Date.now(), rooms });
    const old = Date.now() - 48 * 3600e3;
    for (const [k, s] of px.sent) if (s.at < old) px.sent.delete(k);
    for (const r of rooms) {
      if (!r.name) continue;
      const ref = roomKey(creatorId, r.name); const s = px.sent.get(`${creatorId}|${ref}`);
      if (s && !s.replied && !r.ours) {
        s.replied = true; s.repliedAt = Date.now();
        api('POST', '/extension/puxada/replied', { creator_id: creatorId, fan_ref: ref }).catch(() => {});
        log('respondeu', r.name);
      }
    }
  }
  function queue() {
    const st = getState(); const out = [];
    for (const cfg of px.configs) {
      const c = (st.creators || []).find((x) => x.id === cfg.creator_id); if (!c) continue;
      const snap = px.rooms.get(cfg.creator_id); const fresh = !!snap && Date.now() - snap.at < 60000;
      const ex = cfg.excluded || {}; const items = []; let online = 0;
      if (fresh) for (const r of snap.rooms) {
        if (!r.name || !r.online || r.verified) continue;
        online++;
        if (!r.ours) continue; // a última é dele: está esperando resposta (Sugerir resposta), não puxada
        const ref = roomKey(cfg.creator_id, r.name); const key = `${cfg.creator_id}|${ref}`;
        if (ex[ref] || px.pending.has(key) || px.sent.has(key)) continue;
        items.push({ fan_ref: ref, name: r.name, rid: r.rid || null, spent_cents: (r.spent && r.spent.cents) || 0, when: r.when || '' });
      }
      items.sort((a, b) => b.spent_cents - a.spent_cents);
      out.push({ creator_id: cfg.creator_id, creator_name: c.name, open: fresh, online, in_window: cfg.in_window, window: cfg.window,
        left_hour: cfg.left_hour, per_hour: cfg.per_hour, paused_reason: cfg.paused_reason || null, items: items.slice(0, 25) });
    }
    const pend = [...px.pending.entries()].map(([k, v]) => ({ key: k, name: v.name, text: v.text, at: v.at }));
    const sent = [...px.sent.entries()].map(([k, v]) => ({ key: k, name: v.name, text: v.text, at: v.at, replied: !!v.replied }));
    return { enabled: on(), creators: out, pending: pend, sent };
  }
  function prepared(creatorId, fanRef, name, text, token, lastOurs) { px.pending.set(`${creatorId}|${fanRef}`, { name, text, token, at: Date.now(), lastOurs: lastOurs || '' }); }
  function markSent(key, text) {
    const p = px.pending.get(key); if (!p) return;
    px.pending.delete(key); px.sent.set(key, { name: p.name, text, at: Date.now(), replied: false });
    const c = px.configs.find((x) => x.creator_id === key.split('|')[0]); if (c) { c.excluded = { ...(c.excluded || {}), [key.split('|')[1]]: 'já recebeu puxada há pouco' }; c.left_hour = Math.max(0, (c.left_hour || 1) - 1); }
    api('POST', '/extension/puxada/sent', { token: p.token, text: String(text || p.text).slice(0, 600) }).catch((e) => log('registrar envio', e.message));
  }
  function cancel(key, detail) {
    const p = px.pending.get(key); if (!p) return;
    px.pending.delete(key);
    api('POST', '/extension/puxada/cancel', { token: p.token, detail: String(detail || '').slice(0, 200) }).catch(() => {});
  }
  return { fetchConfigs, onRooms, queue, prepared, markSent, cancel, cfgOf, on, get pending() { return px.pending; }, get fetchedAt() { return px.fetchedAt; } };
}
module.exports = { create };
