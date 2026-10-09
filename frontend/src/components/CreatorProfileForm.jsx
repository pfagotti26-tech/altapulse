import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, dateTime } from '../lib/api';
import { Button, Field, Select, Input } from './Common';

// Ficha da criadora (modelo padrão): NÚCLEO que toda criadora tem + MÓDULOS que o admin liga por criadora.
// Alimenta a Alta Ajuda (sugestões, termômetro, Vender) e a consulta do chatter no app. Só o admin edita.
const LEVELS = [['leve', 'Leve — flerte e insinuação'], ['picante', 'Picante — sensual e provocante'], ['explicito', 'Explícito — linguagem sexual direta']];
const SHORT = new Set(['nome_artistico', 'como_ser_chamada', 'idade', 'cidade_estado', 'status_relacionamento', 'itens_pessoais', 'como_chama_assinantes']);
const DAYS = [['seg', 'Seg'], ['ter', 'Ter'], ['qua', 'Qua'], ['qui', 'Qui'], ['sex', 'Sex'], ['sab', 'Sáb'], ['dom', 'Dom']];
const reais = (c) => (c / 100).toFixed(2).replace('.', ',').replace(',00', '');
const toCents = (s) => { const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : null; };
const slug = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'perfil';
const TABS = [['nucleo', 'Núcleo'], ['precos', 'Preços'], ['modulos', 'Módulos'], ['ia', 'Liga / desliga']];

