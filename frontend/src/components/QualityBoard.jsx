import React, { useEffect, useState, useCallback } from 'react';
import { Clock3, TrendingUp, TrendingDown, Minus, Info, ChevronDown, ChevronRight, Target, MessageCircleOff, BadgeDollarSign, ShieldAlert, Hourglass } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, money, duration, dateTime } from '../lib/api';
import { Avatar, Notice, Modal, Button, Field } from './Common';
import { periodRange, periodText } from './MetricFilters';
import { ChatterDashboard } from './ChatterDashboard';

// Boletim de vendas da equipe: nota 0–100 contra as METAS do gestor, alertas resumidos e painel de cada chatter
const PART = { speed: ['Resposta', '% das respostas dentro da meta de tempo'], care: ['Cuidado', 'Fãs que ficaram sem resposta'], conversion: ['Conversão', 'Ofertas pagas comparadas à meta'], productivity: ['R$/hora', 'Vendas por hora de turno comparadas à meta'] };
const tone = (v) => v == null ? 'none' : v >= 80 ? 'good' : v >= 60 ? 'mid' : 'low';
const KINDS = [
  ['minor', 'Possível menor', ShieldAlert, 'red'], ['waiting', 'Fãs esperando acima da meta', MessageCircleOff, 'red'],
  ['offer', 'Ofertas sem pagamento há +24 h', BadgeDollarSign, 'amber'], ['shift', 'Turnos esquecidos', Clock3, 'amber'],
  ['stale', 'Fãs parados há +48 h (para reativar)', Hourglass, 'gray'],
];

function Alerts({ alerts }) {
  const [open, setOpen] = useState(null);
  const groups = KINDS.map(([k, label, Icon, lv]) => ({ k, label, Icon, lv, items: alerts.filter(a => a.kind === k) })).filter(g => g.items.length);
  if (!groups.length) return <div className="inline-empty">Nenhum alerta agora. Tudo em dia.</div>;
  return <div className="qa-sum">
    <div className="qa-chips">{groups.map(g => <button key={g.k} type="button" className={`qa-chip ${g.lv} ${open === g.k ? 'on' : ''}`} onClick={() => setOpen(open === g.k ? null : g.k)}><g.Icon size={15}/><b>{g.items.length}</b><span>{g.label}</span>{open === g.k ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</button>)}</div>
    {open && (() => { const g = groups.find(x => x.k === open); if (!g) return null; const by = {}; for (const a of g.items) (by[a.creator || 'Sem criadora'] = by[a.creator || 'Sem criadora'] || []).push(a);
      return <div className="qa-open">{Object.entries(by).map(([c, list]) => <div key={c} className="qa-group"><div className="qa-group-head">{c}<span>{list.length}</span></div>
        {list.map((a, i) => <div key={i} className={`qa-alert ${a.level}`}><g.Icon size={14}/><div><strong>{a.text}</strong><span>{a.who && a.who !== 'Sem atribuição' ? a.who : 'sem chatter no turno'}{a.at ? ` · desde ${dateTime(a.at)}` : ''}</span></div></div>)}</div>)}</div>; })()}
  </div>;
}

function GoalsModal({ open, onClose, onSaved }) {
  const [g, setG] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (open) api.get('/quality/goals').then(r => setG({ ...r.data, hour: String(r.data.goal_sales_hour_cents / 100) })).catch(e => toast.error(errorText(e))); }, [open]);
  const save = async () => { setBusy(true); try { await api.put('/quality/goals', { sla_minutes: Number(g.sla_minutes), goal_conversion_pct: Number(g.goal_conversion_pct), goal_sales_hour_cents: Math.round(Number(String(g.hour).replace(',', '.')) * 100) }); toast.success('Metas salvas.'); onSaved(); onClose(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } };
  return <Modal open={open} onClose={onClose} title="Metas da equipe" description="A nota de cada chatter mede o quanto ele bate estas metas." id="goals-modal">{g && <div className="form-stack">
    <Field id="goal-sla" label="Tempo de resposta (minutos)" type="number" min={1} max={120} value={g.sla_minutes} onChange={e => setG({ ...g, sla_minutes: e.target.value })}/>
    <Field id="goal-conv" label="Conversão de ofertas (%)" type="number" min={1} max={100} value={g.goal_conversion_pct} onChange={e => setG({ ...g, goal_conversion_pct: e.target.value })}/>
    <Field id="goal-hour" label="Vendas por hora de turno (R$)" value={g.hour} onChange={e => setG({ ...g, hour: e.target.value })}/>
    <div className="form-actions"><Button disabled={busy} onClick={save}>Salvar metas</Button></div></div>}</Modal>;
}

