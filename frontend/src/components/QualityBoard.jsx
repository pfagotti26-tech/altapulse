import React, { useEffect, useState, useCallback } from 'react';
import { Clock3, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight, Target, BadgeDollarSign, ShieldAlert, Hourglass, HelpCircle, ExternalLink, Copy, ArrowUpDown, AlarmClock } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, money, duration, dateTime } from '../lib/api';
import { Avatar, Notice, Modal, Button, Field } from './Common';
import { periodRange, periodText } from './MetricFilters';
import { ChatterDashboard } from './ChatterDashboard';

// Qualidade como gestão de vendas: (1) quem está esperando agora, (2) placar da equipe contra as METAS, (3) alertas.
// Cada número tem ⓘ explicando o que mede; "Como ler esta página" abre o guia completo.

export function Tip({ text, children }) {
  return <span className="qtip" tabIndex={0} aria-label={text}>{children || <HelpCircle size={12}/>}<span className="qtip-box" role="tooltip">{text}</span></span>;
}

const tone = (v) => v == null ? 'none' : v >= 80 ? 'good' : v >= 60 ? 'mid' : 'low';
const KINDS = [
  ['minor', 'Possível menor', ShieldAlert, 'red'], ['offer', 'Ofertas sem pagamento (1 a 3 dias)', BadgeDollarSign, 'amber'],
  ['shift', 'Turnos esquecidos', Clock3, 'amber'], ['stale', 'Fãs parados há +48 h (para reativar)', Hourglass, 'gray'],
];

// ---------- guia ----------
export function QualityGuide({ open, onClose, goals }) {
  const g = goals || {};
  return <Modal wide open={open} onClose={onClose} title="Como ler a página de Qualidade" description="O que cada número mede, de onde vem e como a nota é calculada." id="quality-guide">
    <div className="qguide">
      <section><h3>De onde vêm os dados</h3><p>O app Alta Pulse de cada chatter lê a lista e a conversa aberta da Privacy e do FatalFans enquanto o turno dele está ativo: quando o fã escreveu, quando foi respondido, ofertas enviadas e pagas. As vendas vêm do extrato da plataforma. Nada é enviado ao fã e nenhuma mensagem é guardada (só horários e valores).</p></section>
      <section><h3>Fãs esperando agora</h3><p>Conversas em que o fã escreveu por último e ninguém respondeu há mais de <b>{g.alert_minutes || 10} min</b> (limite em Metas). Mostra criadora, quem está de turno, quanto o fã já gastou e um botão para abrir a conversa direto no seu app.</p></section>
      <section><h3>Nota de 0 a 100</h3><p>Compara o chatter com as metas da equipe. Só entra o que teve dados suficientes no período:</p>
        <table className="qguide-t"><tbody>
          <tr><td><b>Resposta</b> · peso 30%</td><td>% das respostas dentro da meta de {g.sla_minutes || 5} min.</td></tr>
          <tr><td><b>Sem resposta</b> · peso 15%</td><td>Começa em 100 e perde 10 pontos por fã que ficou sem resposta acima da meta nas últimas 24 h.</td></tr>
          <tr><td><b>Conversão</b> · peso 25%</td><td>Ofertas pagas ÷ ofertas enviadas, comparado à meta de {g.goal_conversion_pct || 30}% (bater a meta = 100). Precisa de 3+ ofertas.</td></tr>
          <tr><td><b>R$/hora</b> · peso 30%</td><td>Vendas de chat ÷ horas de relógio no turno, comparado à meta de {g.goal_sales_hour_cents ? money(g.goal_sales_hour_cents) : 'R$ 50'}. Quem atende 4 criadoras ao mesmo tempo trabalhou 1 hora, não 4.</td></tr>
        </tbody></table></section>
      <section><h3>Outras colunas</h3><ul>
        <li><b>Resposta (mediana)</b>: o tempo do fã típico. <b>10% mais lentas</b>: o tempo dos piores casos (é aqui que aparece o fã esquecido).</li>
        <li><b>Esperas &gt; {g.alert_minutes || 10} min</b>: quantas respostas passaram do limite de alerta no período.</li>
        <li><b>IA</b>: média da análise diária do Claude (0 a 10) sobre a qualidade da conversa; <b>Engajamento</b> mede respostas secas, sem pergunta de volta e sem gancho.</li>
        <li><b>Seta ao lado da nota</b>: diferença para o período anterior de mesmo tamanho.</li></ul></section>
      <section><h3>Análise por IA</h3><p>Todo dia às 10h30 o Claude lê amostras anonimizadas das conversas do dia anterior (sem nome, telefone, e-mail ou link), compara com a ficha da criadora e devolve nota, pontos fortes, o que melhorar e um exemplo de resposta reescrita. Se não aparecer nada, a lista "Por que a IA está sem dados" no bloco da IA diz o que falta.</p></section>
    </div>
  </Modal>;
}

