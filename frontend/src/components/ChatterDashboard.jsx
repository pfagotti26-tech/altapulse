import React, { useEffect, useState } from 'react';
import { Sparkles, ArrowUp, ArrowDown } from 'lucide-react';
import { api, errorText, money, duration, dateTime } from '../lib/api';
import { Badge, Notice } from './Common';
import { periodRange } from './MetricFilters';
import { Tip } from './QualityBoard';

// Painel individual do chatter: resultado, processo, por criadora, dia a dia e o que a IA disse dele
const dayLabel = (d) => { const [, m, dd] = d.split('-'); return `${dd}/${m}`; };

function Kpi({ label, value, hint, team, better, raw, goal, tip }) {
  // comparação com a mediana da equipe (seta verde = melhor que a equipe)
  let cmp = null;
  if (team != null && raw != null && raw !== team) { const good = better === 'low' ? raw < team : raw > team; cmp = <em className={good ? 'up' : 'down'}>{good ? <ArrowUp size={11}/> : <ArrowDown size={11}/>}equipe {better === 'money' ? money(team) : better === 'time' || better === 'low' ? duration(team) : `${team}${hint || ''}`}</em>; }
  return <div className="cd-kpi"><span>{label}{tip && <Tip text={tip}/>}</span><b>{value}</b>{goal && <i>meta {goal}</i>}{cmp}</div>;
}