export function CreatorProfileForm({ creatorId, onSaved }) {
  const [meta, setMeta] = useState(null), [form, setForm] = useState(null), [busy, setBusy] = useState(false), [info, setInfo] = useState(null), [tab, setTab] = useState('nucleo'), [comp, setComp] = useState(null);
  useEffect(() => { api.get('/assist/fields').then(r => setMeta(r.data)).catch(e => toast.error(errorText(e))); }, []);
  useEffect(() => {
    if (!creatorId || !meta) return;
    api.get('/assist/profiles').then(r => {
      const p = r.data.find(x => x.creator_id === creatorId) || {};
      setInfo(p.updated_at || p.imported_at ? { updated_at: p.updated_at, updated_by: p.updated_by, imported_at: p.imported_at, imported_from: p.imported_from } : null);
      setComp(p.completeness || null);
      setForm({
        persona: { ...(p.persona || {}) }, style: p.style || '', limits: p.limits || '', max_level: p.max_level || 'picante', suggest_auto: !!p.suggest_auto,
        prices: (p.prices || []).map(x => ({ item: x.item, value: reais(x.cents), obs: x.obs || '', category: x.category || 'outro', explicit: !!x.explicit })),
        fan_segments: (p.fan_segments || []).map(x => ({ ...x })), hot_terms: p.hot_terms || '', openers: { ...(p.openers || {}) },
        modules: { ...(p.modules || {}) }, voice: { tone: '', tone_notes: '', use_words: '', avoid_words: '', emojis: '', ...(p.voice || {}) },
        sales: { warm_first: true, discount: 'uma_vez', script: '', ...(p.sales || {}) }, limit_flags: p.limit_flags || ['encontro', 'contato'],
        call: { days: [], hours: '', notice_hours: 0, confirm_first: true, notes: '', ...(p.call || {}) }, preview: { mode: 'parcial', gift: '', ...(p.preview || {}) },
        languages: { langs: ['pt'], foreign_price: 'brl', notes: '', ...(p.languages || {}) }, promos: (p.promos || []).map(x => ({ ...x })),
        objections: (p.objections || []).map(x => ({ ...x })), custom_delivery: p.custom_delivery || '',
        features: { assist: true, thermo: true, sell: true, content_read: true, content_capture: true, ...(p.features || {}) },
        connection: { enabled: true, turns: 3, questions: '', ...(p.connection || {}) },
      });
    }).catch(e => toast.error(errorText(e)));
  }, [creatorId, meta]);
  if (!form || !meta) return <p className="body-muted">Carregando…</p>;
  const up = (patch) => setForm(f => ({ ...f, ...patch }));
  const sub = (k, patch) => setForm(f => ({ ...f, [k]: { ...f[k], ...patch } }));
  const setP = (k, v) => setForm(f => ({ ...f, persona: { ...f.persona, [k]: v } }));
  const setRow = (k, i, patch) => setForm(f => ({ ...f, [k]: f[k].map((x, j) => j === i ? { ...x, ...patch } : (patch.default ? { ...x, default: false } : x)) }));
  const delRow = (k, i) => setForm(f => ({ ...f, [k]: f[k].filter((_, j) => j !== i) }));
  const mod = (k) => !!form.modules[k];
  const save = async () => {
    setBusy(true);
    try {
      const prices = form.prices.filter(p => p.item.trim() && String(p.value).trim() && toCents(p.value) != null).map(p => ({ item: p.item.trim(), cents: toCents(p.value), obs: (p.obs || '').trim(), category: p.category || '', explicit: !!p.explicit }));
      const segs = form.fan_segments.filter(x => x.label.trim()).map(x => ({ key: x.key || slug(x.label), label: x.label.trim(), tone: (x.tone || '').trim(), default: !!x.default, level: x.level || null }));
      const body = { style: form.style, limits: form.limits, max_level: form.max_level, suggest_auto: !!form.suggest_auto, prices, persona: form.persona, fan_segments: segs,
        hot_terms: form.hot_terms || '', openers: form.openers || {}, modules: Object.fromEntries(Object.keys(meta.modules).map(k => [k, !!form.modules[k]])),
        voice: form.voice, sales: form.sales, limit_flags: form.limit_flags, call: { ...form.call, notice_hours: Number(form.call.notice_hours) || 0 }, preview: form.preview,
        languages: form.languages, promos: form.promos.filter(x => x.title.trim()), objections: form.objections.filter(x => x.q.trim() && x.a.trim()), custom_delivery: form.custom_delivery, features: form.features, connection: { ...form.connection, turns: Number(form.connection.turns) || 3 } };
      const r = (await api.put(`/assist/profiles/${creatorId}`, body)).data;
      setComp(r.completeness || null); toast.success('Ficha salva.'); onSaved && onSaved(r);
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  const persona = (k, label, rows = 3) => <Field key={k} id={`pf-${k}`} label={label}>{SHORT.has(k) ? <Input id={`pf-${k}`} value={form.persona[k] || ''} onChange={e => setP(k, e.target.value)} placeholder="Em aberto"/> : <textarea className="assist-textarea" rows={rows} value={form.persona[k] || ''} onChange={e => setP(k, e.target.value)} placeholder="Em aberto"/>}</Field>;
  const ta = (value, onChange, rows = 3, placeholder = 'Em aberto', max = 2000) => <textarea className="assist-textarea" rows={rows} maxLength={max} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}/>;
  const pf = (sec) => meta.persona.filter(f => f.section === sec);
  const chk = (checked, onChange, label) => <label className="checkbox-label small"><input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)}/><span>{label}</span></label>;
  const pct = comp ? comp.pct : null;

  return <div className="form-stack profile-form" data-testid="creator-profile-form">
    <div className="pf-top">
      {pct != null && <div className={`pf-badge ${pct >= 85 ? 'ok' : pct >= 60 ? 'mid' : 'low'}`} title={comp.missing.length ? 'Falta: ' + comp.missing.join(' · ') : 'Ficha completa'}>Ficha {pct}%</div>}
      {comp && comp.missing.length > 0 && <span className="body-muted" style={{ fontSize: 12 }}>Falta: {comp.missing.join(' · ')}</span>}
    </div>
    {info && <p className="body-muted" style={{ fontSize: 12, margin: 0 }}>{info.imported_at ? `Importada de ${info.imported_from} em ${dateTime(info.imported_at)}. ` : ''}{info.updated_at ? `Última edição: ${dateTime(info.updated_at)}${info.updated_by ? ` por ${info.updated_by}` : ''}.` : ''}</p>}
    <div className="pf-tabs">{TABS.map(([k, l]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>

    {tab === 'nucleo' && <>
      <section className="profile-sec"><h3>📝 Identidade</h3><div className="profile-grid">{pf('basico').map(f => persona(f.key, f.label))}{pf('extras').map(f => persona(f.key, f.label, f.key === 'resumo_ia' ? 6 : 3))}</div></section>
      <section className="profile-sec"><h3>🗣 Voz</h3><div className="profile-grid">
        <Field id="pf-tone" label="Tom padrão"><Select id="pf-tone" value={form.voice.tone} onChange={e => sub('voice', { tone: e.target.value })}><option value="">Escolha…</option>{Object.entries(meta.tones).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field id="pf-tone-notes" label="Detalhe do tom">{ta(form.voice.tone_notes, v => sub('voice', { tone_notes: v }), 2, 'Ex.: manda, não pede; frases curtas', 600)}</Field>
        <Field id="pf-use" label="Palavras para usar">{ta(form.voice.use_words, v => sub('voice', { use_words: v }), 2, 'servo, sua Deusa, tarefa, recompensa', 600)}</Field>
        <Field id="pf-avoid" label="Palavras para evitar">{ta(form.voice.avoid_words, v => sub('voice', { avoid_words: v }), 2, 'amor, bê, "por favor"', 600)}</Field>
        <Field id="pf-emojis" label="Emojis dela"><Input id="pf-emojis" maxLength={80} value={form.voice.emojis} onChange={e => sub('voice', { emojis: e.target.value })} placeholder="😈 🖤 ⛓️"/></Field>
      </div></section>
      <section className="profile-sec"><h3>🔥 Conteúdo e estilo visual</h3><div className="profile-grid">{pf('conteudo').map(f => persona(f.key, f.label))}{pf('visual').map(f => persona(f.key, f.label, f.key === 'frases_venda' ? 6 : 3))}</div></section>
      <section className="profile-sec"><h3>⛔ Limites</h3>
        <div className="pf-flags">{Object.entries(meta.limit_flags).map(([k, l]) => <span key={k}>{chk(form.limit_flags.includes(k), v => up({ limit_flags: v ? [...form.limit_flags, k] : form.limit_flags.filter(x => x !== k) }), l)}</span>)}</div>
        <Field id="pf-limits" label="Outros limites (o que ela NÃO faz)">{ta(form.limits, v => up({ limits: v }), 2, 'Em aberto', 3000)}</Field>
      </section>
      <section className="profile-sec"><h3>💼 Estratégia de venda</h3><div className="profile-grid">
        <div>{chk(form.sales.warm_first, v => sub('sales', { warm_first: v }), 'Aquece a conversa antes de vender (nunca oferta fria)')}</div>
        <Field id="pf-disc" label="Desconto"><Select id="pf-disc" value={form.sales.discount} onChange={e => sub('sales', { discount: e.target.value })}><option value="nunca">Nunca</option><option value="uma_vez">Uma vez por fã, com prazo</option><option value="livre">Pode negociar</option></Select></Field>
        <Field id="pf-prev" label="Prévia"><Select id="pf-prev" value={form.preview.mode} onChange={e => sub('preview', { mode: e.target.value })}><option value="nao">Não manda prévia</option><option value="parcial">Só parcial (pedaço curto / foto borrada)</option><option value="borrada">Só borrada</option><option value="livre">Pode mandar</option></Select></Field>
        <Field id="pf-gift" label="Mimo grátis para cliente bom (opcional)"><Input id="pf-gift" maxLength={300} value={form.preview.gift} onChange={e => sub('preview', { gift: e.target.value })} placeholder="Ex.: uma foto de lingerie no aniversário"/></Field>
        <Field id="pf-script" label="Roteiro de venda (passos)">{ta(form.sales.script, v => sub('sales', { script: v }), 5, '1 Abertura: …\n2 Aquecimento: …\n3 Oferta: …')}</Field>
        <Field id="pf-style" label="Observações livres para a IA">{ta(form.style, v => up({ style: v }), 5, 'Cuidados, jeito dela, o que não pode faltar')}</Field>
      </div>
        <h3 style={{ marginTop: 14 }}>Respostas a objeções</h3>
        {form.objections.map((o, i) => <div key={i} className="pf-row"><Input maxLength={120} value={o.q} onChange={e => setRow('objections', i, { q: e.target.value })} placeholder='Objeção (ex.: "tá caro")'/><Input maxLength={400} value={o.a} onChange={e => setRow('objections', i, { a: e.target.value })} placeholder="Como ela responde"/><Button variant="ghost" onClick={() => delRow('objections', i)}><Trash2 size={14}/></Button></div>)}
        <Button variant="outline" onClick={() => up({ objections: [...form.objections, { q: '', a: '' }] })}><Plus size={14}/>Adicionar objeção</Button>
      </section>
    </>}

    {tab === 'precos' && <section className="profile-sec"><h3>💰 Tabela de preços mínimos</h3>
      <p className="body-muted" style={{ fontSize: 12 }}>A tabela é o piso: para quem já comprou, a sugestão parte do ticket médio do fã + 20%. A categoria faz o termômetro e o botão Vender acharem o item certo.</p>
      <div className="table-scroll"><table className="price-table"><thead><tr><th>Item</th><th>Categoria</th><th>Explícito</th><th>Mínimo (R$)</th><th>Observações</th><th/></tr></thead><tbody>
        {form.prices.map((p, i) => <tr key={i}><td><Input value={p.item} maxLength={80} placeholder="Nome do item" onChange={e => setRow('prices', i, { item: e.target.value })}/></td>
          <td><Select value={p.category} onChange={e => setRow('prices', i, { category: e.target.value })}>{Object.entries(meta.price_cats).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></td>
          <td style={{ textAlign: 'center' }}><input type="checkbox" checked={!!p.explicit} onChange={e => setRow('prices', i, { explicit: e.target.checked })}/></td>
          <td><Input value={p.value} placeholder="0,00" onChange={e => setRow('prices', i, { value: e.target.value })} style={{ maxWidth: 110 }}/></td>
          <td><Input value={p.obs} maxLength={300} placeholder="—" onChange={e => setRow('prices', i, { obs: e.target.value })}/></td>
          <td><Button variant="ghost" onClick={() => delRow('prices', i)}><Trash2 size={14}/></Button></td></tr>)}
      </tbody></table></div>
      <div className="pf-add">{Object.entries(meta.price_cats).filter(([k]) => k !== 'outro').map(([k, l]) => <Button key={k} variant="outline" onClick={() => up({ prices: [...form.prices, { item: l, value: '', obs: '', category: k, explicit: false }] })}><Plus size={13}/>{l}</Button>)}</div>
    </section>}

    {tab === 'modulos' && <>
      <section className="profile-sec"><h3>🧩 Módulos desta criadora</h3><p className="body-muted" style={{ fontSize: 12 }}>Ligue só o que ela usa. Módulo desligado não aparece para o chatter nem vai para a IA.</p>
        <div className="pf-flags">{Object.entries(meta.modules).map(([k, l]) => <span key={k}>{chk(mod(k), v => sub('modules', { [k]: v }), l)}</span>)}</div></section>
      <section className="profile-sec"><h3>🤝 Fase de conexão (fã novo ou sem compras)</h3>
        <p className="body-muted" style={{ fontSize: 12 }}>Antes de vender, a sugestão busca conhecer o fã e fazer ele se sentir próximo. Sai na hora se ele pedir conteúdo ou preço, se responder seco, ou quando o chatter clicar em "pular". O que ele conta vira sugestão de anotação na memória do fã.</p>
        <div className="profile-grid">
          <div>{chk(form.connection.enabled, v => sub('connection', { enabled: v }), 'Usar fase de conexão com esta criadora')}</div>
          <Field id="pf-cturns" label="Quantas trocas antes de seguir o roteiro" type="number" min={1} max={8} value={form.connection.turns} onChange={e => sub('connection', { turns: e.target.value })}/>
          <Field id="pf-cq" label="Perguntas de conexão dela (opcional)">{ta(form.connection.questions, v => sub('connection', { questions: v }), 3, 'Como você me achou? Como quer que eu te chame? O que mais te prendeu em mim?', 1200)}</Field>
        </div></section>
      {mod('segments') && <section className="profile-sec"><h3>👥 Perfis de fã</h3>
        <p className="body-muted" style={{ fontSize: 12 }}>O chatter classifica cada fã no app e a sugestão fala do jeito descrito aqui. Fã sem classificação recebe o perfil padrão.</p>
        {form.fan_segments.map((x, i) => <div key={i} className="profile-grid" style={{ alignItems: 'start', marginBottom: 8 }}>
          <Field id={`pf-seg-${i}`} label="Nome do perfil"><Input id={`pf-seg-${i}`} maxLength={30} value={x.label} onChange={e => setRow('fan_segments', i, { label: e.target.value })} placeholder="Ex.: Baunilha"/></Field>
          <Field id={`pf-segt-${i}`} label="Como falar com este fã">{ta(x.tone, v => setRow('fan_segments', i, { tone: v }), 3, 'Tom, vocabulário, o que dizer sobre ela', 1200)}</Field>
          <Field id={`pf-segl-${i}`} label="Intensidade"><Select id={`pf-segl-${i}`} value={x.level || ''} onChange={e => setRow('fan_segments', i, { level: e.target.value })}><option value="">Igual à máxima</option>{LEVELS.map(([v, l]) => <option key={v} value={v}>{l.split(' — ')[0]}</option>)}</Select></Field>
          <div className="row-actions"><label className="checkbox-label small"><input type="radio" name="seg-default" checked={!!x.default} onChange={() => setRow('fan_segments', i, { default: true })}/><span>padrão</span></label><Button variant="ghost" onClick={() => delRow('fan_segments', i)}><Trash2 size={14}/></Button></div>
        </div>)}
        {form.fan_segments.length < 6 && <Button variant="outline" onClick={() => up({ fan_segments: [...form.fan_segments, { key: '', label: '', tone: '', default: !form.fan_segments.length }] })}><Plus size={14}/>Adicionar perfil de fã</Button>}
      </section>}
      {mod('call') && <section className="profile-sec"><h3>📹 Videochamada</h3><div className="profile-grid">
        <Field id="pf-cd" label="Dias"><div className="pf-days">{DAYS.map(([k, l]) => <button type="button" key={k} className={form.call.days.includes(k) ? 'on' : ''} onClick={() => sub('call', { days: form.call.days.includes(k) ? form.call.days.filter(d => d !== k) : [...form.call.days, k] })}>{l}</button>)}</div></Field>
        <Field id="pf-ch" label="Horário"><Input id="pf-ch" maxLength={60} value={form.call.hours} onChange={e => sub('call', { hours: e.target.value })} placeholder="22h às 00h30"/></Field>
        <Field id="pf-cn" label="Aviso prévio (horas)" type="number" min={0} max={168} value={form.call.notice_hours} onChange={e => sub('call', { notice_hours: e.target.value })}/>
        <div>{chk(form.call.confirm_first, v => sub('call', { confirm_first: v }), 'Confirmar com ela antes de o fã pagar')}</div>
        <Field id="pf-cno" label="Observações"><Input id="pf-cno" maxLength={300} value={form.call.notes} onChange={e => sub('call', { notes: e.target.value })}/></Field>
      </div><p className="body-muted" style={{ fontSize: 12 }}>O preço da chamada fica na aba Preços (categoria Videochamada).</p></section>}
      {mod('openers') && <section className="profile-sec"><h3>👋 Aberturas (começo de conversa)</h3><p className="body-muted" style={{ fontSize: 12 }}>Uma frase por linha, 3 a 5 por situação. A IA usa como base e varia um pouco.</p>
        <div className="profile-grid">{[['novo', 'Fã novo (nunca comprou)'], ['cliente', 'Cliente que volta'], ['sumido', 'Sumido (7+ dias)'], ['voltando', 'Ex-assinante voltando']].map(([k, l]) => <Field key={k} id={`pf-op-${k}`} label={l}>{ta(form.openers[k], v => up({ openers: { ...form.openers, [k]: v } }), 3, 'Em aberto', 1500)}</Field>)}</div></section>}
      {mod('thermo') && <section className="profile-sec"><h3>🌡 Termômetro: palavras dela</h3><p className="body-muted" style={{ fontSize: 12 }}>Além das padrão (nudez, vídeo, preço, "quer ver meu pau"…). Uma por linha.</p>{ta(form.hot_terms, v => up({ hot_terms: v }), 3, 'adestrado\ntarefa', 1000)}</section>}
      {mod('items') && <section className="profile-sec"><h3>🩲 Itens pessoais</h3><p className="body-muted" style={{ fontSize: 12 }}>O que ela vende fica em "Vende itens pessoais" (Núcleo → Conteúdo). Cadastre o preço de cada item na aba Preços, categoria Itens pessoais.</p></section>}
      {mod('custom') && <section className="profile-sec"><h3>🎬 Personalizados</h3><Field id="pf-cdl" label="Prazo de entrega"><Input id="pf-cdl" maxLength={300} value={form.custom_delivery} onChange={e => up({ custom_delivery: e.target.value })} placeholder="Ex.: grava de quinta a domingo; entrega em até 3 dias"/></Field></section>}
      {mod('languages') && <section className="profile-sec"><h3>🌎 Idiomas e moeda</h3><div className="profile-grid">
        <div className="pf-flags">{[['pt', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol']].map(([k, l]) => <span key={k}>{chk(form.languages.langs.includes(k), v => sub('languages', { langs: v ? [...form.languages.langs, k] : form.languages.langs.filter(x => x !== k) }), l)}</span>)}</div>
        <Field id="pf-fp" label="Preço para estrangeiro"><Select id="pf-fp" value={form.languages.foreign_price} onChange={e => sub('languages', { foreign_price: e.target.value })}><option value="brl">Sempre em reais</option><option value="usd_convert">Em dólar, convertido do valor em reais</option><option value="usd_fixed">Em dólar, valores nas observações dos preços</option></Select></Field>
        <Field id="pf-lgn" label="Observações"><Input id="pf-lgn" maxLength={300} value={form.languages.notes} onChange={e => sub('languages', { notes: e.target.value })}/></Field>
      </div></section>}
      {mod('promos') && <section className="profile-sec"><h3>🎉 Promoções e campanhas</h3><p className="body-muted" style={{ fontSize: 12 }}>A IA só usa enquanto estiver dentro das datas. Depois some sozinha.</p>
        {form.promos.map((x, i) => <div key={i} className="pf-row"><Input maxLength={80} value={x.title} onChange={e => setRow('promos', i, { title: e.target.value })} placeholder="Nome (ex.: Dia da Deusa)"/><Input maxLength={400} value={x.text} onChange={e => setRow('promos', i, { text: e.target.value })} placeholder="O que é a promoção"/><Input type="date" value={x.starts} onChange={e => setRow('promos', i, { starts: e.target.value })}/><Input type="date" value={x.ends} onChange={e => setRow('promos', i, { ends: e.target.value })}/><Button variant="ghost" onClick={() => delRow('promos', i)}><Trash2 size={14}/></Button></div>)}
        <Button variant="outline" onClick={() => up({ promos: [...form.promos, { title: '', text: '', starts: '', ends: '' }] })}><Plus size={14}/>Adicionar promoção</Button></section>}
    </>}

    {tab === 'ia' && <section className="profile-sec"><h3>🔌 O que fica ligado para esta criadora</h3><p className="body-muted" style={{ fontSize: 12 }}>Só o admin muda. Desligado some do app dos chatters nesta criadora.</p>
      <div className="pf-switches">
        {chk(form.features.assist, v => sub('features', { assist: v }), 'Alta Ajuda (sugestões de mensagem)')}
        {chk(form.features.thermo, v => sub('features', { thermo: v }), 'Termômetro de venda')}
        {chk(form.features.sell, v => sub('features', { sell: v }), 'Venda: botão 💰 e tabela de preços no cartão do fã')}
      </div>
      <h3 style={{ marginTop: 14 }}>📣 Conteúdo e disparos</h3><p className="body-muted" style={{ fontSize: 12 }}>Mede posts e mensagens em massa desta criadora. Quem vê os números é definido por pessoa, em Equipe → Permissões especiais.</p>
      <div className="pf-switches">
        {chk(form.features.content_capture, v => sub('features', { content_capture: v }), 'Registrar quem disparou cada mensagem em massa e quem postou/agendou cada post pelo app')}
        {chk(form.features.content_read, v => sub('features', { content_read: v }), 'Ler o resultado dos posts (Meu Privacy → Engajamento) e o calendário da Privacy a cada 3 h')}
      </div></section>}
    {tab === 'ia' && <section className="profile-sec"><h3>✨ Alta Ajuda</h3><div className="profile-grid">
      <Field id="pf-level" label="Intensidade máxima"><Select id="pf-level" value={form.max_level} onChange={e => up({ max_level: e.target.value })}>{LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <div>{chk(form.suggest_auto, v => up({ suggest_auto: v }), 'Sugestão automática ao abrir a conversa (fã falou por último). Desligado: o chatter clica em Sugerir resposta. Precisa de preços e limites.')}</div>
    </div><p className="body-muted" style={{ fontSize: 12 }}>As mensagens vão mascaradas (sem telefone, e-mail ou links) com a ficha para a xAI. Nada é enviado ao fã sozinho.</p></section>}

    <div className="form-actions"><Button data-testid="profile-save" disabled={busy} onClick={save}>Salvar ficha</Button></div>
  </div>;
}
