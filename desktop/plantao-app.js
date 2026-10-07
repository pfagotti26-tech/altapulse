'use strict';
// Plantão (copiloto): monta a FILA DE ABORDAGENS a partir da lista de conversas das criadoras ligadas no painel —
// quem abordar (filtros do gestor) e com qual abertura aprovada — e, com um clique, abre a conversa com o texto
// pronto na caixa. Quem envia é a pessoa. O app só registra: quando a última mensagem da conversa passa a ser nossa,
// marca "enviada"; quando o fã responde, marca "respondeu" (vira oportunidade para o chatter no painel).
// Só funciona para quem tem a permissão 'plantao'.
//
// // ALTA AUTO: o módulo autônomo (envio sozinho com cadência humana e respostas no modo "segurar") entra por cima
// desta fila: ele chama prepare() e, em vez de esperar a pessoa, envia; e consulta POST /extension/plantao/reply.
const MONTHS = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };

// "17:09" → 0 dias; "Ontem" → 1; "set 25" ou "25/09" → diferença de dias; outro → null (não dá para saber)
function daysSilent(when, now = new Date()) {
  const w = String(when || '').trim().toLowerCase();
  if (!w) return null;
  if (/^\d{1,2}:\d{2}$/.test(w) || /agora|hoje/.test(w)) return 0;
  if (/ontem/.test(w)) return 1;
  const m = w.match(/^([a-zç]{3})\.?\s+(\d{1,2})$/) || w.match(/^(\d{1,2})\s+(?:de\s+)?([a-zç]{3})/);
  if (m) {
    const mon = MONTHS[isNaN(+m[1]) ? m[1] : m[2]], day = +(isNaN(+m[1]) ? m[2] : m[1]);
    if (mon == null || !day) return null;
    let d = new Date(now.getFullYear(), mon, day); if (d > now) d = new Date(now.getFullYear() - 1, mon, day);
    return Math.max(0, Math.round((now - d) / 86400000));
  }
  const dm = w.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (dm) { let y = dm[3] ? +dm[3] : now.getFullYear(); if (y < 100) y += 2000; let d = new Date(y, +dm[2] - 1, +dm[1]); if (d > now && !dm[3]) d = new Date(y - 1, +dm[2] - 1, +dm[1]); return Math.max(0, Math.round((now - d) / 86400000)); }
  return null;
}
const hm = (d) => d.getHours() * 60 + d.getMinutes();
const parseHM = (s) => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };
// dentro da janela? Janela que cruza a meia-noite (22:00–02:00) conta o dia da semana do início
function inWindow(cfg, now = new Date()) {
  const s = parseHM(cfg.window_start), e = parseHM(cfg.window_end); if (s == null || e == null) return false;
  const cur = hm(now); let day = (now.getDay() + 6) % 7; // 0 = segunda
  let ok;
  if (s <= e) ok = cur >= s && cur < e;
  else { ok = cur >= s || cur < e; if (cur < e) day = (day + 6) % 7; }
  return ok && (cfg.days || []).includes(day);
}

