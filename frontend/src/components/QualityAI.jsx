import React, { useEffect, useState, useCallback } from 'react';
import { Sparkles, Trash2, CalendarDays, MessageSquareText, Clock3, Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, dateTime } from '../lib/api';
import { Button, Badge } from './Common';
import { periodRange, periodText } from './MetricFilters';

// Análise por IA (Claude): amostras capturadas por chatter no período + análises cujo período cruza o escolhido
const RUN_AT = '10h30';
const ymd = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
const dayLabel = (d) => { const [y, m, dd] = d.split('-'); const w = new Date(`${d}T12:00:00-03:00`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'America/Sao_Paulo' }).replace('.', ''); return `${w} ${dd}/${m}`; };
const shortDay = (iso) => iso ? dayLabel(ymd(iso)) : '—';
const covers = (i) => { const a = shortDay(i.period_start), b = shortDay(i.period_end); return a === b ? a : `${a} a ${b}`; };

export function QualityAI({ filters, reloadKey }) {
  const [insights, setInsights] = useState([]), [summary, setSummary] = useState(null), [status, setStatus] = useState(null), [open, setOpen] = useState(null), [apps, setApps] = useState([]), [health, setHealth] = useState(null);
  const { start, end } = periodRange(filters);
  const q = new URLSearchParams(); if (start) q.set('start', start.toISOString()); if (end) q.set('end', end.toISOString());
  const range = q.toString(); if (filters.creator_id) q.set('creator_id', filters.creator_id);
  const query = q.toString();
  const load = useCallback(() => Promise.all([
    api.get(`/quality/insights?${range}`).then(r => setInsights(r.data)).catch(() => {}),
    api.get(`/quality/samples/summary?${query}`).then(r => setSummary(r.data)).catch(() => setSummary(null)),
    api.get('/quality/status').then(r => setStatus(r.data)).catch(() => {}),
    api.get('/quality/apps').then(r => setApps(r.data)).catch(() => setApps([])),
    api.get('/quality/ai-health').then(r => setHealth(r.data)).catch(() => setHealth(null)),
  ]), [range, query, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  const remove = async (i) => { if (!window.confirm('Apagar esta análise?')) return; try { await api.delete(`/quality/insights/${i.id}`); load(); } catch (e) { toast.error(errorText(e)); } };

  // dias do período (até 14), para a grade de amostras por dia
  const days = [];
  if (start) { const last = end ? new Date(end.getTime() - 1) : new Date(); for (let d = new Date(start); d <= last && days.length < 31; d = new Date(d.getTime() + 864e5)) days.push(ymd(d.toISOString())); }
  const shownDays = days.slice(-14);
  const chatters = (summary?.chatters || []).filter(c => !filters.operator_id || c.operator_id === filters.operator_id);
  // análises agrupadas pelo dia das conversas (não pelo dia em que a IA rodou)
  const groups = {}; for (const i of insights) (groups[covers(i)] = groups[covers(i)] || []).push(i);
  const off = status && !status.enabled;

  return <section className="data-section" data-testid="quality-ai">
    <div className="section-heading"><div><h2><Sparkles size={16}/> Análise por IA (Claude)</h2><p>O Claude lê amostras anonimizadas das conversas (sem nome, telefone, e-mail ou link) e devolve nota, pontos fortes e o que melhorar de cada chatter.</p></div><span className="period-tag">{periodText(filters)}</span></div>
    <div className="ai-status">
      <span><Clock3 size={14}/>{off ? 'Desligada em Configurações' : `Roda todo dia às ${RUN_AT} com as conversas do dia anterior`}</span>
      <span><CalendarDays size={14}/>Última análise: {status?.last_insight_at ? dateTime(status.last_insight_at) : 'nenhuma ainda'}</span>
      <span><MessageSquareText size={14}/>{status ? `${status.samples_pending} conversas aguardando a próxima análise` : '—'}</span>
      <span><Clock3 size={14}/>Última conversa capturada: {summary?.last_sample_at ? dateTime(summary.last_sample_at) : 'nenhuma'}</span>
    </div>

    {health && <div className={`ai-health ${health.ok ? 'ok' : ''}`}>
      <div className="ai-health-head">{health.ok ? <CheckCircle2 size={16}/> : <AlertTriangle size={16}/>}<b>{health.ok ? 'A análise por IA está pronta para rodar' : 'Por que a IA está sem dados'}</b><span className="body-muted">{health.samples_pending} conversas aguardando · roda às {health.runs_at} · precisa: {health.needs}</span></div>
      {health.checks.length ? <ul>{health.checks.map((c, i) => <li key={i} className={c.level}>{c.level === 'red' ? <XCircle size={14}/> : <AlertTriangle size={14}/>}<div><strong>{c.text}</strong><span>{c.fix}</span></div></li>)}</ul> : <p className="body-muted">Tudo certo com os apps da equipe.</p>}
    </div>}
    <h3 className="ai-sub">Análises</h3>
    {Object.keys(groups).length ? Object.entries(groups).map(([label, list]) => <div key={label} className="ai-day-group">
      <div className="ai-day-label"><CalendarDays size={14}/>Conversas de {label}</div>
      {list.map(i => <div className="notice" key={i.id} style={{ display: 'block' }} data-testid={`insight-${i.id}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}><strong>{i.samples || i.items.length} conversas · analisado em {dateTime(i.created_at)}</strong><span className="row-actions"><Button variant="ghost" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? 'Recolher' : 'Ver por chatter'}</Button><Button variant="ghost" onClick={() => remove(i)}><Trash2 size={14}/></Button></span></div>
        <p style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{i.summary}</p>
        {open === i.id && <>{i.recommendations && <p style={{ whiteSpace: 'pre-wrap' }}><strong>Recomendações:</strong> {i.recommendations}</p>}{i.items.length ? <div className="table-scroll"><table><thead><tr><th>Chatter</th><th>Criadora</th><th>Nota</th><th>Engajamento</th><th>Pontos fortes</th><th>Melhorar</th><th>Como poderia ter sido</th></tr></thead><tbody>{i.items.map((it, k) => <tr key={k}><td><strong>{it.operator_name || '—'}</strong></td><td>{it.creator_name || '—'}</td><td><Badge tone={it.score == null ? 'neutral' : it.score >= 8 ? 'green' : it.score >= 6 ? 'neutral' : 'amber'}>{it.score == null ? '—' : `${it.score}/10`}</Badge></td><td>{it.engagement != null ? <Badge tone={it.engagement >= 8 ? 'green' : it.engagement >= 6 ? 'neutral' : 'amber'}>{it.engagement}/10</Badge> : '—'}{it.dry_pct != null && <small className="body-muted"><br/>{it.dry_pct}% secas</small>}</td><td>{it.strengths}</td><td>{it.improve}</td><td className="body-muted">{it.rewrite || it.example}</td></tr>)}</tbody></table></div> : null}</>}
      </div>)}
    </div>) : <div className="inline-empty">{off ? 'Ligue "Análise de qualidade por IA" em Configurações e gere a chave da tarefa.' : `Nenhuma análise com conversas deste período. Escolha outro período acima (Ontem, 7 dias, Personalizado…) para ver dias anteriores.`}</div>}

    <h3 className="ai-sub">Apps da equipe</h3>
    {apps.length ? <div className="table-scroll"><table><thead><tr><th>Pessoa</th><th>Versão do app</th><th>Visto por último</th><th>IA ligada no app</th><th>Última conversa enviada</th><th>Problema</th></tr></thead><tbody>
      {apps.map(a => <tr key={a.user_id}><td><strong>{a.user_name}</strong>{a.role === 'manager' ? <span className="body-muted"> · gestor</span> : ''}</td><td className="tabular">{a.version}</td><td>{dateTime(a.last_seen)}</td><td>{a.quality_ai && a.storage ? 'sim' : <span className="ai-bad">não</span>}</td><td>{a.sample_ok_at ? `${dateTime(a.sample_ok_at)} · ${a.samples_sent} hoje` : '—'}</td><td>{a.sample_error ? <span className="ai-bad" title={dateTime(a.sample_error_at)}>{a.sample_error}</span> : a.sample_skip ? <span className="body-muted">{a.sample_skip}</span> : '—'}</td></tr>)}
    </tbody></table></div> : <div className="inline-empty">Nenhum app informou ainda. Os apps a partir da versão 1.4.2 aparecem aqui sozinhos em até 5 minutos.</div>}

    <h3 className="ai-sub">Conversas capturadas para a IA no período</h3>
    {chatters.length ? <div className="table-scroll"><table className="ai-days"><thead><tr><th>Chatter</th><th>Criadoras</th>{shownDays.map(d => <th key={d}>{dayLabel(d)}</th>)}<th>Total</th><th>Aguardando</th></tr></thead>
      <tbody>{chatters.map(c => <tr key={c.operator_id || c.name}><td><strong>{c.name}</strong></td><td className="body-muted">{c.creators.join(', ')}</td>{shownDays.map(d => <td key={d} className={c.days[d] ? 'has' : 'zero'}>{c.days[d] || '·'}</td>)}<td><strong>{c.count}</strong></td><td>{c.pending}</td></tr>)}</tbody></table></div>
      : <div className="ai-empty"><Info size={15}/><div><strong>Nenhuma conversa capturada {filters.operator_id ? 'deste chatter ' : ''}neste período.</strong>
        <p>A captura acontece no app Alta Pulse do chatter quando: o turno dele está ativo (não pausado), a opção "Análise de qualidade por IA" está ligada em Configurações, o app está atualizado e há uma conversa aberta (Privacy, OnlyFans ou FatalFans) com pelo menos 3 mensagens. A tabela "Apps da equipe" acima mostra o motivo quando não chega nada. As amostras ficam guardadas {summary?.keep_days || 14} dias.</p>
        {summary?.senders?.length ? <p>Quem enviou por último: {summary.senders.slice(0, 4).map(s => `${s.name} (${dateTime(s.last_at)})`).join(' · ')}</p> : null}</div></div>}

  </section>;
}
