import React, { useEffect, useState } from 'react';
import { Sparkles, KeyRound, Plus, Trash2, ShieldAlert, Check } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText } from '../lib/api';
import { Button, Field, Select, Notice, Input } from './Common';

// Alta Ajuda: sugestões de resposta pela Grok (xAI). Gestor cadastra a chave, liga, define limite e modelo,
// e escreve o perfil de cada criadora (estilo, limites, teto de intensidade e tabela de preços).
const LEVELS = [['leve', 'Leve — flerte e insinuação'], ['picante', 'Picante — sensual e provocante'], ['explicito', 'Explícito — linguagem sexual direta']];
const reais = (c) => (c / 100).toFixed(2).replace('.', ',');
const toCents = (s) => { const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : null; };

export function AltaAjudaSettings({ creators }) {
  const [cfg, setCfg] = useState(null), [key, setKey] = useState(''), [models, setModels] = useState([]), [busy, setBusy] = useState(false);
  const [profiles, setProfiles] = useState({}), [cid, setCid] = useState(''), [form, setForm] = useState(null);
  const load = async () => { try { setCfg((await api.get('/assist/config')).data); const p = (await api.get('/assist/profiles')).data; setProfiles(Object.fromEntries(p.map(x => [x.creator_id, x]))); } catch (e) { toast.error(errorText(e)); } };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!cid) { setForm(null); return; } const p = profiles[cid] || {}; setForm({ style: p.style || '', limits: p.limits || '', max_level: p.max_level || 'picante', prices: (p.prices || []).map(x => ({ item: x.item, value: reais(x.cents) })) }); }, [cid, profiles]);
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast.success(ok); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } };
  if (!cfg) return null;
  const saveCfg = (patch) => run(async () => { setCfg((await api.put('/assist/config', { enabled: cfg.enabled, daily_limit: Number(cfg.daily_limit), model: cfg.model, ...patch })).data); }, 'Alta Ajuda atualizada.');
  const saveProfile = () => run(async () => {
    const prices = form.prices.filter(p => p.item.trim() && toCents(p.value) != null).map(p => ({ item: p.item.trim(), cents: toCents(p.value) }));
    const r = (await api.put(`/assist/profiles/${cid}`, { style: form.style, limits: form.limits, max_level: form.max_level, prices })).data;
    setProfiles({ ...profiles, [cid]: r });
  }, 'Perfil salvo.');
  const setPrice = (i, k, v) => setForm({ ...form, prices: form.prices.map((p, j) => j === i ? { ...p, [k]: v } : p) });
  const open = (cfg.alerts || []).filter(a => !a.resolved_at);
  return <>
    <section className="settings-section" data-testid="assist-settings"><div><h2>Alta Ajuda (IA nas conversas)</h2><p>O chatter escreve o que quer dizer e a Grok devolve 3 versões no estilo da criadora. Quem envia é sempre o chatter. A chave fica só no servidor.</p></div>
      <div className="form-stack settings-form">
        {open.length > 0 && <div className="notice danger" data-testid="assist-alerts"><ShieldAlert size={17}/><span><strong>Alerta de possível menor de idade</strong>{open.map(a => <span key={a.id} style={{ display: 'block', marginTop: 6 }}>{new Date(a.created_at).toLocaleString('pt-BR')} · {a.creator_name} · pedido por {a.user_name}: {a.reason} <Button variant="ghost" onClick={() => run(async () => { await api.post(`/assist/alerts/${a.id}/resolve`); await load(); }, 'Alerta marcado como verificado.')}><Check size={13}/>Verificado</Button></span>)}</span></div>}
        <p className="body-muted" data-testid="assist-status">{cfg.enabled && cfg.key_set ? 'Ligada' : 'Desligada'} · chave {cfg.key_set ? `cadastrada (${cfg.key_hint})` : 'não cadastrada'} · modelo {cfg.model} · limite de {cfg.daily_limit} ajudas por pessoa por dia</p>
        <Field id="assist-key" label="Chave da API da xAI (console.x.ai)" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={cfg.key_set ? 'Cole uma nova chave para trocar' : 'xai-...'}/>
        <div className="form-actions">
          <Button data-testid="assist-save-key" disabled={busy || key.trim().length < 20} onClick={() => run(async () => { await api.put('/assist/key', { key: key.trim() }); setKey(''); await load(); }, 'Chave salva.')}><KeyRound size={15}/>Salvar chave</Button>
          <Button variant="outline" data-testid="assist-test" disabled={busy || !cfg.key_set} onClick={() => run(async () => { const r = (await api.post('/assist/test')).data; setModels(r.models); }, 'Chave funcionando.')}><Sparkles size={15}/>Testar chave</Button>
          {cfg.key_set && <Button variant="ghost" disabled={busy} onClick={() => window.confirm('Remover a chave? A Alta Ajuda para de funcionar.') && run(async () => { await api.delete('/assist/key'); await load(); }, 'Chave removida.')}><Trash2 size={14}/>Remover</Button>}
        </div>
        <div className="form-columns">
          <Field id="assist-model" label="Modelo da Grok">{models.length ? <Select id="assist-model" value={cfg.model} onChange={e => setCfg({ ...cfg, model: e.target.value })}>{[...new Set([cfg.model, ...models])].map(m => <option key={m} value={m}>{m}</option>)}</Select> : <Input id="assist-model" value={cfg.model} onChange={e => setCfg({ ...cfg, model: e.target.value })}/>}</Field>
          <Field id="assist-limit" label="Ajudas por pessoa por dia" type="number" min={1} max={2000} value={cfg.daily_limit} onChange={e => setCfg({ ...cfg, daily_limit: e.target.value })}/>
        </div>
        <label className="checkbox-label"><input type="checkbox" data-testid="assist-enabled" checked={!!cfg.enabled} onChange={e => setCfg({ ...cfg, enabled: e.target.checked })}/><span>Ligar a Alta Ajuda para a equipe. O chatter escreve a ideia da mensagem e recebe versões prontas; só esse texto (mascarado) e o perfil da criadora vão para a xAI. A conversa com o fã não é lida nem enviada.</span></label>
        <div className="form-actions"><Button data-testid="assist-save" disabled={busy} onClick={() => saveCfg({})}>Salvar</Button></div>
        {(cfg.usage || []).length > 0 && <div className="table-scroll"><table><thead><tr><th>Quem usou</th><th>Hoje</th><th>7 dias</th></tr></thead><tbody>{cfg.usage.map(u => <tr key={u.user_id}><td>{u.name}</td><td className="tabular">{u.today}</td><td className="tabular">{u.week}</td></tr>)}</tbody></table></div>}
        <Notice id="assist-rules">Regras fixas: só adultos (sinal de menor bloqueia a sugestão e gera alerta aqui), nada de encontro ou contato fora da plataforma, e preço só da tabela da criadora ou das ofertas do fã. Valor fora da tabela vira [preço] antes de chegar ao chatter.</Notice>
      </div></section>
    <section className="settings-section" data-testid="assist-profiles"><div><h2>Perfil da criadora na Alta Ajuda</h2><p>Quanto mais claro o estilo e a tabela, melhores as sugestões.</p></div>
      <div className="form-stack settings-form">
        <Field id="assist-creator" label="Criadora"><Select id="assist-creator" value={cid} onChange={e => setCid(e.target.value)}><option value="">Escolha…</option>{creators.map(c => <option key={c.id} value={c.id}>{c.name}{profiles[c.id] ? ' · perfil pronto' : ''}</option>)}</Select></Field>
        {form && <>
          <Field id="assist-style" label="Estilo e jeito de falar"><textarea className="assist-textarea" rows={4} maxLength={2000} value={form.style} onChange={e => setForm({ ...form, style: e.target.value })} placeholder="Ex.: ruiva, dominadora e brincalhona; chama os fãs de 'meu bem'; frases curtas; gosta de provocar antes de oferecer."/></Field>
          <Field id="assist-limits" label="O que ela NÃO faz"><textarea className="assist-textarea" rows={3} maxLength={1500} value={form.limits} onChange={e => setForm({ ...form, limits: e.target.value })} placeholder="Ex.: não mostra o rosto; não faz vídeo com outra pessoa; não faz chamada de vídeo."/></Field>
          <Field id="assist-level" label="Intensidade máxima"><Select id="assist-level" value={form.max_level} onChange={e => setForm({ ...form, max_level: e.target.value })}>{LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <div className="field"><span>Tabela de preços</span>
            {form.prices.map((p, i) => <div key={i} className="form-columns" style={{ alignItems: 'center', marginTop: 6 }}><Input placeholder="Produto (ex.: pack 5 fotos)" value={p.item} maxLength={80} onChange={e => setPrice(i, 'item', e.target.value)}/><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="body-muted">R$</span><Input placeholder="49,90" value={p.value} onChange={e => setPrice(i, 'value', e.target.value)}/><Button variant="ghost" onClick={() => setForm({ ...form, prices: form.prices.filter((_, j) => j !== i) })}><Trash2 size={14}/></Button></div></div>)}
            <div><Button variant="outline" style={{ marginTop: 8 }} onClick={() => setForm({ ...form, prices: [...form.prices, { item: '', value: '' }] })}><Plus size={14}/>Adicionar produto</Button></div>
          </div>
          <div className="form-actions"><Button data-testid="assist-save-profile" disabled={busy} onClick={saveProfile}>Salvar perfil</Button></div>
        </>}
      </div></section>
  </>;
}
