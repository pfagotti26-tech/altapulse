import React, { useState, useEffect, useCallback } from 'react';
import { Handshake, BellRing, FileChartColumn, Inbox, RefreshCw, Timer, Banknote, UserX, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../App';
import { api, errorText, money, dateTime } from '../lib/api';
import { PageHeading, Button, Input, Badge, Modal, Field, Select, Submit, FormError, Empty, Notice, Stat, SectionHeading } from '../components/Common';

// Lote 160 — Passagem para humano + Avisos. A IA conversa até o fã cumprir uma regra; aí o fã vai para o chatter ATRIBUÍDO à criadora
// (popup no app, Telegram). Tudo liga/desliga e é editável aqui; regra por criadora substitui a geral.
const URG = { alta: ['red', 'Alta'], media: ['amber', 'Média'], baixa: ['neutral', 'Baixa'] };
const STATUS = { aberta: ['amber', 'aguardando'], escalada: ['red', 'foi ao gestor'], assumida: ['green', 'assumida'], devolvida: ['neutral', 'devolvida à IA'] };
const reais = c => c == null ? '' : String((c / 100).toFixed(2)).replace('.', ',');
const cents = v => Math.round(parseFloat(String(v || '0').replace(/\./g, '').replace(',', '.')) * 100) || 0;
const Sw = ({ on, onClick, label, id }) => <button type="button" className={`switch ${on ? 'on' : ''}`} aria-pressed={!!on} aria-label={label} title={label} data-testid={id} onClick={onClick}><i/></button>;

function RulesForm({ cfg, setCfg, meta }) {
  const rule = (k, patch) => setCfg(c => ({ ...c, rules: { ...c.rules, [k]: { ...(c.rules?.[k] || {}), ...patch } } }));
  return <div className="form-stack">
    {Object.entries(meta.rules).map(([k, r]) => { const v = cfg.rules?.[k] || {}; return <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Sw on={v.on} label={r.label} id={`hv-rule-${k}`} onClick={() => rule(k, { on: !v.on })}/><span style={{ flex: 1 }}>{r.label}</span>
      {r.value && <Input style={{ width: 130 }} aria-label={`${r.label} (R$)`} data-testid={`hv-cents-${k}`} defaultValue={reais(v.cents)} onBlur={e => rule(k, { cents: cents(e.target.value) })} placeholder="R$"/>}</div>; })}
    <div className="form-grid">
      <Field id="hv-timeout" label="Ninguém assumiu em (min) → avisa o gestor" type="number" min={1} max={240} value={cfg.timeout_min} onChange={e => setCfg(c => ({ ...c, timeout_min: +e.target.value }))}/>
      <Field id="hv-noshift" label="Sem chatter de turno"><Select id="hv-noshift" value={cfg.no_shift} onChange={e => setCfg(c => ({ ...c, no_shift: e.target.value }))}>{Object.entries(meta.no_shift).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <Field id="hv-return" label="Volta para a IA depois de (dias)" type="number" min={1} max={90} value={cfg.return_days} onChange={e => setCfg(c => ({ ...c, return_days: +e.target.value }))}/>
    </div></div>;
}

function PassagemTab() {
  const [meta, setMeta] = useState(null), [cfg, setCfg] = useState(null), [own, setOwn] = useState(null), [ownCfg, setOwnCfg] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = useCallback(async () => { try { const r = await api.get('/handover/config'); setMeta(r.data); setCfg(r.data.cfg); } catch (e) { toast.error(errorText(e)); } }, []);
  useEffect(() => { load(); }, [load]);
  async function save() { setBusy(true); try { await api.post('/handover/config', { cfg }); toast.success('Regras salvas.'); await load(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } }
  async function toggleCreator(c) { const base = c.own || { ...cfg }; try { await api.post('/handover/config', { creator_id: c.creator_id, cfg: { ...base, enabled: !(c.own ? c.own.enabled : cfg.enabled) } }); await load(); } catch (e) { toast.error(errorText(e)); } }
  async function saveOwn(e) { e.preventDefault(); setBusy(true); setError(''); try { await api.post('/handover/config', { creator_id: own.creator_id, cfg: ownCfg }); setOwn(null); await load(); toast.success(`Regras de ${own.name} salvas.`); } catch (err) { setError(errorText(err)); } finally { setBusy(false); } }
  async function useGeneral() { try { await api.post('/handover/config', { creator_id: own.creator_id, cfg: null }); setOwn(null); await load(); toast.success('Voltou para a regra geral.'); } catch (e) { toast.error(errorText(e)); } }
  if (!meta || !cfg) return null;
  const val = (c, k) => { const src = c.own || cfg; const r = src.rules?.[k]; return r?.on ? `${money(r.cents)}${c.own ? '' : ' (geral)'}` : '—'; };
  return <>
    <section className="data-section"><SectionHeading title="Regra geral" caption="Qualquer regra ligada que o fã cumprir faz a passagem. A IA para e os chatters atribuídos à criadora são avisados.">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Sw on={cfg.enabled} label="Passagem ligada" id="hv-enabled" onClick={() => setCfg(c => ({ ...c, enabled: !c.enabled }))}/><b>{cfg.enabled ? 'Ligada' : 'Desligada'}</b><Button data-testid="hv-save" onClick={save} disabled={busy}>Salvar regras</Button></div></SectionHeading>
      <RulesForm cfg={cfg} setCfg={setCfg} meta={meta}/>
      <Notice id="hv-howto" tone="neutral">Sem chatter de turno (madrugada), a escolha acima vale: <b>IA segue, sem oferta cara</b> mantém a conversa e não oferece nada acima da compra única. Quem assumir no app fica com o fã; o botão <b>Devolver à IA</b> encerra a passagem.</Notice>
    </section>
    <section className="data-section"><SectionHeading title="Por criadora" caption="Regra própria substitui a geral."/>
      <div className="table-scroll"><table><thead><tr><th>Criadora</th><th>Passagem</th><th>Gasto total</th><th>Compra única</th><th>Chatters atribuídos</th><th>7 dias</th><th/></tr></thead><tbody>
        {meta.creators.map(c => { const on = c.own ? c.own.enabled : cfg.enabled; return <tr key={c.creator_id}><td><strong>{c.name}</strong>{c.own && <div className="body-muted" style={{ fontSize: 12 }}>regra própria</div>}</td>
          <td><Sw on={on} label={on ? 'Desligar' : 'Ligar'} id={`hv-toggle-${c.creator_id}`} onClick={() => toggleCreator(c)}/></td><td>{val(c, 'total')}</td><td>{val(c, 'single')}</td>
          <td>{c.chatters.length ? c.chatters.join(', ') : <Badge tone="amber">nenhum atribuído · vai ao gestor</Badge>}</td><td>{c.week || <span className="body-muted">—</span>}</td>
          <td><Button variant="outline" data-testid={`hv-own-${c.creator_id}`} onClick={() => { setError(''); setOwn(c); setOwnCfg(JSON.parse(JSON.stringify(c.own || cfg))); }}>Editar</Button></td></tr>; })}
      </tbody></table></div></section>
    <Modal title={`Passagem · ${own?.name || ''}`} description="Regras só desta criadora. Salvar cria a regra própria; ela substitui a geral." open={!!own} onClose={() => setOwn(null)} id="hv-own-modal" wide>{own && ownCfg && <form className="form-stack" onSubmit={saveOwn}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Sw on={ownCfg.enabled} label="Passagem ligada" id="hv-own-enabled" onClick={() => setOwnCfg(c => ({ ...c, enabled: !c.enabled }))}/><b>{ownCfg.enabled ? 'Ligada' : 'Desligada'} para {own.name}</b></div>
      <RulesForm cfg={ownCfg} setCfg={setOwnCfg} meta={meta}/><FormError error={error}/>
      <div className="form-actions">{own.own && <Button type="button" variant="outline" onClick={useGeneral}>Usar a regra geral</Button>}<Button type="button" variant="outline" onClick={() => setOwn(null)}>Cancelar</Button><Submit id="hv-own-save" busy={busy}>Salvar</Submit></div></form>}</Modal>
  </>;
}

function AvisosTab() {
  const [d, setD] = useState(null), [cfg, setCfg] = useState(null), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { const r = await api.get('/notify/config'); setD(r.data); setCfg(r.data.cfg); } catch (e) { toast.error(errorText(e)); } }, []);
  useEffect(() => { load(); }, [load]);
  if (!d || !cfg) return null;
  const ev = (k, f, v) => setCfg(c => ({ ...c, events: { ...c.events, [k]: { ...c.events[k], [f]: v } } }));
  async function save() { setBusy(true); try { await api.post('/notify/config', { cfg }); toast.success('Avisos salvos.'); await load(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } }
  const box = (k, f) => <input type="checkbox" checked={!!cfg.events[k][f]} aria-label={`${d.events[k].label}: ${f}`} data-testid={`nt-${k}-${f}`} onChange={e => ev(k, f, e.target.checked)}/>;
  return <>
    <section className="data-section"><SectionHeading title="Eventos" caption="O aviso vai só para quem tem a criadora atribuída. Sem atribuído, vai para o gestor."><Button data-testid="nt-save" onClick={save} disabled={busy}>Salvar avisos</Button></SectionHeading>
      <div className="table-scroll"><table><thead><tr><th>Evento</th><th>Ligado</th><th>Chatter atribuído</th><th>Gestor</th><th>Popup no app</th><th>Telegram</th><th>E-mail</th><th>Urgência</th></tr></thead><tbody>
        {Object.entries(d.events).map(([k, e]) => <tr key={k}><td><strong>{e.label}</strong><div className="body-muted" style={{ fontSize: 12 }}>{e.hint}</div></td>
          <td><Sw on={cfg.events[k].on} label={`${e.label} ligado`} id={`nt-${k}-on`} onClick={() => ev(k, 'on', !cfg.events[k].on)}/></td>
          <td>{box(k, 'chatter')}</td><td>{box(k, 'manager')}</td><td>{box(k, 'popup')}</td><td>{box(k, 'telegram')}</td><td>{box(k, 'email')}</td>
          <td><Select id={`nt-${k}-urg`} value={cfg.events[k].urgency} onChange={x => ev(k, 'urgency', x.target.value)}>{Object.entries(URG).map(([u, [, l]]) => <option key={u} value={u}>{l}</option>)}</Select></td></tr>)}
      </tbody></table></div>
      {cfg.events.pagamento && <p className="body-muted" style={{ fontSize: 12, margin: '10px 0 0' }}>O e-mail de mídia paga do gestor continua saindo sempre; o e-mail aqui é para os chatters.</p>}</section>
    <div className="form-grid" style={{ alignItems: 'start' }}>
      <section className="data-section"><SectionHeading title="Regras de entrega"/><div className="form-stack">
        <label style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Sw on={cfg.shift_first} label="De turno primeiro" id="nt-shift" onClick={() => setCfg(c => ({ ...c, shift_first: !c.shift_first }))}/><span>Só para quem está de turno na criadora; fora do turno, para todos os atribuídos</span></label>
        <label style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Sw on={cfg.popup_sticky} label="Popup fixo" id="nt-sticky" onClick={() => setCfg(c => ({ ...c, popup_sticky: !c.popup_sticky }))}/><span>Popup de urgência alta fica na tela até o chatter assumir ou adiar</span></label>
        <Field id="nt-group" label="Juntar avisos do mesmo fã em (min)" type="number" min={0} max={60} value={cfg.group_min} onChange={e => setCfg(c => ({ ...c, group_min: +e.target.value }))}/>
        <label style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><Sw on={cfg.quiet?.on} label="Silêncio no Telegram" id="nt-quiet" onClick={() => setCfg(c => ({ ...c, quiet: { ...c.quiet, on: !c.quiet?.on } }))}/><span>Silêncio no Telegram das</span>
          <Input type="time" style={{ width: 110 }} value={cfg.quiet?.start || '03:00'} onChange={e => setCfg(c => ({ ...c, quiet: { ...c.quiet, start: e.target.value } }))} aria-label="Início"/><span>às</span>
          <Input type="time" style={{ width: 110 }} value={cfg.quiet?.end || '08:00'} onChange={e => setCfg(c => ({ ...c, quiet: { ...c.quiet, end: e.target.value } }))} aria-label="Fim"/></label>
      </div></section>
      <section className="data-section"><SectionHeading title="Telegram de cada pessoa" caption="Cada um conecta o próprio Telegram em Minha conta, com um código. Ninguém digita telefone."/>
        {!d.telegram_ready && <Notice id="nt-tg-off" tone="amber">O bot do Telegram ainda não foi configurado no servidor. Popup no app e e-mail já funcionam.</Notice>}
        <div className="form-stack">{d.people.filter(p => p.role !== 'manager' || p.creators.length).map(p => <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>{p.name}{p.creators.length ? <span className="body-muted"> · {p.creators.join(', ')}</span> : ''}</span>{p.telegram ? <Badge tone="green">conectado</Badge> : <Badge tone="amber">não conectou</Badge>}</div>)}</div></section>
    </div>
  </>;
}

function AbertasTab() {
  const [rows, setRows] = useState(null);
  const load = useCallback(async () => { try { const r = await api.get('/handover/list', { params: { status: 'abertas' } }); setRows(r.data); } catch (e) { toast.error(errorText(e)); } }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  async function act(h, what) { try { await api.post(`/handover/${h.id}/${what}`); toast.success(what === 'take' ? 'Assumida.' : 'Devolvida para a IA.'); await load(); } catch (e) { toast.error(errorText(e)); } }
  if (!rows) return null;
  if (!rows.length) return <Empty id="hv-open-empty" icon={Inbox} title="Nenhuma passagem aberta" description="Quando um fã cumprir uma regra, ele aparece aqui e no app dos chatters atribuídos."/>;
  return <section className="data-section"><div className="table-scroll"><table><thead><tr><th>Quando</th><th>Criadora</th><th>Fã</th><th>Motivo</th><th>Situação</th><th/></tr></thead><tbody>
    {rows.map(h => <tr key={h.id}><td>{dateTime(h.created_at)}</td><td>{h.creator_name}</td><td>{h.fan_name || <span className="body-muted">{h.fan_ref.slice(0, 8)}…</span>}</td><td>{h.detail}{h.last_fan && <div className="body-muted" style={{ fontSize: 12 }}>"{h.last_fan.slice(-90)}"</div>}</td>
      <td><Badge tone={STATUS[h.status][0]}>{STATUS[h.status][1]}{h.taken_name ? ` · ${h.taken_name}` : ''}</Badge>{h.mode === 'sem_caro' && <div className="body-muted" style={{ fontSize: 12 }}>IA segue sem oferta cara</div>}</td>
      <td><div className="row-actions">{h.status !== 'assumida' && <Button variant="outline" onClick={() => act(h, 'take')}>Assumir</Button>}<Button variant="outline" onClick={() => act(h, 'return')}>Devolver à IA</Button></div></td></tr>)}
  </tbody></table></div></section>;
}

function RelatorioTab() {
  const { creators } = useApp();
  const [days, setDays] = useState(7), [cid, setCid] = useState(''), [d, setD] = useState(null);
  const load = useCallback(async () => { try { const r = await api.get('/handover/report', { params: { days, creator_id: cid } }); setD(r.data); } catch (e) { toast.error(errorText(e)); } }, [days, cid]);
  useEffect(() => { load(); }, [load]);
  if (!d) return null; const k = d.kpis;
  return <>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>{[1, 7, 30].map(n => <Button key={n} variant={days === n ? 'default' : 'outline'} onClick={() => setDays(n)}>{n === 1 ? 'Hoje' : `${n} dias`}</Button>)}
      <Select id="hv-rep-creator" value={cid} onChange={e => setCid(e.target.value)}><option value="">Todas as criadoras</option>{(creators || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
    <div className="stats-grid"><Stat id="hv-k-total" label="Passagens" value={k.total} caption="fãs entregues ao chatter" icon={Handshake}/><Stat id="hv-k-min" label="Tempo até assumir" value={k.median_min == null ? '—' : `${k.median_min} min`} caption="mediana" icon={Timer}/>
      <Stat id="hv-k-sold" label="Venda depois da passagem" value={money(k.sold_cents)} caption="em até 48 h" icon={Banknote} tone="green"/><Stat id="hv-k-none" label="Sem ninguém assumir" value={k.no_one} caption="foram para o gestor" icon={UserX}/></div>
    <section className="data-section"><SectionHeading title="Por chatter"/>{d.people.length ? <div className="table-scroll"><table><thead><tr><th>Chatter</th><th>Criadoras</th><th>Passagens recebidas</th><th>Assumiu</th><th>Tempo até assumir</th><th>Vendeu depois</th><th>Avisos lidos</th></tr></thead><tbody>
      {d.people.map((p, i) => <tr key={i}><td><strong>{p.name}</strong></td><td>{p.creators.join(', ')}</td><td>{p.received}</td><td>{p.taken}</td><td>{p.median_min == null ? '—' : `${p.median_min} min`}</td><td>{money(p.sold_cents)}</td><td>{p.seen_pct == null ? '—' : `${p.seen_pct}%`}</td></tr>)}
    </tbody></table></div> : <Empty id="hv-rep-people-empty" icon={Users} title="Sem passagens no período" description="Os números aparecem quando a passagem estiver ligada."/>}</section>
    <section className="data-section"><SectionHeading title="Últimas passagens"/>{d.rows.length ? <div className="table-scroll"><table><thead><tr><th>Quando</th><th>Criadora</th><th>Fã</th><th>Regra</th><th>Assumiu</th><th>Resultado</th></tr></thead><tbody>
      {d.rows.map(h => <tr key={h.id}><td>{dateTime(h.created_at)}</td><td>{h.creator_name}</td><td>{h.fan_name || '—'}</td><td>{h.detail}</td><td>{h.taken_name ? `${h.taken_name} · ${h.minutes} min` : '—'}</td>
        <td>{h.sold_cents ? <Badge tone="green">vendeu {money(h.sold_cents)}</Badge> : <Badge tone={STATUS[h.status]?.[0] || 'neutral'}>{STATUS[h.status]?.[1] || h.status}</Badge>}</td></tr>)}
    </tbody></table></div> : null}</section>
  </>;
}

export default function Passagem() {
  const { user } = useApp();
  const [tab, setTab] = useState('passagem'), [n, setN] = useState(0), [k, setK] = useState(0);
  useEffect(() => { api.get('/handover/list', { params: { status: 'abertas' } }).then(r => setN(r.data.length)).catch(() => {}); }, [tab, k]);
  if (user.role !== 'manager') return <Empty id="hv-denied" title="Área restrita" description="Só gestores configuram a passagem e os avisos."/>;
  const T = (k, Icon, label, extra) => <button className={tab === k ? 'selected' : ''} data-testid={`hv-tab-${k}`} onClick={() => setTab(k)}><Icon size={16}/>{label}{extra != null && <span>{extra}</span>}</button>;
  return <><PageHeading eyebrow="AGENTE DE CONVERSA" title="Passagem e avisos" description="A IA conversa até o fã cumprir uma regra. Aí ela para, o fã vai para o chatter da criadora e ele é avisado no app e no Telegram."><Button variant="outline" onClick={() => setK(x => x + 1)}><RefreshCw size={15}/>Atualizar</Button></PageHeading>
    <div className="page-tabs">{T('passagem', Handshake, 'Passagem para humano')}{T('abertas', Inbox, 'Em aberto', n)}{T('avisos', BellRing, 'Avisos')}{T('relatorio', FileChartColumn, 'Relatório')}</div>
    <div key={`${tab}-${k}`}>{tab === 'passagem' ? <PassagemTab/> : tab === 'abertas' ? <AbertasTab/> : tab === 'avisos' ? <AvisosTab/> : <RelatorioTab/>}</div>
  </>;
}
