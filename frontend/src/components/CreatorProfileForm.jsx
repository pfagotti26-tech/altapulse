import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, dateTime } from '../lib/api';
import { Button, Field, Select, Input } from './Common';

// Ficha da criadora (persona + limites + tabela de preços mínimos): alimenta a Alta Ajuda e a consulta do chatter no app.
// Mesmos campos do formulário de personalidade da agência. Campo vazio fica em aberto para preencher.
const LEVELS = [['leve', 'Leve — flerte e insinuação'], ['picante', 'Picante — sensual e provocante'], ['explicito', 'Explícito — linguagem sexual direta']];
const SECTIONS = [['basico', '📝 Informações básicas'], ['conteudo', '🔥 Conteúdos e limites'], ['visual', '📸 Estilo visual'], ['extras', '❤️ Informações extras']];
const SHORT = new Set(['nome_artistico', 'como_ser_chamada', 'idade', 'cidade_estado', 'status_relacionamento', 'itens_pessoais', 'como_chama_assinantes']);
const reais = (c) => (c / 100).toFixed(2).replace('.', ',').replace(',00', '');
const toCents = (s) => { const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : null; };

export function CreatorProfileForm({ creatorId, onSaved }) {
  const [meta, setMeta] = useState(null), [form, setForm] = useState(null), [busy, setBusy] = useState(false), [info, setInfo] = useState(null);
  useEffect(() => { api.get('/assist/fields').then(r => setMeta(r.data)).catch(e => toast.error(errorText(e))); }, []);
  useEffect(() => {
    if (!creatorId || !meta) return;
    api.get('/assist/profiles').then(r => {
      const p = r.data.find(x => x.creator_id === creatorId) || {};
      setInfo(p.updated_at || p.imported_at ? { updated_at: p.updated_at, updated_by: p.updated_by, imported_at: p.imported_at, imported_from: p.imported_from } : null);
      const saved = p.prices || [];
      // os 10 itens da tabela mínima sempre aparecem (vazios para preencher); itens extras vêm depois
      const fixed = meta.price_items.map(item => { const s = saved.find(x => x.item.toLowerCase() === item.toLowerCase()); return { item, value: s ? reais(s.cents) : '', obs: s?.obs || '', fixed: true }; });
      const extra = saved.filter(x => !meta.price_items.some(i => i.toLowerCase() === x.item.toLowerCase())).map(x => ({ item: x.item, value: reais(x.cents), obs: x.obs || '' }));
      setForm({ persona: { ...(p.persona || {}) }, style: p.style || '', limits: p.limits || '', max_level: p.max_level || 'picante', suggest_auto: !!p.suggest_auto, fan_segments: (p.fan_segments || []).map(x => ({ ...x })), hot_terms: p.hot_terms || '', prices: [...fixed, ...extra] });
    }).catch(e => toast.error(errorText(e)));
  }, [creatorId, meta]);
  if (!form || !meta) return <p className="body-muted">Carregando…</p>;
  const setP = (k, v) => setForm({ ...form, persona: { ...form.persona, [k]: v } });
  const setPrice = (i, k, v) => setForm({ ...form, prices: form.prices.map((p, j) => j === i ? { ...p, [k]: v } : p) });
  const save = async () => {
    setBusy(true);
    try {
      const prices = form.prices.filter(p => p.item.trim() && String(p.value).trim() && toCents(p.value) != null).map(p => ({ item: p.item.trim(), cents: toCents(p.value), obs: (p.obs || '').trim() }));
      const slug = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'perfil';
      const segs = form.fan_segments.filter(x => x.label.trim()).map(x => ({ key: x.key || slug(x.label), label: x.label.trim(), tone: (x.tone || '').trim(), default: !!x.default, level: x.level || null }));
      const r = (await api.put(`/assist/profiles/${creatorId}`, { style: form.style, limits: form.limits, max_level: form.max_level, suggest_auto: !!form.suggest_auto, fan_segments: segs, hot_terms: form.hot_terms || '', prices, persona: form.persona })).data;
      toast.success('Ficha salva.'); onSaved && onSaved(r);
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  const setSeg = (i, patch) => setForm({ ...form, fan_segments: form.fan_segments.map((x, j) => j === i ? { ...x, ...patch } : (patch.default ? { ...x, default: false } : x)) });
  const area = (k, label, rows = 3) => <Field key={k} id={`pf-${k}`} label={label}>{SHORT.has(k) ? <Input id={`pf-${k}`} value={form.persona[k] || ''} onChange={e => setP(k, e.target.value)} placeholder="Em aberto"/> : <textarea className="assist-textarea" rows={rows} value={form.persona[k] || ''} onChange={e => setP(k, e.target.value)} placeholder="Em aberto"/>}</Field>;
  return <div className="form-stack profile-form" data-testid="creator-profile-form">
    {info && <p className="body-muted" style={{ fontSize: 12 }}>{info.imported_at ? `Importada de ${info.imported_from} em ${dateTime(info.imported_at)}. ` : ''}{info.updated_at ? `Última edição: ${dateTime(info.updated_at)}${info.updated_by ? ` por ${info.updated_by}` : ''}.` : ''}</p>}
    {SECTIONS.map(([sec, title]) => <section key={sec} className="profile-sec"><h3>{title}</h3>
      <div className="profile-grid">{meta.persona.filter(f => f.section === sec).map(f => area(f.key, f.label, f.key === 'resumo_ia' ? 6 : 3))}
        {sec === 'conteudo' && <Field id="pf-limits" label="Limites (o que ela NÃO faz)"><textarea className="assist-textarea" rows={3} value={form.limits} onChange={e => setForm({ ...form, limits: e.target.value })} placeholder="Em aberto"/></Field>}
      </div>
      {sec === 'conteudo' && <>
        <section className="profile-sec"><h3>💰 Tabela de preços mínimos</h3>
          <div className="table-scroll"><table className="price-table"><thead><tr><th>Tipo de conteúdo</th><th>Valor mínimo (R$)</th><th>Observações</th><th/></tr></thead><tbody>
            {form.prices.map((p, i) => <tr key={i}><td>{p.fixed ? p.item : <Input value={p.item} maxLength={80} placeholder="Produto" onChange={e => setPrice(i, 'item', e.target.value)}/>}</td><td><Input value={p.value} placeholder="em aberto" onChange={e => setPrice(i, 'value', e.target.value)} style={{ maxWidth: 120 }}/></td><td><Input value={p.obs} maxLength={300} placeholder="—" onChange={e => setPrice(i, 'obs', e.target.value)}/></td><td>{!p.fixed && <Button variant="ghost" onClick={() => setForm({ ...form, prices: form.prices.filter((_, j) => j !== i) })}><Trash2 size={14}/></Button>}</td></tr>)}
          </tbody></table></div>
          <div><Button variant="outline" style={{ marginTop: 8 }} onClick={() => setForm({ ...form, prices: [...form.prices, { item: '', value: '', obs: '' }] })}><Plus size={14}/>Adicionar produto</Button></div>
        </section>
      </>}
    </section>)}
    <section className="profile-sec"><h3>👥 Perfis de fã</h3>
      <p className="body-muted" style={{ fontSize: 13 }}>O chatter classifica cada fã com um destes perfis no app, e o Sugerir resposta passa a falar do jeito descrito aqui. Fã sem classificação recebe o perfil padrão.</p>
      {form.fan_segments.map((x, i) => <div key={i} className="profile-grid" style={{ alignItems: 'start', marginBottom: 8 }}>
        <Field id={`pf-seg-${i}`} label="Nome do perfil"><Input id={`pf-seg-${i}`} maxLength={30} value={x.label} onChange={e => setSeg(i, { label: e.target.value })} placeholder="Ex.: Baunilha"/></Field>
        <Field id={`pf-segt-${i}`} label="Como falar com este fã"><textarea className="assist-textarea" rows={3} maxLength={1200} value={x.tone || ''} onChange={e => setSeg(i, { tone: e.target.value })} placeholder="Tom, vocabulário, o que dizer sobre ela"/></Field>
        <Field id={`pf-segl-${i}`} label="Intensidade da sugestão"><Select id={`pf-segl-${i}`} value={x.level || ''} onChange={e => setSeg(i, { level: e.target.value })}><option value="">Igual à máxima da ficha</option>{LEVELS.map(([v, l]) => <option key={v} value={v}>{l.split(' — ')[0]}</option>)}</Select></Field>
        <div className="row-actions"><label className="checkbox-label small"><input type="radio" name="seg-default" checked={!!x.default} onChange={() => setSeg(i, { default: true })}/><span>padrão</span></label><Button variant="ghost" onClick={() => setForm({ ...form, fan_segments: form.fan_segments.filter((_, j) => j !== i) })}><Trash2 size={14}/></Button></div>
      </div>)}
      {form.fan_segments.length < 6 && <div><Button variant="outline" onClick={() => setForm({ ...form, fan_segments: [...form.fan_segments, { key: '', label: '', tone: '', default: !form.fan_segments.length }] })}><Plus size={14}/>Adicionar perfil de fã</Button></div>}
    </section>
    <section className="profile-sec"><h3>🌡 Termômetro de venda</h3>
      <p className="body-muted" style={{ fontSize: 13 }}>O termômetro já reconhece pedidos de nudez, de vídeo, de personalizado, pergunta de preço, "quer ver meu pau" e sinais de excitação. Aqui você acrescenta palavras que esquentam a conversa com esta criadora (uma por linha).</p>
      <textarea className="assist-textarea" rows={3} maxLength={1000} value={form.hot_terms || ''} onChange={e => setForm({ ...form, hot_terms: e.target.value })} placeholder={'adestrado\ntarefa\nme castiga'}/>
    </section>
    <section className="profile-sec"><h3>✨ Alta Ajuda</h3><div className="profile-grid">
      <Field id="pf-style" label="Observações para a IA (tom, cuidados)"><textarea className="assist-textarea" rows={3} maxLength={2000} value={form.style} onChange={e => setForm({ ...form, style: e.target.value })} placeholder="Ex.: frases curtas; provoca antes de oferecer."/></Field>
      <label className="checkbox-label" style={{ gridColumn: '1 / -1' }}><input type="checkbox" data-testid="pf-suggest" checked={!!form.suggest_auto} onChange={e => setForm({ ...form, suggest_auto: e.target.checked })}/><span><b>Sugestão automática ao abrir a conversa</b>. Ligado: quando o fã falou por último, a sugestão já aparece sozinha. Desligado: o chatter clica em Sugerir resposta quando quiser. Nada é enviado sozinho; o chatter edita e envia. Precisa de tabela de preços e limites preenchidos. As mensagens vão mascaradas (sem telefone, e-mail ou links) para a xAI.</span></label>
      <Field id="pf-level" label="Intensidade máxima"><Select id="pf-level" value={form.max_level} onChange={e => setForm({ ...form, max_level: e.target.value })}>{LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
    </div></section>
    <div className="form-actions"><Button data-testid="profile-save" disabled={busy} onClick={save}>Salvar ficha</Button></div>
  </div>;
}
