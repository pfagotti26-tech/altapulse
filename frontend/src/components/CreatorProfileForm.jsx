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
      setForm({ persona: { ...(p.persona || {}) }, style: p.style || '', limits: p.limits || '', max_level: p.max_level || 'picante', prices: [...fixed, ...extra] });
    }).catch(e => toast.error(errorText(e)));
  }, [creatorId, meta]);
  if (!form || !meta) return <p className="body-muted">Carregando…</p>;
  const setP = (k, v) => setForm({ ...form, persona: { ...form.persona, [k]: v } });
  const setPrice = (i, k, v) => setForm({ ...form, prices: form.prices.map((p, j) => j === i ? { ...p, [k]: v } : p) });
  const save = async () => {
    setBusy(true);
    try {
      const prices = form.prices.filter(p => p.item.trim() && String(p.value).trim() && toCents(p.value) != null).map(p => ({ item: p.item.trim(), cents: toCents(p.value), obs: (p.obs || '').trim() }));
      const r = (await api.put(`/assist/profiles/${creatorId}`, { style: form.style, limits: form.limits, max_level: form.max_level, prices, persona: form.persona })).data;
      toast.success('Ficha salva.'); onSaved && onSaved(r);
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
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
    <section className="profile-sec"><h3>✨ Alta Ajuda</h3><div className="profile-grid">
      <Field id="pf-style" label="Observações para a IA (tom, cuidados)"><textarea className="assist-textarea" rows={3} maxLength={2000} value={form.style} onChange={e => setForm({ ...form, style: e.target.value })} placeholder="Ex.: frases curtas; provoca antes de oferecer."/></Field>
      <Field id="pf-level" label="Intensidade máxima"><Select id="pf-level" value={form.max_level} onChange={e => setForm({ ...form, max_level: e.target.value })}>{LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
    </div></section>
    <div className="form-actions"><Button data-testid="profile-save" disabled={busy} onClick={save}>Salvar ficha</Button></div>
  </div>;
}