// ---------- fila ao vivo (vem fechada: resumo em uma linha; dentro, uma dobra por criadora) ----------
const pref = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v === '1'; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch {} };
function WaitingNow({ filters, reloadKey }) {
  const [d, setD] = useState(null), [open, setOpen] = useState(() => pref('alta-waiting-open', false)), [groupsOpen, setGroupsOpen] = useState({}), [more, setMore] = useState({}), [who, setWho] = useState('');
  const load = useCallback(() => api.get(`/quality/waiting${filters.creator_id ? `?creator_id=${filters.creator_id}` : ''}`).then(r => setD(r.data)).catch(() => setD({ rows: [], count: 0, limit_minutes: 10 })), [filters.creator_id, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  const link = (r) => `altapulse://abrir?${new URLSearchParams({ c: r.creator_id, p: r.platform || 'privacy', ...(r.cid ? { cid: r.cid } : {}), ...(r.fan_name ? { n: r.fan_name } : {}), ...(r.fan_ref ? { f: r.fan_ref } : {}) }).toString()}`;
  const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast.success('Nome copiado.'); } catch { toast.error('Não consegui copiar.'); } };
  const all = d?.rows || [];
  const chatters = [...new Set(all.map(r => r.on_shift || 'ninguém de turno'))];
  const rows = all.filter(r => !who || (r.on_shift || 'ninguém de turno') === who);
  const sev = (s) => s >= 12 * 3600 ? 'w-red' : s >= 3600 ? 'w-amber' : '';
  const old12 = all.filter(r => r.seconds >= 12 * 3600).length; const spent = all.reduce((n, r) => n + (r.spent_cents || 0), 0); const oldest = all[0];
  const by = {}; for (const r of rows) (by[r.creator_name] = by[r.creator_name] || []).push(r);
  const groups = Object.entries(by).sort((a, b) => b[1][0].seconds - a[1][0].seconds);
  const toggle = () => { setOpen(o => { setPref('alta-waiting-open', !o); return !o; }); };
  return <section className={`data-section waiting ${open ? 'open' : ''}`} data-testid="quality-waiting">
    <button type="button" className="fold-head" onClick={toggle} aria-expanded={open}>
      {open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}<AlarmClock size={16}/><b>Fãs esperando agora</b>
      {d ? all.length ? <span className="fold-sum"><i className={old12 ? 'bad' : ''}>{all.length} esperando</i>{old12 ? <> · <i className="bad">{old12} há mais de 12 h</i></> : null} · mais antigo: {oldest.fan_name || 'fã'} ({oldest.creator_name}) há {oldest.waiting}{spent ? <> · já gastaram {money(spent)}</> : null}</span> : <span className="fold-sum ok">ninguém esperando acima de {d.limit_minutes} min 👏</span> : <span className="fold-sum">…</span>}
      <Tip text={`Fã escreveu e ninguém respondeu há mais de ${d?.limit_minutes || 10} min (últimas 48 h; limite em Metas). Atualiza a cada minuto. Abrir no app abre a conversa no seu Alta Pulse, no perfil da criadora.`}/>
    </button>
    {open && d && all.length > 0 && <div className="fold-body">
      {chatters.length > 1 && <div className="wait-filter"><span>Chatter:</span><button type="button" className={!who ? 'on' : ''} onClick={() => setWho('')}>Todos</button>{chatters.map(c => <button key={c} type="button" className={who === c ? 'on' : ''} onClick={() => setWho(c)}>{c}</button>)}</div>}
      {groups.map(([cn, list]) => { const g = groupsOpen[cn]; const shown = more[cn] ? list : list.slice(0, 5); const chatter = list[0].on_shift;
        return <div key={cn} className="wait-group">
          <button type="button" className="wait-group-head" onClick={() => setGroupsOpen(o => ({ ...o, [cn]: !g }))}>{g ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}<b>{cn}</b><span className={list[0].seconds >= 12 * 3600 ? 'bad' : ''}>{list.length} esperando · mais antigo há {list[0].waiting}</span><em>{chatter ? `${chatter} de turno${list[0].shift_paused ? ' (pausado)' : ''}` : 'ninguém de turno'}</em></button>
          {g && <div className="wait-rows">{shown.map((r, i) => <div key={i} className={`wait-row ${sev(r.seconds)}`}>
            <b className="w-time">{r.waiting}</b><span className="w-fan"><strong>{r.fan_name || 'Fã sem nome'}</strong>{r.platform !== 'privacy' && <small> · {r.platform === 'fatalfans' ? 'FatalFans' : r.platform}</small>}</span>
            <span className="w-spent">{r.spent_cents ? money(r.spent_cents) : ''}</span><small className="w-since">desde {dateTime(r.since).split(' ').pop()}</small>
            <span className="w-acts"><a className="w-link" href={link(r)} title="Abre a conversa no seu Alta Pulse">Abrir no app <ExternalLink size={12}/></a>{r.fan_name && <button className="icon-btn" title="Copiar nome do fã" onClick={() => copy(r.fan_name)}><Copy size={13}/></button>}</span>
          </div>)}{list.length > 5 && <button type="button" className="w-more" onClick={() => setMore(m => ({ ...m, [cn]: !m[cn] }))}>{more[cn] ? 'ver menos' : `ver mais ${list.length - 5}`}</button>}</div>}
        </div>; })}
    </div>}
  </section>;
}

