// Cartão do fã: mostra o que o fã gastou com a criadora atendida, a sugestão, ofertas pendentes e as
// anotações da equipe. Atualiza sozinho quando o chatter troca de conversa. Nada do faturamento da criadora.
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => c == null ? '—' : 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyShort = (c) => c == null ? '—' : c >= 100000 ? 'R$ ' + Math.round(c / 100).toLocaleString('pt-BR') : money(c);
const dur = (sec) => { if (sec == null) return '—'; const m = Math.round(sec / 60); if (m < 1) return 'menos de 1 min'; if (m < 60) return `${m} min`; const h = Math.floor(m / 60); return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`; };
const day = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
const ORIGIN = { chat: 'Chat', subscription: 'Assinatura', renewal: 'Renovação', post: 'Publicação', tip: 'Mimo', unknown: 'Outro' };
const TIER = { baleia: ['Baleia', 'gold'], spender: ['Spender', 'green'] };
const TAG = { esfriando: ['Esfriando', 'amber'], dormente: ['Dormente', ''], novo_sem_compra: ['Novo sem compra', 'green'], assinatura_inativa: ['Assinatura inativa', 'red'] };
let F = null; let draft = '';
const open = (() => { try { return JSON.parse(localStorage.getItem('fan-open') || '{}'); } catch { return {}; } })();
const isOpen = (k, def) => (k in open ? open[k] : def);
const toggle = (k, def) => { open[k] = !isOpen(k, def); try { localStorage.setItem('fan-open', JSON.stringify(open)); } catch {} render(); };
let noteOpen = false;
// padrão de cada quadro (aberto = true); Últimas compras e o detalhe do termômetro vêm recolhidos
const TG_DEFAULT = (k, nNotes) => k === 'memory' ? true : k === 'notes' ? nNotes > 0 : k === 'buys' ? false : k === 'thermo' ? false : true;
const ALL_TG = ['wait', 'resumo', 'memory', 'buys', 'notes', 'prices', 'assist', 'thermo'];
function setAll(openAll) { for (const k of ALL_TG) open[k] = openAll; try { localStorage.setItem('fan-open', JSON.stringify(open)); } catch {} render(); }
// Alta Ajuda (um bloco só): sugestão de mensagem na voz da criadora, a partir do fim da conversa.
// Automática quando a ficha liga "sugestão automática" e o fã falou por último; nas outras, o chatter clica em Sugerir.
// O chatter edita aqui ou na caixa da Privacy e envia. Nada é enviado pelo sistema.
const LV = [['leve', 'Leve'], ['picante', 'Picante'], ['explicito', 'Explícito']];
const AJ_HELP = 'Como usar: quando o fã fala por último, a Alta Ajuda lê o fim da conversa e sugere a resposta na voz da criadora, no tom do perfil do fã. Edite o texto aqui se quiser, clique em Colocar na caixa e envie pela Privacy. Leve/Picante/Explícito refaz a sugestão nesse nível; Outra gera outra versão; 💰 Vender escreve uma oferta de um item da tabela escolhido pelo contexto (dá para trocar o item, ou clicar num item da Tabela de preços acima). Classifique o fã (Servo, Cuck, Baunilha…) para acertar o tom: vale para a equipe toda.';
const STEP = { abertura: 'Abertura', aquecimento: 'Aquecimento', oferta: 'Oferta', fechamento: 'Fechamento', 'pos-venda': 'Pós-venda', reativacao: 'Reativação' };
let AS = null, asFor = null, aj = { help: false, sheet: false, sheetData: null, sheetFor: null };
async function loadAssist(force) {
  const key = F && F.creatorId; if (!key) return;
  if (!force && asFor === key && AS) return;
  asFor = key; AS = await window.pulse.assistStatus(force).catch(() => null); render(); loadSeg(); maybeSuggest(); refreshThermo(true);
}
// tabela de preços da criadora (no cartão do fã); clicar num item gera uma mensagem vendendo aquele item
let PR = { for: null, list: [] };
async function loadPrices() {
  const k = F && F.creatorId; if (!k || PR.for === k || PR.loading === k) return;
  PR = { for: null, list: [], loading: k };
  const r = await window.pulse.assistPrices().catch(() => ({ prices: [] }));
  if (!F || F.creatorId !== k) return;
  PR = { for: k, list: r.prices || [] }; render();
}
// padrão de compra do fã: ticket médio + 20% (arredondado p/ R$ x9,90). A tabela é o piso: nunca sugerir abaixo dela.
const fanAnchor = (card) => (card && card.ticket_cents) ? Math.max(0, Math.ceil(card.ticket_cents * 1.2 / 100) * 100 - 10) : null;
const fanPrice = (cents, card) => { const a = fanAnchor(card); return a ? Math.max(cents, a) : cents; };
const brlS = (c) => 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
function pricesHtml(c) {
  if ((AS && AS.sell === false) || !PR.list.length || !F || !F.fanRef) return '';
  const o = isOpen('prices', true);
  const t = c && c.ticket_cents;
  let h = `<button class="sec-t" data-tg="prices">${o ? '▾' : '▸'} 💰 Tabela de preços <span>${PR.list.length}</span></button>`;
  if (!o) return h;
  h += '<div class="pr-list">';
  PR.list.forEach((p, i) => {
    const fp = fanPrice(p.cents, c); const up = fp > p.cents;
    h += `<button class="pr-row${up ? ' fit' : ''}" data-sell="${i}" title="${esc((p.obs ? p.obs + ' · ' : '') + (up ? `Tabela ${brlS(p.cents)}; este fã paga mais (ticket médio + 20%). ` : '') + 'Clique para gerar uma mensagem vendendo este item')}"><span>${esc(p.item)}</span><b>${up ? `<s>${brlS(p.cents)}</s> ${brlS(fp)}` : brlS(p.cents)}</b></button>`;
  });
  if (t && fanAnchor(c)) h += `<div class="muted" style="font-size:10.5px;margin-top:3px">Este fã paga em média ${brlS(t)}: para ele, nada abaixo de ${brlS(fanAnchor(c))} (ticket + 20%).</div>`;
  return h + '</div>';
}
// termômetro de venda: nota local (palavras do fã, ritmo, histórico do cartão) e, quando há sugestão, a nota da IA
let TH = { key: null, at: 0, local: null };
const CAT_RX = { foto: /foto/i, video: /v[ií]deo/i, avaliacao: /avalia/i, personalizado: /personaliz/i, chamada: /chamada/i };
const CAT_NAME = { foto: 'Fotos', video: 'Vídeo', avaliacao: 'Avaliação', personalizado: 'Personalizado', chamada: 'Videochamada' };
function pickProduct(cat, card) {
  const list = PR.list || []; if (!list.length) return null;
  let pool = cat ? list.filter((p) => CAT_RX[cat].test(p.item) && (cat === 'video' ? !/chamada|personaliz/i.test(p.item) : true)) : [];
  if (cat && !pool.length) return { missing: CAT_NAME[cat] };
  if (!pool.length) return null;
  const lvl = (SG.level || (AS && AS.max_level)) === 'explicito';
  if (lvl && pool.some((p) => /expl/i.test(p.item))) pool = pool.filter((p) => /expl/i.test(p.item));
  const a = fanAnchor(card);
  // com histórico: o item de tabela mais alto que cabe no padrão dele (ou o primeiro acima); sem histórico: o mais barato
  let p = pool.reduce((x, y) => (y.cents < x.cents ? y : x));
  if (a) { const under = pool.filter((x) => x.cents <= a); p = under.length ? under.reduce((x, y) => (y.cents > x.cents ? y : x)) : p; }
  return { ...p, cents: fanPrice(p.cents, card), table: p.cents };
}
async function refreshThermo(force) {
  if (!AS || AS.thermo === false || !AS.manual || !F || !F.fanRef || F.collapsed) return;
  const key = `${fanKey()}|${F.waitSince || 'nossa'}`;
  if (!force && TH.key === key && Date.now() - TH.at < 8000) return;
  if (TH.busy) return; TH.busy = true;
  const r = await window.pulse.thermoRead({ extra: AS.hot_terms || [] }).catch(() => null);
  TH.busy = false;
  if (!r || r.fanRef !== F.fanRef) return;
  TH = { key, at: Date.now(), local: r }; renderAssist();
}
function thermoNow() {
  if (AS && AS.thermo === false) return null;
  const L = TH.local; if (!L || TH.key == null || !TH.key.startsWith(fanKey() || '-')) return null;
  const card = F && F.card;
  let score = L.score; const why = [...L.why];
  if (card) {
    if (card.purchases) { score += 10; why.push(`já comprou ${card.purchases}x${card.ticket_cents ? ` (ticket ${brlS(card.ticket_cents)})` : ''}`); }
    if (fanAnchor(card) && (PR.list || []).some((p) => p.cents < fanAnchor(card))) why.push(`paga acima da tabela: oferecer a partir de ${brlS(fanAnchor(card))}`);
    if (card.tier === 'baleia') score += 10;
    if ((card.pending_offers || []).length) { score += 10; why.push('tem oferta enviada sem pagar'); }
    if ((card.tags || []).includes('assinatura_inativa')) score -= 10;
  }
  let ai = null;
  const r = SG.res; if (r && r.temperature != null && SG.key && SG.key.startsWith(fanKey() || '-')) ai = r;
  if (ai) { score = Math.round((score + ai.temperature) / 2); if (ai.temp_reason) why.unshift(ai.temp_reason); }
  if (L.cold) score = Math.min(score, 40) - 15;
  score = Math.max(0, Math.min(100, score));
  const band = L.cold ? 'cool' : score >= 65 ? 'fire' : score >= 45 ? 'hot' : score >= 20 ? 'warm' : 'cold';
  return { score, band, why: [...new Set(why)].slice(0, 4), cat: L.cat, cold: L.cold, ai: !!ai };
}
const BAND = { cold: ['🌡', 'Frio', 'Só aquecendo. Ainda não é hora de vender.'], warm: ['🌡', 'Morno', 'Continue esquentando.'], hot: ['🌡', 'Quente', 'Prepare a oferta.'], fire: ['🔥', 'Hora de vender', ''], cool: ['❄', 'Esfriando', ''] };
function thermoHtml() {
  const t = thermoNow(); if (!t) return '';
  const [ico, label, hint] = BAND[t.band];
  // só a barra fica à vista; os motivos abrem na seta (a escolha fica guardada). A caixa de venda continua visível.
  const why = t.why.length ? esc(t.why.join(' · ')) : esc(hint);
  const openWhy = isOpen('thermo', false);
  let h = `<div class="th ${t.band}" title="Nota ${t.score}/100${t.ai ? ' (palavras do fã + leitura da IA)' : ' (palavras do fã e histórico)'}"><div class="th-top" id="th-toggle" style="cursor:pointer"><span class="th-ico">${ico}</span><div class="th-bar"><i style="width:${Math.max(6, t.score)}%"></i></div><span class="th-lbl">${label}</span><span class="th-arrow">${openWhy ? '▾' : '▸'}</span></div>`;
  if (openWhy) {
    if (t.band === 'cool') h += `<div class="th-cool">Objeção: <b>${esc(t.cold)}</b>. Use o prazo; não baixe o preço do mesmo item.</div>`;
    if (why) h += `<div class="th-why">${why}</div>`;
  }
  if ((t.band === 'fire' || t.band === 'hot' || t.band === 'cool') && !(AS && AS.sell === false)) {
    const card = F && F.card;
    const cheap = PR.list.length ? PR.list.reduce((a, b) => (b.cents < a.cents ? b : a)) : null;
    const p = t.band === 'cool' ? (cheap ? { ...cheap, cents: fanPrice(cheap.cents, card) } : null) : pickProduct(t.cat, card);
    if (p && p.missing) h += `<div class="th-sell"><span>${esc(p.missing)} <i>sem preço na tabela</i></span><button class="btn sell ico" id="th-sell" title="Vender: a IA escolhe o item pela conversa">💰</button></div>`;
    else if (p) h += `<div class="th-sell"><span>${t.band === 'cool' ? 'Alternativa menor' : 'Sugerido'}: <b>${esc(p.item)} · ${brlS(p.cents)}</b></span><button class="btn sell ico" id="th-sell" data-item="${esc(p.item)}" title="${t.band === 'cool' ? 'Oferecer' : 'Vender agora'}: ${esc(p.item)}">💰</button></div>`;
    else if (t.band === 'fire') h += `<div class="th-sell"><span>A IA escolhe o item pela conversa</span><button class="btn sell ico" id="th-sell" title="Vender agora: a IA escolhe o item pela conversa">💰</button></div>`;
  }
  return h + '</div>';
}
// memória do fã (confirmada pelo chatter; separada por criadora)
const KIND_ICO = { sobre: '👤', gostos: '❤', fantasia: '🔥', momento: '📅', compras: '🛒' };
let MEM = { for: null, facts: [], skip: false };
async function loadMem(force) {
  const k = fanKey(); if (!k || (!force && (MEM.for === k || MEM.loading === k))) return;
  MEM = { ...MEM, loading: k };
  const r = await window.pulse.fanMemGet().catch(() => ({ facts: [] }));
  if (fanKey() !== k) return;
  MEM = { for: k, facts: r.facts || [], skip: !!r.skip_connection }; render();
}
function memHtml() {
  if (!F || !F.fanRef || MEM.for !== fanKey()) return '';
  const n = MEM.facts.length; const o = isOpen('memory', true);
  let h = `<button class="sec-t" data-tg="memory">${o ? '▾' : '▸'} 🧠 Memória do fã <span>${n}</span>${!o && n ? `<span class="mini-line">${esc(MEM.facts.slice(0, 2).map((f) => f.text).join(' · '))}</span>` : ''}</button>`;
  if (!o) return h;
  if (!n) h += '<div class="muted" style="font-size:11px">Nada anotado ainda. O que ele contar no chat aparece como sugestão na Alta Ajuda.</div>';
  for (const f of MEM.facts) h += `<div class="mem-row" title="${esc((f.by_name || '') + (f.created_at ? ' · ' + day(f.created_at) : ''))}"><span>${KIND_ICO[f.kind] || '•'} ${esc(f.text)}${f.date ? ` <small>(${day(f.date + 'T12:00:00')})</small>` : ''}</span><button class="icon del" data-memdel="${esc(f.id)}" title="Apagar">×</button></div>`;
  h += `<div class="mem-add"><input id="mem-new" maxlength="140" placeholder="Anotar algo sobre ele (Enter salva)"></div>`;
  return h;
}
// perfil do fã (classificação da equipe)
let SEG = { for: null, value: '', by: null, busy: false };
const segList = () => (AS && AS.segments) || [];
const fanKey = () => (F && F.creatorId && F.fanRef) ? `${F.creatorId}|${F.fanRef}` : null;
async function loadSeg() {
  const k = fanKey(); if (!k || !segList().length || SEG.for === k || SEG.loading === k) return;
  SEG = { for: null, value: '', by: null, loading: k };
  const r = await window.pulse.fanSegGet().catch(() => ({ segment: '' }));
  if (fanKey() !== k) return;
  SEG = { for: k, value: r.segment || '', by: r.by || null }; renderAssist(); maybeSuggest();
}
async function setSeg(value) {
  const k = fanKey(); if (!k) return;
  const prev = SEG.value; SEG = { ...SEG, value, busy: true }; renderAssist();
  try { const r = await window.pulse.fanSegSet(value); if (fanKey() === k) SEG = { for: k, value: r.segment || '', by: r.by || null }; }
  catch (err) { SEG = { ...SEG, value: prev }; alertLine(err.message); }
  SEG.busy = false; renderAssist();
  if (SG.key && SG.key.startsWith(k)) runSuggest(SG.key, {}); // refaz no tom do novo perfil
}
function segHtml() {
  const list = segList(); if (!list.length) return '';
  const ready = SEG.for === fanKey();
  const dflt = list.find((x) => x.default) || list[0];
  const tip = SEG.value ? `Classificado${SEG.by ? ` por ${SEG.by}` : ''}. Clique de novo para tirar.` : `Sem classificação: a sugestão usa ${dflt.label}.`;
  return `<div class="seg" title="${esc(tip)}"><span>Perfil do fã</span>${list.map((x) => `<button class="seg-b${ready && SEG.value === x.key ? ' on' : ''}" data-seg="${esc(x.key)}" ${!ready || SEG.busy ? 'disabled' : ''}>${esc(x.label)}</button>`).join('')}</div>`;
}
// sugestão: uma por fã e momento da conversa
let SG = { key: null }, sgTimer = null;
const baseKey = () => (AS && AS.manual && F && F.active && F.fanRef && !F.collapsed && (!segList().length || SEG.for === fanKey())) ? `${F.creatorId}|${F.fanRef}|${F.waitSince || 'nossa'}` : null;
function maybeSuggest() {
  const k = baseKey();
  if (!k) { if (SG.key) { SG = { key: null }; renderAssist(); } return; }
  if (SG.key === k) return;
  SG = { key: k }; // conversa nova ou o fã falou de novo: limpa a sugestão anterior
  if (AS.suggest && F.waitSince) { SG.busy = true; clearTimeout(sgTimer); sgTimer = setTimeout(() => runSuggest(k, {}), 600); }
  renderAssist();
}
async function runSuggest(k, { style, level, product } = {}) {
  if (!k) return;
  if (SG.key !== k) SG = { key: k };
  const mode = F && F.waitSince ? 'reply' : 'followup';
  SG = { key: k, busy: true, level: level || SG.level }; renderAssist();
  try {
    const res = await window.pulse.assistSuggest({ style, level, mode, product, temp: (thermoNow() || {}).score });
    if (SG.key !== k) return;
    if (res && res.skip) { SG = { key: k }; renderAssist(); return; }
    SG = { key: k, res, text: res.text || '', level: res.level }; if (res && res.remaining != null && AS) AS.remaining = res.remaining;
  } catch (err) { if (SG.key !== k) return; SG = { key: k, err: String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }; }
  renderAssist();
}

function render() {
  const typing = document.activeElement && document.activeElement.id;
  if (typing !== 'note' && typing !== 'mem-new') renderBody();
  if (typing !== 'aj-text') renderAssist();
}
function renderBody() {
  const collapsed = !!(F && F.collapsed);
  $('collapsed').classList.toggle('hidden', !collapsed); $('panel').classList.toggle('hidden', collapsed);
  $('collapsed').classList.toggle('has-fan', !!(F && F.fanRef && F.active));
  if (collapsed) return;
  const c = F && F.card;
  $('av').textContent = F && F.name ? F.name.trim()[0].toUpperCase() : '?';
  $('name').textContent = F && F.name ? F.name : 'Cartão do fã';
  let chips = '';
  if (c && (F.subAtiva === true || F.subAtiva === false)) {
    // a própria conversa da Privacy diz se é assinante (aviso no rodapé): vale mais que a lista lida de horas atrás
    const sub = c.subscription || {};
    c.subscription = { ...sub, active: F.subAtiva, status: F.subAtiva ? 'Ativa' : (sub.active === false && sub.status ? sub.status : 'Não assinante') };
    c.tags = (c.tags || []).filter((t) => t !== 'assinatura_inativa');
    if (!F.subAtiva) c.tags.push('assinatura_inativa');
  } else if (c && F.chatting && c.subscription && c.subscription.active === false) {
    // conversando hoje/ontem = tem acesso; a linha "inativa" da lista é de uma assinatura antiga
    c.subscription = { ...c.subscription, status: null, active: null }; c.tags = (c.tags || []).filter((t) => t !== 'assinatura_inativa');
  }
  if (c) {
    if (TIER[c.tier]) chips += `<span class="chip ${TIER[c.tier][1]}">${TIER[c.tier][0]}</span>`;
    for (const t of c.tags || []) if (TAG[t]) chips += `<span class="chip ${TAG[t][1]}">${TAG[t][0]}${t === 'esfriando' && c.days_since_last != null ? ` · ${c.days_since_last} dias` : ''}</span>`;
    if (c.subscription && c.subscription.active) chips += '<span class="chip green">Assinante ativo</span>';
  }
  $('chips').innerHTML = chips;
  const b = $('body');
  if (!F || !F.active || !F.fanRef) {
    b.innerHTML = `<div class="empty">${F && F.error ? esc(F.error) : 'Abra uma conversa (Privacy, OnlyFans ou FatalFans) para ver quem é o fã: quanto já gastou, o que costuma comprar e as anotações da equipe.'}</div>`;
    return;
  }
  if (!c) { b.innerHTML = `<div class="empty">${F.error ? esc(F.error) : 'Carregando o cartão…'}</div>`; return; }
  let h = '';
  // quadros minimizáveis: cada chatter guarda o próprio jeito (localStorage). Recolhido mostra uma linha com o essencial.
  // esperando resposta: nunca some, só encolhe; acima da meta fica vermelho mesmo encolhido
  if (F.waitSince) { const sec = (Date.now() - new Date(F.waitSince).getTime()) / 1000; const late = sec > (F.sla || 5) * 60;
    h += isOpen('wait', true) ? `<div class="wait ${late ? 'late' : ''} tgl" data-tg="wait" title="Clique para encolher">Esperando sua resposta há <b>${dur(sec)}</b>${late ? ' · acima da meta' : ''}</div>`
      : `<div class="wait mini ${late ? 'late' : ''} tgl" data-tg="wait" title="Esperando sua resposta (clique para abrir)">⏱ <b>${dur(sec)}</b>${late ? ' · acima da meta' : ''}</div>`; }
  const OT = { request: 'Solicitação de mídia', ppv: 'Mídia paga' }; const MT = { photo: 'foto', video: 'vídeo', mixed: 'foto e vídeo' };
  const ro = isOpen('resumo', true);
  const resumoMini = c.purchases ? `💳 ${moneyShort(c.total_cents)} · ticket ${moneyShort(c.ticket_cents)} · ${c.days_since_last === 0 ? 'hoje' : `há ${c.days_since_last} d`}` : '💳 sem compras';
  h += `<button class="sec-t" data-tg="resumo">${ro ? '▾' : '▸'} Resumo do fã ${ro ? '' : `<span class="mini-line">${resumoMini}${(c.pending_offers || []).length ? ' · oferta sem pagar' : ''}</span>`}</button>`;
  if (ro) {
    if (c.response) { const r = c.response; const parts = [];
      if (r.mine_avg_seconds != null) parts.push(`seu tempo médio: <b>${dur(r.mine_avg_seconds)}</b>`);
      parts.push(`equipe: <b>${dur(r.avg_seconds)}</b>`);
      if (r.last_seconds != null) parts.push(`última: ${dur(r.last_seconds)}`);
      h += `<div class="resp">Resposta a este fã (30 dias) · ${parts.join(' · ')}</div>`; }
    const subLine = c.subscription && (c.subscription.status || c.subscription.price_cents != null) ? `Assinatura${c.subscription.status ? `: <b>${esc(c.subscription.status)}</b>` : ''}${c.subscription.price_cents != null ? ` · ${money(c.subscription.price_cents)}` : ''}${c.subscription.duration ? ` · ${esc(c.subscription.duration)}` : ''}<br>` : '';
    if (!c.purchases) h += `<div class="sub">${subLine}Primeira compra ainda não registrada.</div>`;
    else h += `<div class="nums"><div><span>Gasto total</span><b>${moneyShort(c.total_cents)}</b></div><div><span>Ticket médio</span><b>${moneyShort(c.ticket_cents)}</b></div><div><span>Última compra</span><b>${c.days_since_last === 0 ? 'hoje' : `há ${c.days_since_last} d`}</b></div></div>`;
    if (c.suggestion) h += `<div class="tip"><b>Sugestão:</b> ${esc(c.suggestion)}</div>`;
    for (const o of c.pending_offers || []) h += `<div class="pend">${OT[o.offer_type] || 'Oferta'}${MT[o.media_type] ? ` (${MT[o.media_type]})` : ''} de ${money(o.amount_cents)} ainda não paga · enviada ${day(o.offered_at)}</div>`;
  }
  h += memHtml();
  if (c.task) h += `<div class="sub">Na sua lista${c.task.reason ? `: ${esc(c.task.reason)}` : ''}.<br><button class="btn" id="contacted" style="width:100%;margin-top:6px">Marcar como contatado</button></div>`;
  const recent = c.recent || [];
  if (recent.length) {
    const o = isOpen('buys', false);
    h += `<button class="sec-t" data-tg="buys">${o ? '▾' : '▸'} Últimas compras <span>${recent.length}</span></button>`;
    if (o) for (const r of recent) h += `<div class="row"><span>${day(r.at)} · ${ORIGIN[r.origin] || 'Outro'}</span>${money(r.amount_cents)}</div>`;
  }
  const notes = c.notes || []; const on = isOpen('notes', notes.length > 0) || noteOpen;
  h += `<div class="sec-row"><button class="sec-t" data-tg="notes">${on ? '▾' : '▸'} Anotações da equipe <span>${notes.length}</span></button><button class="icon add-note" id="add-note" title="Escrever uma anotação sobre este fã para a equipe">+ anotação</button></div>`;
  if (on) {
    for (const n of notes) {
      const mine = F.user && (n.author_id === F.user.id || F.user.role !== 'chatter');
      h += `<div class="note">${esc(n.text)}<small>${esc(n.author_name)} · ${day(n.created_at)}</small>${mine ? `<button class="icon del" data-del="${esc(n.id)}" title="Apagar">×</button>` : ''}</div>`;
    }
    if (!notes.length && !noteOpen) h += '<div class="muted">Nenhuma anotação ainda.</div>';
  }
  if (noteOpen || draft) h += `<textarea id="note" maxlength="300" placeholder="Escrever anotação (Enter salva, Esc cancela)">${esc(draft)}</textarea><div class="muted" style="font-size:10px">Nada de telefone, endereço ou dado de saúde.</div>`;
  h += pricesHtml(c);
  if (F.loading) h += '<div class="loading">atualizando…</div>';
  b.innerHTML = h;
  b.querySelectorAll('[data-sell]').forEach((x) => x.addEventListener('click', () => { const p = PR.list[+x.dataset.sell]; if (p) runSuggest(SG.key || baseKey(), { style: 'vendedora', product: p.item, level: SG.level }); }));
  b.querySelectorAll('[data-tg]').forEach((x) => x.addEventListener('click', () => toggle(x.dataset.tg, TG_DEFAULT(x.dataset.tg, notes.length))));
  $('add-note').addEventListener('click', () => { noteOpen = true; open.notes = true; render(); const t = $('note'); if (t) t.focus(); });
  const ta = $('note');
  if (ta) ta.addEventListener('input', () => { draft = ta.value; });
  if (ta) ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { noteOpen = false; draft = ''; render(); } });
  if (ta) ta.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return; e.preventDefault();
    const text = ta.value.trim(); if (!text) return;
    ta.disabled = true;
    try { await window.pulse.fanNoteAdd(text); draft = ''; noteOpen = false; } catch (err) { alertLine(err.message); } finally { ta.disabled = false; }
  });
  b.querySelectorAll('[data-memdel]').forEach((x) => x.addEventListener('click', async () => { await window.pulse.fanMemDel(x.dataset.memdel).catch((err) => alertLine(err.message)); loadMem(true); }));
  const mn = $('mem-new'); if (mn) mn.addEventListener('keydown', async (e) => { if (e.key !== 'Enter' || !mn.value.trim()) return; e.preventDefault(); mn.disabled = true;
    try { await window.pulse.fanMemAdd([{ kind: 'sobre', text: mn.value.trim() }]); } catch (err) { alertLine(err.message); } loadMem(true); });
  b.querySelectorAll('[data-del]').forEach((x) => x.addEventListener('click', () => window.pulse.fanNoteDel(x.dataset.del).catch((err) => alertLine(err.message))));
  const ct = $('contacted'); if (ct) ct.addEventListener('click', () => window.pulse.fanContacted(c.task.id).catch((err) => alertLine(err.message)));
}
function renderAssist() {
  const box = $('assist');
  const show = !!(AS && AS.enabled && F && F.active && F.fanRef && !F.collapsed);
  box.classList.toggle('hidden', !show);
  if (!show) { box.innerHTML = ''; return; }
  if (aj.sheetFor !== F.creatorId) aj = { ...aj, sheet: false, sheetData: null, sheetFor: F.creatorId };
  const ajOpen = isOpen('assist', true);
  let h = `<div class="aj-head"><b id="aj-tg" class="tgl" title="${ajOpen ? 'Recolher a Alta Ajuda' : 'Abrir a Alta Ajuda'}">${ajOpen ? '▾' : '▸'} Alta Ajuda</b><span class="aj-meta">${!AS.has_prices ? '<span class="aj-warn" title="Esta criadora ainda não tem tabela de preços. Valores aparecem como [preço]. O gestor preenche na ficha (painel → Criadoras).">sem tabela</span>' : ''}<span class="muted" title="Ajudas que você ainda pode pedir hoje">${AS.remaining} hoje</span><button class="icon aj-sheet${aj.sheet ? ' on' : ''}" id="aj-sheet" title="Ficha da criadora: persona, limites e tabela de preços">▦</button><button class="icon aj-q" id="aj-help" title="${esc(AJ_HELP)}">?</button></span></div>`;
  if (!ajOpen) {
    // recolhida: uma linha com perfil e termômetro; "Hora de vender" pisca; alerta de menor nunca some
    const t = thermoNow(); const seg = segList().find((x) => x.key === SEG.value);
    const BL = { cold: 'Frio', warm: 'Morno', hot: 'Quente', fire: 'Hora de vender', cool: 'Esfriando' };
    h += `<div class="aj-mini tgl${t && t.band === 'fire' ? ' fire' : ''}" id="aj-mini" title="Abrir a Alta Ajuda">${seg ? `perfil ${esc(seg.label)}` : (segList().length ? 'perfil não classificado' : '')}${t ? `${seg || segList().length ? ' · ' : ''}🌡 ${BL[t.band]}` : ''}${SG.res && !SG.res.alert ? ' · sugestão pronta' : ''}</div>`;
    if (SG.res && SG.res.alert) h += `<div class="tip"><b>Atenção:</b> possível menor de idade (${esc(SG.res.reason)}). Não ofereça conteúdo.</div>`;
    box.innerHTML = h; bindAssist(); return;
  }
  if (aj.help) h += `<div class="aj-help">${esc(AJ_HELP)}</div>`;
  if (aj.sheet) h += sheetHtml();
  h += segHtml();
  h += thermoHtml();
  if (!AS.manual) { box.innerHTML = h + '<div class="muted aj-note">A ficha desta criadora ainda não foi preenchida no painel.</div>'; bindAssist(); return; }
  const r = SG.res;
  const lvMax = Math.max(0, LV.findIndex(([v]) => v === ((r && r.max_level) || AS.max_level)));
  if (SG.busy) h += '<div class="sg-meta">Lendo a conversa e escrevendo na voz da criadora…</div>';
  else if (SG.err) h += `<div class="pend">${esc(SG.err)}</div>`;
  else if (r && r.alert) h += `<div class="tip"><b>Atenção:</b> possível menor de idade (${esc(r.reason)}). Nada foi gerado e o gestor foi avisado. Não ofereça conteúdo.</div>`;
  else if (r) {
    const SIT = { novo: 'Fã novo', cliente: 'Cliente que volta', sumido: 'Sumido', voltando: 'Ex-assinante voltando' };
    const meta = [r.phase ? `🤝 Conexão ${r.phase.turn}/${r.phase.of}` : '', SIT[r.situation] && !r.phase ? `Começo de conversa: ${SIT[r.situation]}` : '', STEP[r.step] ? `Passo: ${STEP[r.step]}` : '', r.objection ? `objeção: ${r.objection}` : ''].filter(Boolean).join(' · ');
    if (meta) h += `<div class="sg-meta">${esc(meta)}${r.phase ? ' · <a href="#" id="sg-skipconn" title="Encerrar a fase de conexão com este fã e seguir o roteiro de venda">pular conexão</a>' : ''}</div>`;
    h += `<textarea id="aj-text" rows="3" maxlength="1500" title="Edite à vontade antes de colocar na caixa">${esc(SG.text)}</textarea>`;
    if (r.product) h += `<div class="sg-prod">Vendendo: <b>${esc(r.product.item)} · ${brlS(r.product.cents)}</b>${r.product.table_cents && r.product.table_cents < r.product.cents ? ` <span class="muted" title="Este fã paga acima da tabela (ticket médio + 20%)">tabela ${brlS(r.product.table_cents)}</span>` : ''}${PR.list.length > 1 ? ` <select id="sg-swap" title="Trocar o produto (refaz a mensagem)"><option value="">trocar…</option>${PR.list.map((p) => `<option value="${esc(p.item)}">${esc(p.item)} · ${brlS(p.cents)}</option>`).join('')}</select>` : ''}</div>`;
    if (r.warning) h += `<div class="sg-warn">${esc(r.warning)}</div>`;
    const nf = (r.facts || []).filter((f) => !f.saved);
    if (nf.length) h += `<div class="mem-sug"><b>🧠 Anotar na memória?</b>${nf.map((f, i) => `<label><input type="checkbox" data-fact="${i}" checked> ${KIND_ICO[f.kind] || '•'} ${esc(f.text)}</label>`).join('')}<button class="btn ghost" id="mem-save">Salvar</button></div>`;
    const sug = r.suggested_segment && !SEG.value && segList().find((x) => x.key === r.suggested_segment);
    if (sug) h += `<div class="sg-seg">Parece <b>${esc(sug.label)}</b>. <button class="btn ghost" id="sg-class" data-k="${esc(sug.key)}">Classificar como ${esc(sug.label)}</button></div>`;
    if (r.price_fixed) h += '<div class="muted aj-note">Um valor fora da tabela virou [preço]. Complete antes de enviar.</div>';
  } else {
    h += `<div class="sg-act"><button class="btn aj-go" id="sg-start" style="flex:1">${F.waitSince ? 'Sugerir resposta' : 'Puxar conversa'}</button>${AS.sell === false ? '' : '<button class="btn sell ico" id="sg-sell" title="Vender: refaz a mensagem para vender um item da tabela, escolhido pela conversa">💰</button>'}</div>`;
  }
  if (r && !r.alert && !SG.busy) {
    h += `<div class="aj-levels" title="Refaz a sugestão nesse nível. O máximo é o da ficha.">${LV.slice(0, lvMax + 1).map(([v, l]) => `<button class="aj-lv ${v === SG.level ? 'on' : ''}" data-lv="${v}">${l}</button>`).join('')}</div>`;
    h += `<div class="sg-act"><button class="btn" id="sg-use" title="Coloca na caixa de mensagem da Privacy. Revise e envie.">Colocar na caixa</button><button class="btn ghost" id="sg-again">Outra</button>${AS.sell === false ? '' : `<button class="btn sell ico${(thermoNow() || {}).band === 'fire' ? ' glow' : ''}" id="sg-sell" title="Vender: refaz a mensagem para vender um item da tabela, escolhido pela conversa">💰</button>`}</div>`;
  } else if (SG.err) h += '<div class="sg-act"><button class="btn ghost" id="sg-again">Tentar de novo</button></div>';
  box.innerHTML = h;
  const ta = $('aj-text');
  if (ta) { const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; }; grow(); ta.addEventListener('input', () => { SG.text = ta.value; grow(); }); }
  bindAssist();
}

// ficha da criadora (preenchida pelo gestor no painel): preços primeiro, depois limites e persona
const brl = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',').replace(',00', '');
function sheetHtml() {
  const p = aj.sheetData;
  if (!p) return '<div class="aj-sheetbox muted">Carregando a ficha…</div>';
  if (p.error) return `<div class="aj-sheetbox pend">${esc(p.error)}</div>`;
  let s = '<div class="aj-sheetbox">';
  if ((p.prices || []).length) s += `<div class="aj-st">Preços mínimos</div><table class="aj-prices">${p.prices.map((x) => `<tr><td>${esc(x.item)}</td><td>${brl(x.cents)}</td></tr>${x.obs ? `<tr><td colspan="2" class="muted">${esc(x.obs)}</td></tr>` : ''}`).join('')}</table>`;
  else s += '<div class="muted">Sem tabela de preços.</div>';
  if (p.limits) s += `<div class="aj-st">Não faz</div><div>${esc(p.limits)}</div>`;
  for (const f of p.fields || []) s += `<div class="aj-st">${esc(f.label)}</div><div>${esc(f.value)}</div>`;
  if (!(p.fields || []).length && !p.limits) s += '<div class="muted">A ficha ainda não foi preenchida no painel.</div>';
  return s + '</div>';
}
function bindAssist() {
  const sh = $('aj-sheet'); if (sh) sh.addEventListener('click', async () => {
    aj.sheet = !aj.sheet; if (aj.sheet) { aj.sheetData = null; renderAssist(); try { aj.sheetData = await window.pulse.assistProfile(); } catch (err) { aj.sheetData = { error: err.message }; } }
    renderAssist();
  });
  const help = $('aj-help'); if (help) help.addEventListener('click', () => { aj.help = !aj.help; renderAssist(); });
  document.querySelectorAll('#assist [data-seg]').forEach((x) => x.addEventListener('click', () => setSeg(SEG.value === x.dataset.seg ? '' : x.dataset.seg)));
  const k = SG.key || baseKey();
  const start = $('sg-start'); if (start) start.addEventListener('click', () => { if (!SG.key) SG = { key: k }; runSuggest(SG.key, {}); });
  document.querySelectorAll('[data-lv]').forEach((b) => b.addEventListener('click', () => runSuggest(SG.key, { level: b.dataset.lv })));
  const again = $('sg-again'); if (again) again.addEventListener('click', () => runSuggest(SG.key, { level: SG.level }));
  const sell = $('sg-sell'); if (sell) sell.addEventListener('click', () => runSuggest(SG.key || k, { style: 'vendedora', level: SG.level }));
  const swap = $('sg-swap'); if (swap) swap.addEventListener('change', () => { if (swap.value) runSuggest(SG.key, { style: 'vendedora', product: swap.value, level: SG.level }); });
  const ajt = () => { open.assist = !isOpen('assist', true); try { localStorage.setItem('fan-open', JSON.stringify(open)); } catch {} renderAssist(); };
  const ajtg = $('aj-tg'); if (ajtg) ajtg.addEventListener('click', ajt);
  const ajm = $('aj-mini'); if (ajm) ajm.addEventListener('click', ajt);
  const tg = $('th-toggle'); if (tg) tg.addEventListener('click', () => { open.thermo = !isOpen('thermo', false); try { localStorage.setItem('fan-open', JSON.stringify(open)); } catch {} renderAssist(); });
  const ths = $('th-sell'); if (ths) ths.addEventListener('click', () => runSuggest(SG.key || k, { style: 'vendedora', product: ths.dataset.item || '', level: SG.level }));
  const sk = $('sg-skipconn'); if (sk) sk.addEventListener('click', async (e) => { e.preventDefault(); await window.pulse.fanConnSkip(true).catch(() => {}); runSuggest(SG.key, { level: SG.level }); });
  const ms = $('mem-save'); if (ms) ms.addEventListener('click', async () => {
    const nf = (SG.res.facts || []).filter((f) => !f.saved); const pick = [...document.querySelectorAll('[data-fact]')].filter((x) => x.checked).map((x) => nf[+x.dataset.fact]).filter(Boolean);
    if (!pick.length) { SG.res.facts = []; renderAssist(); return; }
    ms.disabled = true;
    try { await window.pulse.fanMemAdd(pick.map((f) => ({ kind: f.kind, text: f.text, date: f.date || '' }))); SG.res.facts = []; loadMem(true); } catch (err) { alertLine(err.message); ms.disabled = false; }
    renderAssist();
  });
  const cl = $('sg-class'); if (cl) cl.addEventListener('click', () => setSeg(cl.dataset.k));
  const use = $('sg-use'); if (use) use.addEventListener('click', async () => {
    const text = ($('aj-text') ? $('aj-text').value : SG.text) || ''; if (!text.trim()) return;
    const r = await window.pulse.assistUse(text).catch(() => ({ filled: false }));
    if (SG.res && SG.res.usage_id && !SG.res.marked) { SG.res.marked = true; window.pulse.assistUsed(SG.res.usage_id); }
    use.textContent = r.filled ? 'Na caixa da Privacy' : 'Copiado (Ctrl+V)';
  });
}

function alertLine(msg) { const d = document.createElement('div'); d.className = 'pend'; d.textContent = String(msg).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); $('body').prepend(d); setTimeout(() => d.remove(), 5000); }

$('collapse').addEventListener('click', () => window.pulse.fanCollapse(true));
// recolher tudo / abrir tudo: se algum quadro está aberto, recolhe todos; senão abre todos
$('fold-all').addEventListener('click', () => { const anyOpen = ['wait', 'resumo', 'notes', 'prices', 'assist'].some((k) => isOpen(k, TG_DEFAULT(k, 1))); setAll(!anyOpen); });
$('collapsed').addEventListener('click', () => window.pulse.fanCollapse(false));
$('collapse').addEventListener('dblclick', () => window.pulse.fanCollapse('auto'));
window.pulse.onFan((f) => {
  // não re-renderiza enquanto o chatter digita uma anotação (evita perder o foco)
  if (!F || f.fanRef !== F.fanRef) { draft = ''; noteOpen = false; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
  F = f; render(); applyMode(); loadAssist(); loadSeg(); loadPrices(); loadMem(); maybeSuggest(); refreshThermo();
});
render();
// o "esperando há" anda sozinho; não re-renderiza enquanto digita uma anotação
setInterval(() => { if (F && F.waitSince && !(document.activeElement && document.activeElement.id === 'note')) render(); }, 30000);
// termômetro: confere a conversa aberta a cada 10 s (só lê; nada é enviado)
setInterval(() => refreshThermo(), 10000);


// ---------- modo Conteúdo (só para quem o admin liberou: Equipe → "Conteúdo: modo Conteúdo no app") ----------
// Troca sozinho pela tela da Privacy: Feed, Postar, Calendário e Meu Privacy = Conteúdo; conversa = Chat.
// A pessoa pode trocar na mão pelas abas; a escolha vale até mudar de tela.
let MODE_MANUAL = null, MODE_PAGE = null, CP = null, cpFor = '', cpAt = 0, cpBusy = false, cpErr = '';
const ctNow = () => (F && F.content) || {};
function wantMode() {
  const ct = ctNow(); if (!ct.allowed) return 'chat';
  if (MODE_MANUAL && MODE_PAGE === ct.page) return MODE_MANUAL;
  MODE_MANUAL = null; return ct.page === 'content' || ct.page === 'mass' ? 'content' : 'chat';
}
function applyMode() {
  const ct = ctNow(); const m = wantMode();
  $('modes').classList.toggle('hidden', !ct.allowed || !!(F && F.collapsed));
  document.body.classList.toggle('mode-content', m === 'content');
  $('modes').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  if (m === 'content') loadContent(false);
}
$('modes').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { MODE_MANUAL = b.dataset.m; MODE_PAGE = ctNow().page; applyMode(); }));
async function loadContent(force) {
  const ct = ctNow(); if (!ct.creatorId) { renderContent(); return; }
  if (!force && cpFor === ct.creatorId && Date.now() - cpAt < 60000) { renderContent(); return; }
  if (cpBusy) return; cpBusy = true; if (cpFor !== ct.creatorId) CP = null; cpFor = ct.creatorId; renderContent();
  try { CP = await window.pulse.contentPanel(); cpErr = ''; cpAt = Date.now(); }
  catch (err) { cpErr = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  finally { cpBusy = false; renderContent(); }
}
const hm = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const isRound = (c) => [0, 90, 99, 50].includes(c % 100);
function uniquePrice(c, used) {
  const base = Math.floor(c / 100) * 100;
  for (const x of [87, 83, 77, 73, 67, 63, 57, 53, 47, 43, 37, 33]) { const v = base + x; if (v !== c && !used.includes(v)) return v; }
  return base + 87;
}
function renderContent() {
  const el = $('content'); const ct = ctNow();
  if (!document.body.classList.contains('mode-content')) return;
  let h = `<div class="ct-head"><b>📣 ${esc(ct.creatorName || 'Conteúdo')}</b><button class="icon" id="ct-reload" title="Atualizar">↻</button></div>`;
  if (ct.page === 'mass') {
    const used = (CP && CP.used_mass_cents) || [], table = (CP && CP.table_cents) || [];
    if (ct.price_cents == null) h += `<div class="sub"><b>Mensagem em massa aberta.</b> Ao pôr preço, use um valor quebrado e diferente dos últimos disparos (ex.: R$ 49,87). Assim o painel mede exatamente quanto este disparo vendeu.</div>`;
    else if (isRound(ct.price_cents) || used.includes(ct.price_cents) || table.includes(ct.price_cents)) {
      const sug = uniquePrice(ct.price_cents, used.concat(table));
      h += `<div class="pend">⚠️ ${money(ct.price_cents)} ${used.includes(ct.price_cents) ? 'já foi usado em outro disparo desta semana' : 'é um valor redondo ou da tabela'}: as vendas vão se misturar com as do chat. Sugestão: <b>${money(sug)}</b>.</div>`;
    } else h += `<div class="ct-ok">✓ ${money(ct.price_cents)} é um valor único: dá para medir exatamente quanto este disparo vendeu.</div>`;
  }
  if (cpErr) { el.innerHTML = h + `<div class="pend">${esc(cpErr)}</div>`; wireContent(); return; }
  if (!CP) { el.innerHTML = h + `<div class="empty">${cpBusy ? 'Carregando…' : 'Abra uma criadora na Privacy.'}</div>`; wireContent(); return; }
  const diff = CP.avg_cents ? Math.round(100 * (CP.today_cents - CP.avg_cents) / CP.avg_cents) : null;
  h += `<div class="nums"><div><span>Vendido hoje</span><b>${moneyShort(CP.today_cents)}</b>${diff != null ? `<span class="${diff >= 0 ? 'ct-up' : 'ct-down'}">${diff >= 0 ? '+' : ''}${diff}% x média</span>` : ''}</div>
    <div><span>Posts hoje</span><b>${CP.posts_today}/${CP.limits.posts}</b></div><div><span>Disparos hoje</span><b>${CP.mass_today}/${CP.limits.mass}</b></div></div>`;
  for (const g of CP.gaps || []) h += `<div class="pend">⏳ ${esc(g)}</div>`;
  h += `<div class="sec">Próximas 48 h</div>`;
  h += (CP.upcoming || []).length ? CP.upcoming.map((i) => `<div class="ct-item"><div class="l1"><span>${i.kind === 'mass' ? '📣 Mensagem em massa' : '🖼 Post'} · ${hm(i.at)}</span><span>${i.price_cents ? money(i.price_cents) : ''}</span></div>${i.text ? `<div class="tx">${esc(i.text)}</div>` : ''}<div class="l3"><span class="muted">${esc(i.author_name || 'sem atribuição')}</span></div></div>`).join('') : '<div class="sub">Nada agendado nas próximas 48 h.</div>';
  const max = Math.max(1, ...(CP.hours || [0]));
  h += `<div class="sec">Vendas por hora (30 dias) · melhores: ${(CP.best_hours || []).map((x) => `${x}h`).join(', ')}</div>
    <div class="ct-hours">${(CP.hours || []).map((v, i) => `<i class="${(CP.best_hours || []).includes(i) ? 'best' : ''}" style="height:${Math.max(2, Math.round(46 * v / max))}px" title="${i}h · ${money(v)}"></i>`).join('')}</div><div class="ct-hl"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>`;
  h += `<div class="sec">Últimos 7 dias</div>`;
  h += (CP.recent || []).length ? CP.recent.map((i) => { const r = i.result || {}; return `<div class="ct-item"><div class="l1"><span>${i.kind === 'mass' ? '📣 Massa' : '🖼 Post'} · ${hm(i.at)}</span><span>${i.price_cents ? money(i.price_cents) : ''}</span></div>${i.text ? `<div class="tx">${esc(i.text)}</div>` : ''}<div class="l3"><span class="muted">${esc(i.author_name || 'sem atribuição')}</span><span><b>${money(r.revenue_cents || 0)}</b> · ${r.purchases || 0} compras${r.quality === 'estimado' ? ' (estim.)' : ''}</span></div></div>`; }).join('') : '<div class="sub">Sem posts ou disparos lidos nos últimos 7 dias. A leitura roda a cada 3 h com a criadora aberta no app.</div>';
  const rd = CP.reads || {};
  h += `<div class="ct-foot">Leitura: posts ${rd.posts_at ? hm(rd.posts_at) : '—'} · calendário ${rd.calendar_at ? hm(rd.calendar_at) : '—'}<br>Análise completa: altapulse.com.br → Conteúdo e disparos.</div>`;
  el.innerHTML = h; wireContent();
}
function wireContent() { const r = $('ct-reload'); if (r) r.addEventListener('click', () => loadContent(true)); }
