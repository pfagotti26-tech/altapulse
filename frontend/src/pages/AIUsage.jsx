import React, { useEffect, useState } from 'react';
import { Sparkles, Wallet, TrendingUp, Gauge, RefreshCw, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText } from '../lib/api';
import { PageHeading, Stat, Button, Empty, Notice } from '../components/Common';

// Consumo da IA (Alta Ajuda / Grok): quanto a equipe gasta, quem usa mais, em que criadora e em que horário.
// Só o dono da conta vê esta página. Valores em US$ calculados pelo preço da xAI e pelos tokens de cada pedido.
const usd = (v, d = 2) => v == null ? '—' : 'US$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const int = (v) => v == null ? '—' : Number(v).toLocaleString('pt-BR');
const pct = (v) => v == null ? '—' : `${v}%`;
const dm = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);

function DayBars({ series }) {
  const max = Math.max(0.0001, ...series.map(s => s.cost));
  return <div className="ai-bars">{series.map(s => <div key={s.day} className="ai-bar" title={`${dm(s.day)} · ${int(s.n)} pedidos · ${usd(s.cost, 3)}`}><span style={{ height: `${Math.max(s.n ? 3 : 0, Math.round(s.cost / max * 120))}px` }}/><small>{dm(s.day)}</small></div>)}</div>;
}
function HourBars({ hours }) {
  const max = Math.max(1, ...hours);
  return <div className="ai-bars hours">{hours.map((n, h) => <div key={h} className="ai-bar" title={`${h}h · ${int(n)} pedidos`}><span style={{ height: `${Math.max(n ? 3 : 0, Math.round(n / max * 80))}px` }}/><small>{h}</small></div>)}</div>;
}
function Table({ rows, first, extra }) {
  return <div className="table-scroll"><table><thead><tr><th>{first}</th><th>Pedidos</th><th>Hoje</th><th>Gasto</th><th>Gasto hoje</th><th>Custo médio</th><th>Usadas na caixa</th><th>Fatia</th>{extra && <th>Tempo médio</th>}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}><td><strong>{r.name}</strong></td><td className="tabular">{int(r.n)}</td><td className="tabular">{int(r.today)}</td><td className="tabular">{usd(r.cost)}</td><td className="tabular">{usd(r.cost_today)}</td><td className="tabular">{usd(r.avg_cost, 4)}</td><td className="tabular">{pct(r.used_pct)}</td>
      <td><div className="ai-share"><span style={{ width: `${r.share}%` }}/></div><small className="tabular">{r.share}%</small></td>{extra && <td className="tabular">{r.avg_seconds != null ? `${String(r.avg_seconds).replace('.', ',')} s` : '—'}</td>}</tr>)}</tbody></table></div>;
}

export default function AIUsage() {
  const [days, setDays] = useState(30), [d, setD] = useState(null), [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); try { setD((await api.get(`/assist/consumption?days=${days}`)).data); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } };
  useEffect(() => { load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = d && d.total;
  const teamToday = t ? t.today : 0;
  return <>
    <PageHeading eyebrow="SÓ PARA O DONO DA CONTA" title="Consumo da IA" description="Quanto a Alta Ajuda (Grok) está gastando, quem usa mais e onde. O valor é calculado pelos tokens de cada pedido e pelo preço da xAI.">
      {[7, 30, 90].map(n => <Button key={n} variant={days === n ? undefined : 'outline'} onClick={() => setDays(n)}>{n} dias</Button>)}
      <Button variant="ghost" disabled={busy} onClick={load}><RefreshCw size={15}/>Atualizar</Button>
    </PageHeading>
    {!d ? <p className="body-muted">Carregando…</p> : !t.n ? <Empty title="Nenhum uso da IA no período" description="Quando a equipe usar a Alta Ajuda, os números aparecem aqui." icon={Sparkles}/> : <>
      <div className="stats-grid">
        <Stat id="ai-today" label="Hoje" value={usd(t.cost_today)} caption={`${int(teamToday)} de ${int(d.team_daily_limit)} ajudas do saldo da equipe`} icon={Wallet} tone="green"/>
        <Stat id="ai-period" label={`Últimos ${d.days} dias`} value={usd(t.cost)} caption={`${int(t.n)} pedidos · média ${usd(t.avg_cost, 4)} cada`} icon={TrendingUp}/>
        <Stat id="ai-month" label="Projeção do mês" value={usd(d.month_projection)} caption={`Pela média dos últimos 7 dias (${usd(d.daily_avg_7d)} por dia)`} icon={Gauge}/>
        <Stat id="ai-used" label="Aproveitamento" value={pct(t.used_pct)} caption={`Sugestões colocadas na caixa · cache: ${pct(d.cache_pct)} dos tokens`} icon={Sparkles}/>
      </div>
      {teamToday >= 0.8 * d.team_daily_limit && <Notice tone="danger" id="ai-near">A equipe já usou {Math.round(100 * teamToday / d.team_daily_limit)}% do saldo de hoje. O saldo e o máximo por pessoa ficam em Configurações → Alta Ajuda.</Notice>}
      <section className="panel ai-panel"><h2>Gasto por dia</h2><p className="body-muted">Passe o mouse em cada barra para ver pedidos e valor.</p><DayBars series={d.series}/></section>
      <section className="panel ai-panel"><h2>Quem está consumindo</h2><p className="body-muted">Teto de {int(d.daily_limit)} ajudas por pessoa por dia. "Usadas na caixa" mostra quantas sugestões o chatter realmente aproveitou: muito pedido com pouco uso indica clique repetido em "Outra".</p><Table rows={d.by_user} first="Chatter"/></section>
      <section className="panel ai-panel"><h2>Por criadora</h2><Table rows={d.by_creator} first="Criadora" extra/></section>
      <div className="ai-two">
        <section className="panel ai-panel"><h2>Por tipo de uso</h2><Table rows={d.by_mode} first="Tipo"/></section>
        <section className="panel ai-panel"><h2>Horário de uso</h2><p className="body-muted">Pedidos por hora do dia (Brasília). Ajuda a ver o pico da equipe.</p><HourBars hours={d.by_hour}/></section>
      </div>
      <Notice id="ai-note">Valores estimados pelo preço público da xAI (modelo de sugestões: {d.model}). O saldo de créditos e a fatura oficial ficam no <a href="https://console.x.ai" target="_blank" rel="noreferrer">console da xAI <ExternalLink size={12}/></a>, em Billing.</Notice>
    </>}
  </>;
}
