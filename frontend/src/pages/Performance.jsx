import React, { useEffect, useState } from 'react';
import { TrendingUp, Users, Wallet, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api, money, errorText, dateTime, initials } from '../lib/api';
import { PageHeading, Stat, Button, Empty, Notice, Badge } from '../components/Common';

// Bloco B: raio-x das criadoras. Faturamento por dia vem das vendas exatas do extrato; assinantes,
// projeção e saldos vêm do retrato diário da "Visão geral" lido pelo app.
function Bars({ series }) {
  const max = Math.max(1, ...series);
  return <div className="bars" title="Faturamento por dia (extrato)">{series.map((v, i) => <span key={i} style={{ height: `${Math.max(2, Math.round(v / max * 44))}px` }} className={i === series.length - 1 ? 'today' : ''}/>)}</div>;
}
const delta = (a, b) => b ? Math.round((a - b) / b * 100) : null;
export default function Performance() {
  const [data, setData] = useState(null), [days, setDays] = useState(30), [busy, setBusy] = useState(false), [sort, setSort] = useState('today');
  const key = { today: c => c.today_cents, last7: c => c.last7_cents, total: c => c.total_cents, month: c => c.snapshot?.sales_month_cents || 0, projection: c => c.snapshot?.projection_cents || 0 };
  const sorter = (a, b) => sort === 'name' ? a.name.localeCompare(b.name) : (key[sort](b) || 0) - (key[sort](a) || 0);
  const load = async () => { setBusy(true); try { const r = await api.get('/performance', { params: { days } }); setData(r.data); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } };
  useEffect(() => { load(); }, [days]);
  const t = data?.totals || {};
  return <><PageHeading eyebrow="RAIO-X DAS CRIADORAS" title="Desempenho" description="Faturamento por dia pelo extrato da Privacy e o retrato diário de cada criadora (assinantes, projeção, saldos)."><select data-testid="performance-days" value={days} onChange={e => setDays(+e.target.value)}><option value={7}>7 dias</option><option value={14}>14 dias</option><option value={30}>30 dias</option><option value={60}>60 dias</option><option value={90}>90 dias</option></select><Button variant="outline" data-testid="performance-reload" onClick={load} disabled={busy}><RefreshCw size={15}/>Atualizar</Button></PageHeading>
    <div className="stats-grid"><Stat id="perf-today" label="Faturamento hoje" value={money(t.today_cents)} caption="Todas as criadoras, bruto, pelo extrato" icon={Wallet} tone="green"/><Stat id="perf-week" label="Últimos 7 dias" value={money(t.last7_cents)} caption="Bruto, sem estornos" icon={TrendingUp}/><Stat id="perf-total" label={`Últimos ${days} dias`} value={money(t.total_cents)} caption="Bruto, sem estornos" icon={TrendingUp}/><Stat id="perf-subs" label="Assinantes ativos" value={t.active_subscribers ?? '—'} caption="Soma do último retrato de cada criadora" icon={Users}/></div>
    {data?.creators?.length ? <><div className="perf-toolbar"><span className="body-muted">{data.creators.length} criadoras</span><select data-testid="performance-sort" value={sort} onChange={e => setSort(e.target.value)}><option value="today">Ordenar: faturamento hoje</option><option value="last7">Ordenar: últimos 7 dias</option><option value="total">Ordenar: período</option><option value="month">Ordenar: mês na Privacy</option><option value="projection">Ordenar: projeção</option><option value="name">Ordenar: nome</option></select></div>
      <div className="perf-grid">{[...data.creators].sort(sorter).map(c => { const s = c.snapshot; const d = delta(c.last7_cents, c.prev7_cents); const ds = s && c.week_ago && s.subscribers_active != null && c.week_ago.subscribers_active != null ? s.subscribers_active - c.week_ago.subscribers_active : null;
        return <article className="perf-card" key={c.creator_id} data-testid={`perf-row-${c.creator_id}`}>
          <header><span className={`avatar ${c.color || ''}`}>{initials(c.name)}</span><div><strong>{c.name}</strong><span>{c.sales_count} vendas em {days} dias · {s ? `retrato ${dateTime(s.taken_at)}` : 'sem retrato'}</span></div></header>
          {c.alerts.length ? <div className="perf-alerts">{c.alerts.map((a, i) => <div key={i} className="perf-alert"><AlertTriangle size={12}/>{a}</div>)}</div> : null}
          <div className="perf-kpis">
            <div><span>Hoje</span><strong className="green-text">{money(c.today_cents)}</strong></div>
            <div><span>7 dias</span><strong>{money(c.last7_cents)}</strong>{d != null && <Badge tone={d >= 0 ? 'green' : 'red'}>{d >= 0 ? '+' : ''}{d}% vs. 7 anteriores</Badge>}</div>
            <div><span>{days} dias (extrato)</span><strong>{money(c.total_cents)}</strong></div>
            <div><span>Assinantes ativos</span><strong>{s?.subscribers_active ?? '—'}</strong>{(ds || s?.subscribers_total != null) ? <small>{ds ? `${ds > 0 ? '+' : ''}${ds} em 7 dias · ` : ''}{s?.subscribers_total != null ? `${s.subscribers_total} no total` : ''}</small> : null}</div>
            <div><span>Mês na Privacy</span><strong>{money(s?.sales_month_cents)}</strong>{s?.intl_month_cents ? <small>+ {money(s.intl_month_cents)} internacional</small> : null}</div>
            <div><span>Projeção do mês</span><strong>{money(s?.projection_cents)}</strong>{s?.projection_avg_day_cents != null && <small>{money(s.projection_avg_day_cents)} por dia</small>}</div>
            <div><span>A liberar</span><strong>{money(s?.balance_pending_cents)}</strong>{s?.balance_national_cents != null && <small>liberado {money(s.balance_national_cents)}</small>}</div>
            <div><span>Recorde do dia</span><strong>{money(s?.record_day_cents)}</strong></div>
          </div>
          <div className="perf-chart"><span>Faturamento por dia · {days} dias (extrato)</span><Bars series={c.series}/></div>
        </article>; })}</div></> : <Empty id="performance-empty" icon={TrendingUp} title="Ainda sem dados" description="O app desktop precisa estar aberto (com o vigia de extrato) para ler o extrato e a Visão geral."/>}
    <Notice id="performance-notice">Faturamento diário = vendas concluídas e a receber do extrato (valor bruto). O extrato cobre o que o app já leu (o histórico mais antigo entra aos poucos); o retrato da Visão geral é lido uma vez por hora enquanto o app está aberto; fica guardado um por dia. Nada de assinante ou mensagem aqui.</Notice></>;
}