// ---------- alertas (o que não é espera) ----------
function Alerts({ alerts }) {
  const [open, setOpen] = useState(null);
  const groups = KINDS.map(([k, label, Icon, lv]) => ({ k, label, Icon, lv, items: alerts.filter(a => a.kind === k) })).filter(g => g.items.length);
  if (!groups.length) return null;
  return <section className="data-section" data-testid="quality-alerts"><div className="section-heading"><div><h2>Outros alertas</h2><p>Clique para ver a lista, separada por criadora.</p></div></div>
    <div className="qa-sum">
      <div className="qa-chips">{groups.map(g => <button key={g.k} type="button" className={`qa-chip ${g.lv} ${open === g.k ? 'on' : ''}`} onClick={() => setOpen(open === g.k ? null : g.k)}><g.Icon size={15}/><b>{g.items.length}</b><span>{g.label}</span>{open === g.k ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</button>)}</div>
      {open && (() => { const g = groups.find(x => x.k === open); if (!g) return null; const by = {}; for (const a of g.items) (by[a.creator || 'Sem criadora'] = by[a.creator || 'Sem criadora'] || []).push(a);
        return <div className="qa-open">{Object.entries(by).map(([c, list]) => <div key={c} className="qa-group"><div className="qa-group-head">{c}<span>{list.length}</span></div>
          {list.map((a, i) => <div key={i} className={`qa-alert ${a.level}`}><g.Icon size={14}/><div><strong>{a.text}</strong><span>{a.who && a.who !== 'Sem atribuição' ? a.who : 'sem chatter no turno'}{a.at ? ` · desde ${dateTime(a.at)}` : ''}</span></div></div>)}</div>)}</div>; })()}
    </div></section>;
}

function GoalsModal({ open, onClose, onSaved }) {
  const [g, setG] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (open) api.get('/quality/goals').then(r => setG({ ...r.data, hour: String(r.data.goal_sales_hour_cents / 100), alert_minutes: r.data.alert_minutes || 10 })).catch(e => toast.error(errorText(e))); }, [open]);
  const save = async () => { setBusy(true); try { await api.put('/quality/goals', { sla_minutes: Number(g.sla_minutes), goal_conversion_pct: Number(g.goal_conversion_pct), goal_sales_hour_cents: Math.round(Number(String(g.hour).replace(',', '.')) * 100), alert_minutes: Number(g.alert_minutes) }); toast.success('Metas salvas.'); onSaved(); onClose(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } };
  return <Modal open={open} onClose={onClose} title="Metas da equipe" description="A nota de cada chatter mede o quanto ele bate estas metas." id="goals-modal">{g && <div className="form-stack">
    <Field id="goal-sla" label="Tempo de resposta (minutos)" type="number" min={1} max={120} value={g.sla_minutes} onChange={e => setG({ ...g, sla_minutes: e.target.value })}/>
    <Field id="goal-alert" label="Alertar fã esperando há mais de (minutos)" type="number" min={1} max={240} value={g.alert_minutes} onChange={e => setG({ ...g, alert_minutes: e.target.value })}/>
    <Field id="goal-conv" label="Conversão de ofertas (%)" type="number" min={1} max={100} value={g.goal_conversion_pct} onChange={e => setG({ ...g, goal_conversion_pct: e.target.value })}/>
    <Field id="goal-hour" label="Vendas por hora de turno (R$)" value={g.hour} onChange={e => setG({ ...g, hour: e.target.value })}/>
    <div className="form-actions"><Button disabled={busy} onClick={save}>Salvar metas</Button></div></div>}</Modal>;
}

