import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CalendarDays } from 'lucide-react';
import { useApp } from '../App';
import { api, dateTime, errorText } from '../lib/api';
import { Select, Badge, Notice } from './Common';
export const useMetrics = () => {
  const [data, setData] = useState(null), [filters, setFilters] = useState({ creator_id: '', operator_id: '', period: '7' }), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  // datas no fuso de Brasília: início do dia (00:00 -03:00) e fim exclusivo (dia seguinte)
  const br = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  const dayStart = (ymd, add = 0) => { const d = new Date(ymd + 'T00:00:00-03:00'); d.setDate(d.getDate() + add); return d; };
  const params = () => {
    const p = new URLSearchParams(); ['creator_id', 'operator_id'].forEach(k => filters[k] && p.set(k, filters[k]));
    const today = br(new Date()); let start = null, end = null;
    if (filters.period === 'yesterday') { start = dayStart(today, -1); end = dayStart(today); }
    else if (filters.period === 'month') start = dayStart(today.slice(0, 8) + '01');
    else if (filters.period === 'lastmonth') { const first = dayStart(today.slice(0, 8) + '01'); const prev = new Date(first); prev.setMonth(prev.getMonth() - 1); start = prev; end = first; }
    else if (filters.period === 'custom') { if (filters.from) start = dayStart(filters.from); if (filters.to) end = dayStart(filters.to, 1); }
    else if (filters.period !== 'all') start = dayStart(today, -(Number(filters.period) - 1));
    if (start) p.set('start', start.toISOString()); if (end) p.set('end', end.toISOString());
    return p.toString();
  };
  const query = params();
  const reload = useCallback(async () => { setLoading(true); setError(''); try { setData((await api.get(`/metrics?${query}`)).data); } catch (e) { setError(errorText(e)); } finally { setLoading(false); } }, [query]);
  useEffect(() => { reload(); const id = setInterval(reload, 30000); return () => clearInterval(id); }, [reload]);
  return { data, filters, setFilters, error, loading, reload, query };
};
export const MetricFilters = ({ metrics }) => {
  const { creators } = useApp(); const [users, setUsers] = useState([]);
  useEffect(() => { api.get('/users').then(r => setUsers(r.data)).catch(() => {}); }, []);
  const { filters, setFilters, data, loading, reload, error } = metrics;
  const change = (key, value) => setFilters(f => ({ ...f, [key]: value }));
  return <><div className="metric-filter-bar"><div className="filter-selects"><Select id="metric-creator-filter" aria-label="Filtrar por criadora" value={filters.creator_id} onChange={e => change('creator_id', e.target.value)}><option value="">Todas as criadoras</option>{creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select><Select id="metric-operator-filter" aria-label="Filtrar por operador" value={filters.operator_id} onChange={e => change('operator_id', e.target.value)}><option value="">Todos os operadores</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select><div className="period-select"><CalendarDays size={16}/><Select id="metric-period-filter" aria-label="Filtrar por período" value={filters.period} onChange={e => change('period', e.target.value)}><option value="1">Hoje</option><option value="yesterday">Ontem</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="month">Este mês</option><option value="lastmonth">Mês passado</option><option value="custom">Personalizado (de – até)</option><option value="all">Todo o período retido</option></Select></div>{filters.period === 'custom' && <div className="date-range" data-testid="metric-date-range"><label>De <input type="date" value={filters.from || ''} max={filters.to || undefined} onChange={e => change('from', e.target.value)}/></label><label>até <input type="date" value={filters.to || ''} min={filters.from || undefined} onChange={e => change('to', e.target.value)}/></label></div>}</div><button title="Atualizar indicadores" data-testid="refresh-metrics" className="icon-btn" onClick={reload} disabled={loading}><RefreshCw size={17} className={loading ? 'spin' : ''}/></button></div><div className="observation-line"><Badge testId="metrics-coverage" tone={data?.summary.coverage === 'partial' ? 'amber' : 'neutral'}>{data?.summary.coverage === 'partial' ? 'Amostra parcial' : 'Sem dados observados'}</Badge><span data-testid="metrics-last-observed">Última leitura: {dateTime(data?.summary.last_observed_at)}</span></div>{error && <Notice id="metrics-error" tone="danger">{error}</Notice>}</>;
};