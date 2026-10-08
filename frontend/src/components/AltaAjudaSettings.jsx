import React, { useEffect, useState } from 'react';
import { Sparkles, KeyRound, Trash2, ShieldAlert, Check } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText } from '../lib/api';
import { Button, Field, Select, Notice, Input } from './Common';
import { CreatorProfileForm } from './CreatorProfileForm';

// Alta Ajuda: sugestões de resposta pela Grok (xAI). Gestor cadastra a chave, liga, define limite e modelo,
// e escreve o perfil de cada criadora (estilo, limites, teto de intensidade e tabela de preços).

export function AltaAjudaSettings({ creators }) {
  const [cfg, setCfg] = useState(null), [key, setKey] = useState(''), [models, setModels] = useState([]), [busy, setBusy] = useState(false);
  const [profiles, setProfiles] = useState({}), [cid, setCid] = useState('');
  const load = async () => { try { setCfg((await api.get('/assist/config')).data); const p = (await api.get('/assist/profiles')).data; setProfiles(Object.fromEntries(p.map(x => [x.creator_id, x]))); } catch (e) { toast.error(errorText(e)); } };
  useEffect(() => { load(); }, []);
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast.success(ok); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } };
  if (!cfg) return null;
  const saveCfg = (patch) => run(async () => { setCfg((await api.put('/assist/config', { enabled: cfg.enabled, daily_limit: Number(cfg.daily_limit), model: cfg.model, suggest_model: cfg.suggest_model, ...patch })).data); }, 'Alta Ajuda atualizada.');
  const open = (cfg.alerts || []).filter(a => !a.resolved_at);
  return <>
    <section className="settings-section" data-testid="assist-settings"><div><h2>Alta Ajuda (IA nas conversas)</h2><p>O chatter escreve o que quer dizer e a Grok devolve 3 versões no estilo da criadora. Quem envia é sempre o chatter. A chave fica só no servidor.</p></div>
      <div className="form-stack settings-form">
        {open.length > 0 && <div className="notice danger" data-testid="assist-alerts"><ShieldAlert size={17}/><span><strong>Alerta de possível menor de idade</strong>{open.map(a => <span key={a.id} style={{ display: 'block', marginTop: 6 }}>{new Date(a.created_at).toLocaleString('pt-BR')} · {a.creator_name} · pedido por {a.user_name}: {a.reason} <Button variant="ghost" onClick={() => run(async () => { await api.post(`/assist/alerts/${a.id}/resolve`); await load(); }, 'Alerta marcado como verificado.')}><Check size={13}/>Verificado</Button></span>)}</span></div>}
        <p className="body-muted" data-testid="assist-status">{cfg.enabled && cfg.key_set ? 'Ligada' : 'Desligada'} · chave {cfg.key_set ? `cadastrada (${cfg.key_hint})` : 'não cadastrada'} · modelo {cfg.model} · Sugerir resposta: {cfg.suggest_model}{cfg.suggest_seconds != null ? ` (média ${String(cfg.suggest_seconds).replace('.', ',')} s)` : ''} · limite de {cfg.daily_limit} ajudas por pessoa por dia</p>
        <Field id="assist-key" label="Chave da API da xAI (console.x.ai)" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={cfg.key_set ? 'Cole uma nova chave para trocar' : 'xai-...'}/>
        <div className="form-actions">
          <Button data-testid="assist-save-key" disabled={busy || key.trim().length < 20} onClick={() => run(async () => { await api.put('/assist/key', { key: key.trim() }); setKey(''); await load(); }, 'Chave salva.')}><KeyRound size={15}/>Salvar chave</Button>
          <Button variant="outline" data-testid="assist-test" disabled={busy || !cfg.key_set} onClick={() => run(async () => { const r = (await api.post('/assist/test')).data; setModels(r.models); }, 'Chave funcionando.')}><Sparkles size={15}/>Testar chave</Button>
          {cfg.key_set && <Button variant="ghost" disabled={busy} onClick={() => window.confirm('Remover a chave? A Alta Ajuda para de funcionar.') && run(async () => { await api.delete('/assist/key'); await load(); }, 'Chave removida.')}><Trash2 size={14}/>Remover</Button>}
        </div>
        <div className="form-columns">
          <Field id="assist-model" label="Modelo da Grok">{models.length ? <Select id="assist-model" value={cfg.model} onChange={e => setCfg({ ...cfg, model: e.target.value })}>{[...new Set([cfg.model, ...models])].map(m => <option key={m} value={m}>{m}</option>)}</Select> : <Input id="assist-model" value={cfg.model} onChange={e => setCfg({ ...cfg, model: e.target.value })}/>}</Field>
          <Field id="assist-suggest-model" label="Modelo do Sugerir resposta (use um rápido, sem raciocínio)">{models.length ? <Select id="assist-suggest-model" value={cfg.suggest_model || ''} onChange={e => setCfg({ ...cfg, suggest_model: e.target.value })}>{[...new Set([cfg.suggest_model, ...models])].filter(Boolean).map(m => <option key={m} value={m}>{m}</option>)}</Select> : <Input id="assist-suggest-model" value={cfg.suggest_model || ''} onChange={e => setCfg({ ...cfg, suggest_model: e.target.value })}/>}</Field>
          <Field id="assist-limit" label="Ajudas por pessoa por dia" type="number" min={1} max={2000} value={cfg.daily_limit} onChange={e => setCfg({ ...cfg, daily_limit: e.target.value })}/>
        </div>
        <label className="checkbox-label"><input type="checkbox" data-testid="assist-enabled" checked={!!cfg.enabled} onChange={e => setCfg({ ...cfg, enabled: e.target.checked })}/><span>Ligar a Alta Ajuda para a equipe. O chatter escreve a ideia da mensagem e recebe versões prontas; só esse texto (mascarado) e o perfil da criadora vão para a xAI. A conversa com o fã só é lida nas criadoras em que você ligar o Sugerir resposta na ficha.</span></label>
        <div className="form-actions"><Button data-testid="assist-save" disabled={busy} onClick={() => saveCfg({})}>Salvar</Button></div>
        {(cfg.usage || []).length > 0 && <div className="table-scroll"><table><thead><tr><th>Quem usou</th><th>Hoje</th><th>7 dias</th></tr></thead><tbody>{cfg.usage.map(u => <tr key={u.user_id}><td>{u.name}</td><td className="tabular">{u.today}</td><td className="tabular">{u.week}</td></tr>)}</tbody></table></div>}
        <Notice id="assist-rules">Regras fixas: só adultos (sinal de menor bloqueia a sugestão e gera alerta aqui), nada de encontro ou contato fora da plataforma, e preço só da tabela da criadora ou das ofertas do fã. Valor fora da tabela vira [preço] antes de chegar ao chatter.</Notice>
      </div></section>
    <section className="settings-section" data-testid="assist-profiles"><div><h2>Ficha da criadora</h2><p>Persona, limites e tabela de preços. Também dá para abrir pelo ícone de ficha no card da criadora, em Criadoras.</p></div>
      <div className="form-stack settings-form">
        <Field id="assist-creator" label="Criadora"><Select id="assist-creator" value={cid} onChange={e => setCid(e.target.value)}><option value="">Escolha…</option>{creators.map(c => <option key={c.id} value={c.id}>{c.name}{profiles[c.id] ? ' · perfil pronto' : ''}</option>)}</Select></Field>
        {cid && <CreatorProfileForm key={cid} creatorId={cid} onSaved={(r) => setProfiles({ ...profiles, [cid]: r })}/>}
      </div></section>
  </>;
}