// ---------- placar da equipe ----------
const COLS = (g) => [
  ['score', 'Nota', 'De 0 a 100 contra as metas (veja o guia). A seta mostra a diferença para o período anterior.'],
  ['median_seconds', 'Resposta', `Mediana do tempo de resposta (o fã típico) e, abaixo, os 10% mais lentos. Meta: ${g?.sla_minutes ?? 5} min.`, true],
  ['within_goal_pct', 'Na meta', `% das respostas em até ${g?.sla_minutes ?? 5} min.`],
  ['over_alert', `Esperas >${g?.alert_minutes ?? 10}min`, `Quantas respostas demoraram mais de ${g?.alert_minutes ?? 10} min no período.`, true],
  ['pending_24h', 'Sem resposta', 'Fãs que ficaram sem resposta acima da meta nas últimas 24 h.', true],
  ['conversion', 'Conversão', `Ofertas pagas ÷ enviadas. Meta: ${g?.goal_conversion_pct ?? 30}%.`],
  ['sales_cents', 'Faturou', 'Vendas de chat confirmadas no turno dele.'],
  ['sales_per_hour_cents', 'R$/hora', `Faturou ÷ horas de relógio de turno. Meta: ${g ? money(g.goal_sales_hour_cents) : 'R$ 50'}.`],
  ['ai_score', 'IA', 'Média da análise diária do Claude (0 a 10) e, abaixo, o engajamento (respostas secas, sem gancho).'],
];
function cellTone(k, c, g) {
  if (!g) return '';
  const v = c[k]; if (v == null) return '';
  if (k === 'median_seconds') return v <= g.sla_minutes * 60 ? 'good' : v <= g.sla_minutes * 120 ? 'mid' : 'low';
  if (k === 'within_goal_pct') return v >= 80 ? 'good' : v >= 60 ? 'mid' : 'low';
  if (k === 'over_alert' || k === 'pending_24h') return v === 0 ? 'good' : v <= 3 ? 'mid' : 'low';
  if (k === 'conversion') return v >= g.goal_conversion_pct ? 'good' : v >= g.goal_conversion_pct / 2 ? 'mid' : 'low';
  if (k === 'sales_per_hour_cents') return v >= g.goal_sales_hour_cents ? 'good' : v >= g.goal_sales_hour_cents / 2 ? 'mid' : 'low';
  if (k === 'ai_score') return v >= 8 ? 'good' : v >= 6 ? 'mid' : 'low';
  return '';
}

