import React, { useState, useEffect, useCallback } from 'react';
import { MessageCircleHeart, Pencil, RefreshCw, History } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../App';
import { api, errorText, dateTime } from '../lib/api';
import { PageHeading, Button, Badge, Modal, Field, Select, Submit, FormError, Empty, Notice, Avatar } from '../components/Common';

// Lote 118 — Puxar conversa: frase curtinha para o fã online com a conversa parada. Separado da automação de resposta e do
// plantão: chave própria por criadora. Todas as travas (limite por hora, intervalo por fã, horário, pausa automática) são do servidor.
const pct = (s) => s && s.sent ? Math.round(100 * s.replied / s.sent) : null;

export default function Puxada() {
  const { user } = useApp();
  const [data, setData] = useState(null), [log, setLog] = useState([]), [tab, setTab] = useState('creators'), [modal, setModal] = useState(null), [cfg, setCfg] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loadError, setLoadError] = useState('');
  const load = useCallback(async () => { try { const [o, l] = await Promise.all([api.get('/puxada'), api.get('/puxada/log/list', { params: { days: 7 } })]); setData(o.data); setLog(l.data); setLoadError(''); } catch (e) { setLoadError(errorText(e)); } }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  async function toggle(c) { try { const r = await api.post(`/puxada/${c.creator_id}/toggle`); toast.success(r.data.enabled ? `Puxar conversa ligado para ${c.name}.` : `Puxar conversa desligado para ${c.name}.`); await load(); } catch (e) { toast.error(errorText(e)); } }
  async function edit(c) { setError(''); try { const r = await api.get(`/puxada/${c.creator_id}`); const { enabled, per_hour, window_start, window_end, cooldown_hours, idle_hours, auto } = r.data; setCfg({ enabled, per_hour, window_start, window_end, cooldown_hours, idle_hours, auto }); setModal(c); } catch (e) { toast.error(errorText(e)); } }
  async function save(e) { e.preventDefault(); setBusy(true); setError('');
    try { await api.put(`/puxada/${modal.creator_id}`, cfg); setModal(null); await load(); toast.success('Salvo.'); } catch (err) { setError(errorText(err)); } finally { setBusy(false); } }
  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }));
  if (user.role !== 'manager') return <Empty id="puxada-denied" title="Área restrita" description="Só gestores configuram o Puxar conversa."/>;
  const rows = data?.creators || [], on = rows.filter(r => r.enabled && !r.paused_reason);
  const sentLog = log.length, repliedLog = log.filter(r => r.replied_at).length;
  return <><PageHeading eyebrow="AGENTE DE CONVERSA" title="Puxar conversa" description="Uma frase curtinha, com contexto, para o assinante que está online agora com a conversa parada. Quem responde vira oportunidade para o chatter."><Button variant="outline" onClick={load}><RefreshCw size={15}/>Atualizar</Button></PageHeading>
    <div className="page-tabs"><button className={tab === 'creators' ? 'selected' : ''} onClick={() => setTab('creators')}><MessageCircleHeart size={16}/>Criadoras<span>{on.length} ligadas</span></button><button className={tab === 'log' ? 'selected' : ''} onClick={() => setTab('log')}><History size={16}/>Puxadas · 7 dias<span>{sentLog ? `${sentLog} · ${Math.round(100 * repliedLog / sentLog)}% responderam` : 0}</span></button></div>
    {loadError && <Notice id="puxada-load-error" tone="danger">{loadError}</Notice>}
    <Notice id="puxada-howto" tone="neutral">No app, o botão <b>💬 Puxar conversa</b> mostra quem está online nas criadoras ligadas. Um clique abre a conversa, a IA escreve a frase com o contexto do fã e deixa na caixa — <b>quem envia é o chatter</b>. Separado da automação de resposta: ligar ou desligar aqui não mexe nela.</Notice>
    {tab === 'creators' ? <section className="data-section"><div className="table-scroll"><table><thead><tr><th>Criadora</th><th>Puxar conversa</th><th>Horário</th><th>Limite</th><th>24 h</th><th>7 dias</th><th/></tr></thead><tbody>{rows.map(c => <tr key={c.creator_id}><td><div className="person-cell"><Avatar name={c.name} src={c.avatar} className="green"/><div><strong>{c.name}</strong>{c.auto && <span>envio automático ligado</span>}</div></div></td>
      <td><button type="button" className={`switch ${c.enabled && !c.paused_reason ? 'on' : ''}`} data-testid={`puxada-toggle-${c.creator_id}`} title={c.paused_reason ? 'Pausado: clique para religar' : c.enabled ? 'Desligar' : 'Ligar'} onClick={() => toggle(c)} aria-pressed={c.enabled}><i/></button>{c.paused_reason && <div><Badge tone="red">pausado</Badge> <small className="body-muted">{c.paused_reason}{c.paused_at ? ` · ${dateTime(c.paused_at)}` : ''}</small></div>}</td>
      <td>{c.window}</td><td>{c.per_hour}/hora</td>
      <td>{c.day.sent ? <><strong>{c.day.sent}</strong> · {c.day.replied} resp. ({pct(c.day)}%)</> : <span className="body-muted">—</span>}</td>
      <td>{c.week.sent ? <><strong>{c.week.sent}</strong> · {c.week.replied} resp. ({pct(c.week)}%)</> : <span className="body-muted">—</span>}</td>
      <td><div className="row-actions"><button className="icon-btn" title="Configurar" data-testid={`puxada-edit-${c.creator_id}`} onClick={() => edit(c)}><Pencil size={15}/></button></div></td></tr>)}</tbody></table></div></section>
    : <section className="data-section">{log.length ? <div className="table-scroll"><table><thead><tr><th>Quando</th><th>Criadora</th><th>Assinante</th><th>Mensagem</th><th>Quem</th><th>Respondeu</th></tr></thead><tbody>{log.map(r => <tr key={r.id}><td>{dateTime(r.sent_at)}</td><td>{r.creator_name}</td><td>{r.fan_name || <span className="body-muted">{r.fan_ref.slice(0, 8)}…</span>}</td><td className="body-muted">{r.text}{r.suggested && r.suggested !== r.text && <div style={{ fontSize: 11 }}>IA sugeriu: {r.suggested}</div>}</td><td>{r.auto ? <Badge tone="neutral">automático</Badge> : r.by_name}</td><td>{r.replied_at ? <Badge tone="green">{dateTime(r.replied_at)}</Badge> : <span className="body-muted">ainda não</span>}</td></tr>)}</tbody></table></div> : <Empty id="puxada-log-empty" icon={History} title="Nenhuma puxada ainda" description="Cada frase enviada aparece aqui, com quem respondeu."/>}</section>}
    <Modal title={`Puxar conversa · ${modal?.name || ''}`} description="Regras desta criadora. Valem para o botão do chatter e para qualquer envio automático." open={!!modal && !!cfg} onClose={() => setModal(null)} id="puxada-modal" wide>{cfg && <form className="form-stack" onSubmit={save}>
      <div className="form-grid"><Field id="px-enabled" label="Puxar conversa"><Select id="px-enabled" value={String(cfg.enabled)} onChange={e => set('enabled', e.target.value === 'true')}><option value="true">Ligado</option><option value="false">Desligado</option></Select></Field>
        <Field id="px-start" label="Começa às" type="time" value={cfg.window_start} onChange={e => set('window_start', e.target.value)}/><Field id="px-end" label="Termina às" type="time" value={cfg.window_end} onChange={e => set('window_end', e.target.value)}/></div>
      <div className="form-grid"><Field id="px-perhour" label="Máx. puxadas por hora" type="number" min={1} max={30} value={cfg.per_hour} onChange={e => set('per_hour', +e.target.value)}/>
        <Field id="px-cooldown" label="1 puxada por fã a cada (horas)" type="number" min={6} max={168} value={cfg.cooldown_hours} onChange={e => set('cooldown_hours', +e.target.value)}/>
        <Field id="px-idle" label="Pular quem falou há menos de (horas)" type="number" min={1} max={48} value={cfg.idle_hours} onChange={e => set('idle_hours', +e.target.value)}/></div>
      <Notice id="px-rules" tone="neutral">Sempre valem: nunca para quem está esperando resposta, bloqueado para a IA ou com mídia paga aguardando; quem não respondeu a uma puxada fica 3 dias sem outra; 15 puxadas seguidas sem resposta (ou 3 erros de envio) pausam a criadora e o religar é aqui.</Notice>
      <Field id="px-auto" label="Envio automático (sem clique do chatter)"><Select id="px-auto" value={String(!!cfg.auto)} disabled={!user.owner} onChange={e => set('auto', e.target.value === 'true')}><option value="false">Desligado — o chatter envia</option><option value="true">Ligado</option></Select></Field>
      {!user.owner && <p className="body-muted" style={{ margin: 0, fontSize: 12 }}>Só o dono da conta liga o envio automático.</p>}
      <FormError error={error}/><div className="form-actions"><Button type="button" variant="outline" onClick={() => setModal(null)}>Cancelar</Button><Submit id="save-puxada" busy={busy}>Salvar</Submit></div></form>}</Modal>
  </>;
}
