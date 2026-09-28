import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CalendarDays } from 'lucide-react';
import { useApp } from '../App';
import { api, dateTime, errorText } from '../lib/api';
import { Select, Badge, Notice } from './Common';
export const useMetrics = () => {
  const [data, setData] = useState(null), [filters, setFilters] = useState({ creator_id: '', operator_id: '', period: '7' }), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const params = () => {
    const p = new URLSearchParams(); ['creator_id', 'operator_id'].forEach(k => filters[k] && p.set(k, filters[k]));
    if (filters.period !== 'all') { const date = new Date(); const brDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);
      const start = new Date(brDate + 'T00:00:00-03:00'); start.setDate(start.getDate() - (Number(filters.period) - 1)); p.set('start', start.toISOString()); }
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
  return <><div className="metric-filter-bar"><div className="filter-selects"><Select id="metric-creator-filter" aria-label="Filtrar por criadora" value={filters.creator_id} onChange={e => change('creator_id', e.target.value)}><option value="">Todas as criadoras</option>{creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select><Select id="metric-operator-filter" aria-label="Filtrar por operador" value={filters.operator_id} onChange={e => change('operator_id', e.target.value)}><option value="">Todos os operadores</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select><div className="period-select"><CalendarDays size={16}/><Select id="metric-period-filter" aria-label="Filtrar por período" value={filters.period} onChange={e => change('period', e.target.value)}><option value="1">Hoje</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="all">Todo o período retido</option></Select></div></div><button title="Atualizar indicadores" data-testid="refresh-metrics" className="icon-btn" onClick={reload} disabled={loading}><RefreshCw size={17} className={loading ? 'spin' : ''}/></button></div><div className="observation-line"><Badge testId="metrics-coverage" tone={data?.summary.coverage === 'partial' ? 'amber' : 'neutral'}>{data?.summary.coverage === 'partial' ? 'Amostra parcial' : 'Sem dados observados'}</Badge><span data-testid="metrics-last-observed">Última leitura: {dateTime(data?.summary.last_observed_at)}</span></div>{error && <Notice id="metrics-error" tone="danger">{error}</Notice>}</>;
};