export function QualityBoard({ filters, reloadKey }) {
  const [data, setData] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [managers, setManagers] = useState(false), [goalsOpen, setGoalsOpen] = useState(false), [who, setWho] = useState(null), [nonce, setNonce] = useState(0), [sort, setSort] = useState({ k: 'score', asc: false }), [guide, setGuide] = useState(false);
  const { start, end } = periodRange(filters);
  const q = new URLSearchParams(); if (filters.creator_id) q.set('creator_id', filters.creator_id); if (start) q.set('start', start.toISOString()); if (end) q.set('end', end.toISOString()); if (managers) q.set('managers', 'true');
  const query = q.toString();
  const load = useCallback(async () => { setLoading(true); setError(''); try { setData((await api.get(`/quality/scorecard?${query}`)).data); } catch (e) { setError(errorText(e)); } finally { setLoading(false); } }, [query, reloadKey, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  const g = data?.goals;
  const cols = COLS(g);
  const chatters = (data?.chatters || []).filter(c => !filters.operator_id || c.operator_id === filters.operator_id)
    .slice().sort((a, b) => { const x = a[sort.k], y = b[sort.k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return sort.asc ? x - y : y - x; });
  const sortBy = (k, lowGood) => setSort(s => s.k === k ? { k, asc: !s.asc } : { k, asc: !!lowGood });
  return <>
    <div className="qhead-actions"><Button variant="outline" onClick={() => setGuide(true)}><HelpCircle size={15}/>Como ler esta página</Button><Button variant="outline" onClick={() => setGoalsOpen(true)}><Target size={14}/>Metas</Button></div>
    {error && <Notice id="quality-error" tone="danger">{error}</Notice>}
    <section className="data-section" data-testid="quality-scorecard">
      <div className="section-heading"><div><h2>Placar da equipe</h2><p>Um chatter por linha, contra as metas: verde bate a meta, amarelo perto, vermelho longe. Clique no nome para abrir o painel dele; clique no título da coluna para ordenar.</p></div>
        <div className="row-actions"><label className="checkbox-label small"><input type="checkbox" checked={managers} onChange={e => setManagers(e.target.checked)}/><span>incluir gestores</span></label><span className="period-tag">{periodText(filters)}</span></div></div>
      {chatters.length ? <div className="table-scroll"><table className="score-table"><thead><tr><th>Chatter</th>
        {cols.map(([k, label, tip, low]) => <th key={k} className={sort.k === k ? 'sorted' : ''}><button type="button" className="th-sort" onClick={() => sortBy(k, low)}>{label}<ArrowUpDown size={11}/></button> <Tip text={tip}/></th>)}</tr></thead>
        <tbody>{chatters.map((c, i) => <tr key={c.operator_id} data-testid={`score-${c.operator_id}`}>
          <td><button type="button" className="who-btn" onClick={() => setWho(c)} title="Abrir o painel do chatter"><span className="qa-rank">{i + 1}º</span><Avatar name={c.name} src={c.avatar || null} size={30}/><span><strong>{c.name}</strong><small>{c.hours} h de turno · {c.fans_attended} fãs</small></span></button></td>
          <td><span className={`score-pill ${tone(c.score)}`}>{c.score ?? '—'}</span>{c.trend != null && <em className={`trend ${c.trend > 0 ? 'up' : c.trend < 0 ? 'down' : ''}`}>{c.trend > 0 ? <TrendingUp size={12}/> : c.trend < 0 ? <TrendingDown size={12}/> : <Minus size={12}/>}{c.trend > 0 ? '+' : ''}{c.trend}</em>}{c.score == null && <small className="body-muted"> poucos dados</small>}</td>
          <td className={cellTone('median_seconds', c, g)}>{duration(c.median_seconds)}<small>10% piores: {duration(c.p90_seconds)}</small></td>
          <td className={cellTone('within_goal_pct', c, g)}>{c.within_goal_pct != null ? `${c.within_goal_pct}%` : '—'}</td>
          <td className={cellTone('over_alert', c, g)}>{c.response_count ? c.over_alert : '—'}</td>
          <td className={cellTone('pending_24h', c, g)}>{c.pending_24h}</td>
          <td className={cellTone('conversion', c, g)}>{c.offers ? `${c.conversion}%` : '—'}<small>{c.offers ? `${c.paid} de ${c.offers}` : 'sem ofertas'}</small></td>
          <td className="tabular">{money(c.sales_cents)}</td>
          <td className={cellTone('sales_per_hour_cents', c, g)}>{c.sales_per_hour_cents != null ? money(c.sales_per_hour_cents) : '—'}</td>
          <td className={cellTone('ai_score', c, g)}>{c.ai_score != null ? `${c.ai_score}/10` : '—'}<small>{c.ai_engagement != null ? `engaj. ${c.ai_engagement}/10${c.ai_dry_pct != null ? ` · ${c.ai_dry_pct}% secas` : ''}` : 'sem análise'}</small></td>
        </tr>)}</tbody></table></div> : <div className="inline-empty">{loading ? 'Calculando…' : 'Nenhum chatter com turno ou atendimento no período.'}</div>}
    </section>
    <WaitingNow filters={filters} reloadKey={reloadKey + nonce}/>
    <Alerts alerts={(data?.alerts || []).filter(a => a.kind !== 'waiting')}/>
    <GoalsModal open={goalsOpen} onClose={() => setGoalsOpen(false)} onSaved={() => setNonce(n => n + 1)}/>
    <QualityGuide open={guide} onClose={() => setGuide(false)} goals={g}/>
    <Modal wide open={!!who} onClose={() => setWho(null)} title={who ? `Painel · ${who.name}` : ''} description={periodText(filters)} id="chatter-dashboard">{who && <ChatterDashboard operatorId={who.operator_id} filters={filters}/>}</Modal>
  </>;
}
