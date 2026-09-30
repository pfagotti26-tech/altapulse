import React, { useEffect, useState } from 'react';
import { TrendingUp, Users, Wallet, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api, money, errorText, dateTime, initials } from '../lib/api';
import { PageHeading, Stat, Button, Empty, Notice, Badge } from '../components/Common';

// Bloco B: raio-x das criadoras. Faturamento por dia vem das vendas exatas do extrato; assinantes,
// projeção e saldos vêm do retrato diário da "Visão geral" lido pelo app.
function Bars({ series }) {
  const max = Math.max(1, ...series);
  return <div className="bars" title="Faturamento por dia (extrato)">{series.map((v, i) => <span key={i} style={{ height: `${Math.max(2, Math.round(v / max * 28))}px` }} className={i === series.length - 1 ? 'today' : ''}/>)}</div>;
}
const delta = (a, b) => b ? Math.round((a - b) / b * 100) : null;
export default function Performance() {
  const [data, setData] = useState(null), [days, setDays] = useState(30), [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); try { const r = await api.get('/performance', { params: { days } }); setData(r.data); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } };
  useEffect(() => { load(); }, [days]);
  const t = data?.totals || {};
  return <><PageHeading eyebrow="RAIO-X DAS CRIADORAS" title="Desempenho" description="Faturamento por dia pelo extrato da Privacy e o retrato diário de cada criadora (assinantes, projeção, saldos)."><select data-testid="performance-days" value={days} onChange={e => setDays(+e.target.value)}><option value={7}>7 dias</option><option value={14}>14 dias</option><option value={30}>30 dias</option><option value={60}>60 dias</option><option value={90}>90 dias</option></select><Button variant="outline" data-testid="performance-reload" onClick={load} disabled={busy}><RefreshCw size={15}/>Atualizar</Button></PageHeading>
    <div className="stats-grid"><Stat id="perf-today" label="Faturamento hoje" value={money(t.today_cents)} caption="Todas as criadoras, bruto, pelo extrato" icon={Wallet} tone="green"/><Stat id="perf-week" label="Últimos 7 dias" value={money(t.last7_cents)} caption="Bruto, sem estornos" icon={TrendingUp}/><Stat id="perf-total" label={`Últimos ${days} dias`} value={money(t.total_cents)} caption="Bruto, sem estornos" icon={TrendingUp}/><Stat id="perf-subs" label="Assinantes ativos" value={t.active_subscribers ?? '—'} caption="Soma do último retrato de cada criadora" icon={Users}/></div>
    {data?.creators?.length ? <section className="data-section"><div className="table-scroll"><table><thead><tr><th>Criadora</th><th>Hoje</th><th>7 dias</th><th>vs. 7 anteriores</th><th>{days} dias</th><th>Assinantes ativos</th><th>Mês (Privacy)</th><th>Projeção</th><th>A liberar</th><th>Retrato</th><th>Alertas</th></tr></thead><tbody>
      {data.creators.map(c => { const s = c.snapshot; const d = delta(c.last7_cents, c.prev7_cents); const ds = s && c.week_ago && s.subscribers_active != null && c.week_ago.subscribers_active != null ? s.subscribers_active - c.week_ago.subscribers_active : null;
        return <tr key={c.creator_id} data-testid={`perf-row-${c.creator_id}`}><td><div className="person-cell"><span className={`avatar small-avatar ${c.color || ''}`}>{initials(c.name)}</span><div><strong>{c.name}</strong><span>{c.sales_count} vendas no período</span></div></div></td>
          <td className="tabular">{money(c.today_cents)}</td><td className="tabular"><Bars series={c.series.slice(-7)}/>{money(c.last7_cents)}</td>
          <td className="tabular">{d == null ? '—' : <Badge tone={d >= 0 ? 'green' : 'red'}>{d >= 0 ? '+' : ''}{d}%</Badge>}</td>
          <td className="tabular"><Bars series={c.series}/>{money(c.total_cents)}</td>
          <td className="tabular">{s?.subscribers_active ?? '—'}{ds != null && ds !== 0 && <span className="inherited-label">{ds > 0 ? '+' : ''}{ds} em 7 dias</span>}{s?.subscribers_total != null && <span className="inherited-label">{s.subscribers_total} no total</span>}</td>
          <td className="tabular">{money(s?.sales_month_cents)}{s?.intl_month_cents ? <span className="inherited-label">+ {money(s.intl_month_cents)} intl.</span> : null}</td>
          <td className="tabular">{money(s?.projection_cents)}{s?.projection_avg_day_cents != null && <span className="inherited-label">{money(s.projection_avg_day_cents)}/dia</span>}</td>
          <td className="tabular">{money(s?.balance_pending_cents)}{s?.balance_national_cents != null && <span className="inherited-label">liberado {money(s.balance_national_cents)}</span>}</td>
          <td>{s ? dateTime(s.taken_at) : <span className="subtle-label">sem retrato</span>}</td>
          <td>{c.alerts.length ? c.alerts.map((a, i) => <div key={i} className="perf-alert"><AlertTriangle size={12}/>{a}</div>) : <span className="subtle-label">—</span>}</td></tr>; })}
    </tbody></table></div></section> : <Empty id="performance-empty" icon={TrendingUp} title="Ainda sem dados" description="O app desktop precisa estar aberto com a criadora para ler o extrato e a Visão geral."/>}
    <Notice id="performance-notice">Faturamento diário = vendas concluídas e a receber do extrato (valor bruto). O retrato da Visão geral é lido uma vez por hora enquanto o app está aberto; fica guardado um por dia. Nada de assinante ou mensagem aqui.</Notice></>;
}