export function QualityBoard({ filters, reloadKey }) {
  const [data, setData] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [managers, setManagers] = useState(false), [goalsOpen, setGoalsOpen] = useState(false), [who, setWho] = useState(null), [nonce, setNonce] = useState(0);
  const { start, end } = periodRange(filters);
  const q = new URLSearchParams(); if (filters.creator_id) q.set('creator_id', filters.creator_id); if (start) q.set('start', start.toISOString()); if (end) q.set('end', end.toISOString()); if (managers) q.set('managers', 'true');
  const query = q.toString();
  const load = useCallback(async () => { setLoading(true); setError(''); try { setData((await api.get(`/quality/scorecard?${query}`)).data); } catch (e) { setError(errorText(e)); } finally { setLoading(false); } }, [query, reloadKey, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  const chatters = (data?.chatters || []).filter(c => !filters.operator_id || c.operator_id === filters.operator_id);
  const g = data?.goals;
  return <>
    {error && <Notice id="quality-error" tone="danger">{error}</Notice>}
    <section className="data-section" data-testid="quality-alerts">
      <div className="section-heading"><div><h2>Alertas de agora</h2><p>Resumo do que precisa de ação. Clique num item para ver a lista, separada por criadora.</p></div></div>
      <Alerts alerts={data?.alerts || []}/>
    </section>
    <section className="data-section" data-testid="quality-scorecard">
      <div className="section-heading"><div><h2>Nota de atendimento por chatter</h2><p>De 0 a 100, contra as metas: resposta em até {g?.sla_minutes ?? '—'} min, conversão de {g?.goal_conversion_pct ?? '—'}% e {g ? money(g.goal_sales_hour_cents) : '—'} por hora de turno. Clique no chatter para ver o painel dele.</p></div>
        <div className="row-actions"><label className="checkbox-label small"><input type="checkbox" checked={managers} onChange={e => setManagers(e.target.checked)}/><span>incluir gestores</span></label><Button variant="outline" onClick={() => setGoalsOpen(true)}><Target size={14}/>Metas</Button><span className="period-tag">{periodText(filters)}</span></div></div>
      {chatters.length ? <div className="qa-grid">{chatters.map((c, i) => <article key={c.operator_id} className={`qa-card clickable ${tone(c.score)}`} data-testid={`score-${c.operator_id}`} onClick={() => setWho(c)} title="Abrir o painel do chatter">
        <header><span className="qa-rank">{c.score != null ? `${i + 1}º` : ''}</span><Avatar name={c.name} src={c.avatar || null} size={38}/><div className="qa-who"><strong>{c.name}</strong><span>{c.hours} h de turno · {c.fans_attended} fãs atendidos</span></div>
          <div className="qa-score"><b>{c.score ?? '—'}</b>{c.trend != null && <em className={c.trend > 0 ? 'up' : c.trend < 0 ? 'down' : ''}>{c.trend > 0 ? <TrendingUp size={13}/> : c.trend < 0 ? <TrendingDown size={13}/> : <Minus size={13}/>}{c.trend > 0 ? '+' : ''}{c.trend}</em>}</div></header>
        {c.score == null && <p className="qa-note"><Info size={13}/>Dados insuficientes no período para dar nota.</p>}
        <div className="qa-parts">{Object.keys(PART).map(k => <div key={k} title={PART[k][1]}><span>{PART[k][0]}</span><i><u style={{ width: `${c.parts?.[k] ?? 0}%` }} className={tone(c.parts?.[k])}/></i><b>{c.parts?.[k] ?? '—'}</b></div>)}</div>
        <dl className="qa-facts"><div><dt>Faturou</dt><dd>{money(c.sales_cents)}</dd></div><div><dt>R$/hora</dt><dd>{money(c.sales_per_hour_cents)}</dd></div><div><dt>Conversão</dt><dd>{c.offers ? `${c.conversion}% (${c.paid}/${c.offers})` : '—'}</dd></div><div><dt>Resposta (mediana)</dt><dd>{duration(c.median_seconds)}</dd></div><div><dt>Na meta</dt><dd>{c.within_goal_pct != null ? `${c.within_goal_pct}%` : '—'}</dd></div><div><dt>Sem resposta agora</dt><dd>{c.pending}</dd></div></dl>
        {c.creators?.length > 0 && <div className="qa-mini">{c.creators.slice(0, 4).map(x => <span key={x.creator_id}>{x.creator_name}: <b>{money(x.sales_cents)}</b> · {x.hours} h</span>)}{c.creators.length > 4 && <span>+{c.creators.length - 4} criadoras</span>}</div>}
      </article>)}</div> : <div className="inline-empty">{loading ? 'Calculando…' : 'Nenhum chatter com turno ou atendimento no período.'}</div>}
    </section>
    <GoalsModal open={goalsOpen} onClose={() => setGoalsOpen(false)} onSaved={() => setNonce(n => n + 1)}/>
    <Modal wide open={!!who} onClose={() => setWho(null)} title={who ? `Painel · ${who.name}` : ''} description={periodText(filters)} id="chatter-dashboard">{who && <ChatterDashboard operatorId={who.operator_id} filters={filters}/>}</Modal>
  </>;
}
