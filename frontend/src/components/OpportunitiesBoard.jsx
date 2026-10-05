import React, { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Radar } from 'lucide-react';
import { api, errorText, money, dateTime } from '../lib/api';
import { Notice } from './Common';
import { periodRange, periodText } from './MetricFilters';

// Radar de oportunidades: o que o app achou nas conversas, quem atendeu e quanto virou venda (até 2 dias)
const STATUS = { open: 'Em aberto', contacted: 'Atendida', dismissed: 'Dispensada', expired: 'Perdida (venceu)' };
function Table({ title, rows }) {
  if (!rows?.length) return null;
  return <div className="table-scroll"><table><thead><tr><th>{title}</th><th>Achadas</th><th>Atendidas</th><th>Dispensadas</th><th>Perdidas</th><th>Viraram venda</th><th>R$ recuperado</th><th>Em jogo</th></tr></thead><tbody>
    {rows.map(r => <tr key={r.name}><td><strong>{r.name}</strong></td><td className="tabular">{r.total}</td><td className="tabular">{r.contacted}{r.handled_pct != null ? <span className="body-muted"> · {r.handled_pct}%</span> : ''}</td><td className="tabular">{r.dismissed}</td><td className="tabular">{r.expired}</td><td className="tabular">{r.converted}{r.conversion_pct != null ? <span className="body-muted"> · {r.conversion_pct}%</span> : ''}</td><td className="tabular"><strong>{money(r.converted_cents)}</strong></td><td className="tabular body-muted">{money(r.value_cents)}</td></tr>)}
  </tbody></table></div>;
}
export function OpportunitiesBoard({ filters, reloadKey }) {
  const [d, setD] = useState(null), [err, setErr] = useState(''), [open, setOpen] = useState(false);
  const { start, end } = periodRange(filters);
  const q = new URLSearchParams(); if (start) q.set('start', start.toISOString()); if (end) q.set('end', end.toISOString()); if (filters.creator_id) q.set('creator_id', filters.creator_id); if (filters.operator_id) q.set('operator_id', filters.operator_id);
  const query = q.toString();
  const load = useCallback(() => api.get(`/quality/opportunities?${query}`).then(r => { setD(r.data); setErr(''); }).catch(e => setErr(errorText(e))), [query, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  const t = d?.totals;
  return <section className="data-section" data-testid="opportunities-board">
    <div className="section-heading"><div><h2><Radar size={16}/> Oportunidades de venda (radar)</h2><p>O app olha a lista de conversas da Privacy (sem abrir chats e sem levar o texto) e cruza com vendas, ofertas e assinantes. Atendida = o chatter respondeu ou ofertou ao fã; venda em até 2 dias conta como recuperada.</p></div><span className="period-tag">{periodText(filters)}</span></div>
    {err && <Notice tone="danger">{err}</Notice>}
    {t ? t.total ? <>
      <div className="cd-kpis">
        <div className="cd-kpi"><span>Achadas</span><b>{t.total}</b><i>{t.open} em aberto</i></div>
        <div className="cd-kpi"><span>Atendidas</span><b>{t.handled_pct != null ? `${t.handled_pct}%` : '—'}</b><i>{t.contacted} de {t.total - t.open}</i></div>
        <div className="cd-kpi"><span>Viraram venda</span><b>{t.conversion_pct != null ? `${t.conversion_pct}%` : '—'}</b><i>{t.converted} das atendidas</i></div>
        <div className="cd-kpi"><span>R$ recuperado</span><b>{money(t.converted_cents)}</b><i>em jogo {money(t.value_cents)}</i></div>
        <div className="cd-kpi"><span>Perdidas</span><b>{t.expired}</b><i>venceram sem ninguém atender</i></div>
      </div>
      <h3 className="cd-h">Por chatter</h3><Table title="Chatter" rows={d.by_chatter}/>
      <h3 className="cd-h">Por criadora</h3><Table title="Criadora" rows={d.by_creator}/>
      <h3 className="cd-h">Por tipo</h3><Table title="Tipo" rows={d.by_kind}/>
      <button type="button" className="trash-head" onClick={() => setOpen(!open)}>{open ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}<b>Lista de oportunidades</b><span>{d.items.length}</span></button>
      {open && <div className="table-scroll"><table><thead><tr><th>Quando</th><th>Criadora</th><th>Fã</th><th>Tipo</th><th>Motivo</th><th>Situação</th><th>Quem</th><th>Venda</th></tr></thead><tbody>
        {d.items.map(o => <tr key={o.id}><td>{dateTime(o.created_at)}</td><td>{o.creator_name}</td><td><strong>{o.fan_name || '—'}</strong></td><td>{o.label}</td><td className="body-muted">{o.reason}</td><td>{STATUS[o.status] || o.status}</td><td>{o.contacted_name || o.dismissed_name || '—'}{o.dismiss_reason ? <span className="body-muted"> · {o.dismiss_reason}</span> : ''}</td><td className="tabular">{o.converted_cents ? <strong>{money(o.converted_cents)}</strong> : '—'}</td></tr>)}
      </tbody></table></div>}
    </> : <div className="inline-empty">Nenhuma oportunidade no período. O radar começa a funcionar quando os chatters estiverem no app 1.4.7 com a Privacy aberta.</div> : <p className="body-muted">Carregando…</p>}
  </section>;
}
