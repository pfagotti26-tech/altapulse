import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Clock3, TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';
import { api, errorText, money, duration, dateTime } from '../lib/api';
import { Avatar, Notice } from './Common';
import { FilterBar, usePersistedFilters, periodRange } from './MetricFilters';

// Boletim de qualidade: nota 0–100 por chatter (sem avaliação manual), tendência e alertas do dia
const PART = { speed: ['Velocidade', 'Tempo médio de resposta e % acima da meta'], care: ['Cuidado', 'Fãs que ficaram sem resposta'], conversion: ['Conversão', '% das ofertas que foram pagas'], productivity: ['Produtividade', 'Vendas por hora de turno, comparadas ao melhor da equipe'] };
const tone = (v) => v == null ? 'none' : v >= 80 ? 'good' : v >= 60 ? 'mid' : 'low';
const ALERT_ICON = { waiting: Clock3, offer: AlertTriangle, shift: Clock3, minor: AlertTriangle };

export function QualityBoard() {
  const [filters, setFilters] = usePersistedFilters();
  const [data, setData] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const { start, end } = periodRange(filters);
  const q = new URLSearchParams(); if (filters.creator_id) q.set('creator_id', filters.creator_id); if (start) q.set('start', start.toISOString()); if (end) q.set('end', end.toISOString());
  const query = q.toString();
  const load = useCallback(async () => { setLoading(true); setError(''); try { setData((await api.get(`/quality/scorecard?${query}`)).data); } catch (e) { setError(errorText(e)); } finally { setLoading(false); } }, [query]);
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  const chatters = (data?.chatters || []).filter(c => !filters.operator_id || c.operator_id === filters.operator_id);
  const alerts = data?.alerts || [];
  return <>
    <FilterBar filters={filters} setFilters={setFilters} loading={loading} onReload={load}/>
    {error && <Notice id="quality-error" tone="danger">{error}</Notice>}
    <section className="data-section" data-testid="quality-alerts">
      <div className="section-heading"><div><h2>Alertas de agora</h2><p>O que precisa de atenção neste momento, do mais urgente para o menos.</p></div><span className="count-label">{alerts.length}</span></div>
      {alerts.length ? <div className="qa-alerts">{alerts.map((a, i) => { const Icon = ALERT_ICON[a.kind] || AlertTriangle; return <div key={i} className={`qa-alert ${a.level}`}><Icon size={16}/><div><strong>{a.text}</strong><span>{[a.creator, a.who].filter(Boolean).join(' · ')}{a.at ? ` · ${dateTime(a.at)}` : ''}</span></div></div>; })}</div>
        : <div className="inline-empty">Nenhum alerta agora. Tudo em dia.</div>}
    </section>
    <section className="data-section" data-testid="quality-scorecard">
      <div className="section-heading"><div><h2>Nota de atendimento por chatter</h2><p>De 0 a 100, calculada sozinha pelo que o sistema mede. Comparada com o período anterior de mesmo tamanho. Meta de resposta: {data?.sla_minutes ?? '—'} min.</p></div></div>
      {chatters.length ? <div className="qa-grid">{chatters.map((c, i) => <article key={c.operator_id} className={`qa-card ${tone(c.score)}`} data-testid={`score-${c.operator_id}`}>
        <header><span className="qa-rank">{c.score != null ? `${i + 1}º` : ''}</span><Avatar name={c.name} src={c.avatar || null} size={38}/><div className="qa-who"><strong>{c.name}</strong><span>{c.hours} h de turno · {c.response_count} respostas</span></div>
          <div className="qa-score"><b>{c.score ?? '—'}</b>{c.trend != null && <em className={c.trend > 0 ? 'up' : c.trend < 0 ? 'down' : ''}>{c.trend > 0 ? <TrendingUp size={13}/> : c.trend < 0 ? <TrendingDown size={13}/> : <Minus size={13}/>}{c.trend > 0 ? '+' : ''}{c.trend}</em>}</div></header>
        {c.score == null && <p className="qa-note"><Info size={13}/>Dados insuficientes no período para dar nota.</p>}
        <div className="qa-parts">{Object.keys(PART).map(k => <div key={k} title={PART[k][1]}><span>{PART[k][0]}</span><i><u style={{ width: `${c.parts?.[k] ?? 0}%` }} className={tone(c.parts?.[k])}/></i><b>{c.parts?.[k] ?? '—'}</b></div>)}</div>
        <dl className="qa-facts"><div><dt>Resposta média</dt><dd>{duration(c.mean_seconds)}</dd></div><div><dt>Acima da meta</dt><dd>{c.late_pct != null ? `${c.late_pct}%` : '—'}</dd></div><div><dt>Sem resposta agora</dt><dd>{c.pending}</dd></div><div><dt>Ofertas pagas</dt><dd>{c.offers ? `${c.paid} de ${c.offers}` : '—'}</dd></div><div><dt>Vendas/hora</dt><dd>{money(c.sales_per_hour_cents)}</dd></div><div><dt>Ticket médio</dt><dd>{money(c.ticket_cents)}</dd></div></dl>
      </article>)}</div> : <div className="inline-empty">{loading ? 'Calculando…' : 'Nenhum chatter com turno ou atendimento no período.'}</div>}
    </section>
  </>;
}