export function ChatterDashboard({ operatorId, filters }) {
  const [d, setD] = useState(null), [err, setErr] = useState('');
  const { start, end } = periodRange(filters);
  const q = new URLSearchParams(); if (start) q.set('start', start.toISOString()); if (end) q.set('end', end.toISOString());
  useEffect(() => { setD(null); api.get(`/quality/chatter/${operatorId}?${q.toString()}`).then(r => setD(r.data)).catch(e => setErr(errorText(e))); }, [operatorId, q.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!d) return <p className="body-muted">Carregando…</p>;
  const t = d.totals, tm = d.team_median, g = d.goals;
  const maxSales = Math.max(1, ...d.series.map(s => s.sales_cents));
  return <div className="cd">
    <h3 className="cd-h">Resultado</h3>
    <div className="cd-kpis">
      <Kpi label="Faturou no turno" tip="Vendas de chat confirmadas enquanto ele estava de turno na criadora." value={money(t.sales_cents)}/>
      <Kpi label="R$ por hora" tip="Faturou ÷ horas de relógio de turno (atender várias criadoras ao mesmo tempo conta uma vez)." value={money(t.sales_per_hour_cents)} raw={t.sales_per_hour_cents} team={tm.sales_per_hour_cents} better="money" goal={money(g.goal_sales_hour_cents)}/>
      <Kpi label="Conversão de ofertas" tip="Ofertas pagas ÷ ofertas enviadas." value={t.offers ? `${t.conversion}%` : '—'} raw={t.conversion} team={tm.conversion} hint="%" goal={`${g.goal_conversion_pct}%`}/>
      <Kpi label="R$ recebido / ofertado" tip="Quanto do valor ofertado virou pagamento." value={t.offered_cents ? `${t.value_conversion}%` : '—'}/>
      <Kpi label="Ticket (mediana)" tip="Valor típico de uma venda dele." value={money(t.ticket_cents)} raw={t.ticket_cents} team={tm.ticket_cents} better="money"/>
      <Kpi label="Vendas" value={t.sales}/>
    </div>
    <h3 className="cd-h">Processo</h3>
    <div className="cd-kpis">
      <Kpi label="Resposta (mediana)" tip="Tempo de resposta do fã típico: da mensagem do fã até a resposta." value={duration(t.median_seconds)} raw={t.median_seconds} team={tm.median_seconds} better="low" goal={`${g.sla_minutes} min`}/>
      <Kpi label="10% mais lentas" tip="Tempo das respostas mais demoradas (os piores 10%)." value={duration(t.p90_seconds)}/>
      <Kpi label="Respostas na meta" tip="% das respostas dentro do tempo de resposta das Metas." value={t.within_goal_pct != null ? `${t.within_goal_pct}%` : '—'} raw={t.within_goal_pct} team={tm.within_goal_pct} hint="%"/>
      <Kpi label="Fãs atendidos" value={t.fans_attended}/>
      <Kpi label="Fãs por hora" tip="Fãs diferentes atendidos ÷ horas de turno." value={t.fans_per_hour ?? '—'} raw={t.fans_per_hour} team={tm.fans_per_hour}/>
      <Kpi label="Conversas com oferta" tip="% dos fãs atendidos que receberam pelo menos uma oferta." value={t.offer_rate != null ? `${t.offer_rate}%` : '—'} raw={t.offer_rate} team={tm.offer_rate} hint="%"/>
      <Kpi label="Sem resposta agora" tip="Fãs que escreveram e ainda não foram respondidos." value={t.pending}/>
      <Kpi label="Horas de turno" value={`${t.hours} h`}/>
      <Kpi label={`Esperas > ${g.alert_minutes || 10} min`} value={t.response_count ? t.over_alert : '—'}/>
    </div>
    <h3 className="cd-h">Por criadora</h3>
    {d.by_creator.length ? <div className="table-scroll"><table><thead><tr><th>Criadora</th><th>Horas</th><th>Faturou</th><th>R$/hora</th><th>Conversão</th><th>Resposta (mediana)</th><th>Na meta</th><th>Fãs</th><th>Sem resposta</th></tr></thead><tbody>
      {d.by_creator.map(c => <tr key={c.creator_id}><td><strong>{c.creator_name}</strong></td><td className="tabular">{c.hours} h</td><td className="tabular">{money(c.sales_cents)}</td><td className="tabular">{money(c.sales_per_hour_cents)}</td><td className="tabular">{c.offers ? `${c.conversion}% (${c.paid}/${c.offers})` : '—'}</td><td className="tabular">{duration(c.median_seconds)}</td><td className="tabular">{c.within_goal_pct != null ? `${c.within_goal_pct}%` : '—'}</td><td className="tabular">{c.fans_attended}</td><td className="tabular">{c.pending}</td></tr>)}
    </tbody></table></div> : <div className="inline-empty">Sem atendimento no período.</div>}
    <h3 className="cd-h">Dia a dia</h3>
    <div className="cd-days">{d.series.map(s => <div key={s.day} className="cd-day" title={`${dayLabel(s.day)}: ${money(s.sales_cents)} · ${s.sales} vendas · ${s.responses} respostas${s.median_seconds != null ? ` · resposta ${duration(s.median_seconds)}` : ''}`}>
      <i style={{ height: `${Math.max(2, Math.round(s.sales_cents / maxSales * 100))}%` }} className={s.sales_cents ? '' : 'zero'}/><span>{dayLabel(s.day)}</span></div>)}</div>
    <p className="body-muted" style={{ fontSize: 11.5 }}>Barras: faturamento do dia. Passe o mouse para ver vendas, respostas e tempo de resposta.</p>
    <h3 className="cd-h"><Sparkles size={15}/> O que a IA disse {d.ai_score != null && <Badge tone={d.ai_score >= 8 ? 'green' : d.ai_score >= 6 ? 'neutral' : 'amber'}>média {d.ai_score}/10</Badge>}</h3>
    {d.ai.length ? d.ai.map((a, i) => <div key={i} className="notice" style={{ display: 'block' }}>
      <strong>{a.creator_name || 'Criadora'} · {a.score != null ? `${a.score}/10` : 'sem nota'} · conversas de {dateTime(a.period_start).split(' ')[0]}</strong>
      {a.strengths && <p style={{ margin: '6px 0 0' }}><b>Pontos fortes:</b> {a.strengths}</p>}
      {a.improve && <p style={{ margin: '4px 0 0' }}><b>Melhorar:</b> {a.improve}</p>}
      {a.engagement != null && <p style={{ margin: '4px 0 0' }}><b>Engajamento:</b> {a.engagement}/10{a.dry_pct != null ? ` · ${a.dry_pct}% de respostas secas` : ''}</p>}
      {a.rewrite ? <p className="rewrite" style={{ margin: '6px 0 0' }}>{a.rewrite}</p> : a.example && <p className="body-muted" style={{ margin: '4px 0 0' }}>Exemplo: {a.example}</p>}
    </div>) : <div className="inline-empty">Nenhuma análise da IA sobre este chatter no período. Veja em "Análise por IA" se o app dele está enviando conversas.</div>}
  </div>;
}