function create(deps) {
  const { api, log, getState, roomKey, onHold } = deps;
  const pl = { configs: [], fetchedAt: 0, rooms: new Map(), recent: new Map(), noted: new Map(), dismissed: new Set(),
    pending: new Map(), // `${creatorId}|${ref}` -> { text, at, name } (texto preenchido, esperando a pessoa enviar)
    sent: new Map(),    // `${creatorId}|${ref}` -> { text, at, name, replied }
  };
  const enabled = () => { const u = getState().user; return !!(u && (u.owner || (u.perms || []).includes('plantao'))); };

  async function fetchConfigs() {
    if (!enabled()) { pl.configs = []; return; }
    try {
      const r = await api('GET', '/extension/plantao');
      pl.configs = r.configs || []; pl.fetchedAt = Date.now();
      pl.dismissed = new Set((r.dismissed || []).map((d) => d.join('|')));
      for (const c of pl.configs) { pl.recent.set(c.creator_id, new Set(c.recent_fans || [])); pl.noted.set(c.creator_id, new Set(c.noted_fans || [])); }
    } catch (e) { log('config', e.message); }
  }
  // chamado a cada leitura das conversas (10 s): guarda a lista e confere envios/respostas pendentes
  function onRooms(creatorId, rooms) {
    if (!enabled() || !Array.isArray(rooms)) return;
    pl.rooms.set(creatorId, rooms);
    for (const r of rooms) {
      if (!r.name) continue;
      const key = `${creatorId}|${roomKey(creatorId, r.name)}`;
      const p = pl.pending.get(key);
      if (p && r.ours && daysSilent(r.when) === 0) {
        pl.pending.delete(key); pl.sent.set(key, { ...p, sentAt: Date.now(), replied: false });
        (pl.recent.get(creatorId) || pl.recent.set(creatorId, new Set()).get(creatorId)).add(key.split('|')[1]);
        api('POST', '/extension/plantao/sent', { creator_id: creatorId, fan_ref: key.split('|')[1], fan_name: getState().fan_names_allowed ? r.name.slice(0, 80) : null, text: p.text, platform: 'privacy' }).catch((e) => log('registrar envio', e.message));
        log('enviada', r.name);
      }
      const s = pl.sent.get(key);
      if (s && !s.replied && !r.ours) {
        s.replied = true; s.repliedAt = Date.now();
        api('POST', '/extension/plantao/replied', { creator_id: creatorId, fan_ref: key.split('|')[1] }).catch(() => {});
        log('respondeu', r.name);
        // // ALTA AUTO: no modo "segurar a conversa" o módulo autônomo assume a próxima resposta
        const cfg = pl.configs.find((x) => x.creator_id === creatorId);
        if (cfg && cfg.after_reply === 'hold' && typeof onHold === 'function') {
          try { onHold({ creatorId, fanRef: key.split('|')[1], name: r.name, rid: r.rid || null }); } catch (e) { log('hold', e.message); }
        }
      }
    }
  }
  function candidates(cfg, creatorId) {
    const rooms = pl.rooms.get(creatorId); if (!rooms) return null;
    const f = cfg.filters || {}; const recent = pl.recent.get(creatorId) || new Set(); const noted = pl.noted.get(creatorId) || new Set();
    const list = [];
    for (const r of rooms) {
      if (!r.name) continue;
      const ref = roomKey(creatorId, r.name); const key = `${creatorId}|${ref}`;
      if (pl.pending.has(key) || pl.sent.has(key) || recent.has(ref)) continue;
      if (f.skip_dismissed && pl.dismissed.has(key)) continue;
      if (f.skip_with_notes && noted.has(ref)) continue;
      const days = daysSilent(r.when); if (days == null || days < (f.inactive_days || 7)) continue;
      if (!f.ghosted && r.ours) continue; // "sumiu depois da criadora responder" desligado: só quem mandou a última
      const spent = r.spent && r.spent.cents ? r.spent.cents : 0;
      if (f.never_spent) { if (spent > 0) continue; }
      else if (f.min_spent_cents != null && spent < f.min_spent_cents) continue;
      list.push({ fan_ref: ref, name: r.name, rid: r.rid || null, days, spent_cents: spent, ghosted: !!r.ours, score: (r.ours ? 1 : 0) * 1000 + Math.min(spent, 100000) / 100 });
    }
    list.sort((a, b) => b.score - a.score);
    return list;
  }
  // a fila completa, por criadora ligada, com a abertura sorteada para cada fã (sem repetir na mesma noite)
  function queue() {
    const st = getState(); const now = new Date(); const out = [];
    const usedTexts = new Set([...pl.sent.values(), ...pl.pending.values()].map((x) => x.text));
    for (const cfg of pl.configs) {
      const c = (st.creators || []).find((x) => x.id === cfg.creator_id); if (!c) continue;
      // candidatos do painel (histórico: última mensagem do FÃ) + o que a lista aberta da Privacy mostrar a mais
      const server = (cfg.candidates || []).map((it) => ({ ...it }));
      const local = candidates(cfg, cfg.creator_id) || [];
      const seen = new Set(server.map((x) => x.fan_ref));
      const items = server.length || pl.rooms.has(cfg.creator_id) ? [...server, ...local.filter((x) => !seen.has(x.fan_ref))].filter((x) => !pl.pending.has(`${cfg.creator_id}|${x.fan_ref}`) && !pl.sent.has(`${cfg.creator_id}|${x.fan_ref}`)) : null;
      const openers = cfg.openers || [];
      const pickText = () => { const pool = openers.filter((o) => !usedTexts.has(o)); const src = pool.length ? pool : openers; return src.length ? src[Math.floor(Math.random() * src.length)] : ''; };
      out.push({ creator_id: cfg.creator_id, creator_name: c.name, in_window: inWindow(cfg, now), in_shift: !!(c.shift && c.shift.active !== false), only_without_shift: cfg.only_without_shift,
        window: `${cfg.window_start}–${cfg.window_end}`, open: items !== null, from_panel: server.length, per_hour: cfg.per_hour,
        items: (items || []).slice(0, 30).map((it) => ({ ...it, text: pickText() })) });
    }
    const pend = [...pl.pending.entries()].map(([k, v]) => ({ key: k, ...v })), sent = [...pl.sent.entries()].map(([k, v]) => ({ key: k, ...v }));
    return { enabled: enabled(), creators: out, pending: pend, sent };
  }
  // a pessoa clicou "Abrir e preencher": quem abre a conversa e preenche é o main.js; aqui só fica a pendência
  function prepared(creatorId, fanRef, name, text) { pl.pending.set(`${creatorId}|${fanRef}`, { text, at: Date.now(), name }); }
  function cancel(creatorId, fanRef) { pl.pending.delete(`${creatorId}|${fanRef}`); }
  // // ALTA AUTO: depois que o plantão responde no modo "segurar", a conversa volta a escutar o fã
  function rearm(creatorId, fanRef) { const s = pl.sent.get(`${creatorId}|${fanRef}`); if (s) s.replied = false; }
  function cfgOf(creatorId) { return pl.configs.find((c) => c.creator_id === creatorId) || null; }
  return { fetchConfigs, onRooms, queue, prepared, cancel, rearm, cfgOf, enabled, inWindow, daysSilent, get configs() { return pl.configs; }, get fetchedAt() { return pl.fetchedAt; } };
}
module.exports = { create, daysSilent, inWindow };
