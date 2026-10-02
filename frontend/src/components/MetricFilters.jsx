import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApp } from '../App';
import { api, dateTime, errorText } from '../lib/api';
import { Select, Badge, Notice } from './Common';
// período, criadora e chatter: os mesmos filtros em Vendas, Operação, Desempenho e Qualidade (lembrados neste navegador)
const KEY = 'alta-filtros';
const loadFilters = () => { try { return { creator_id: '', operator_id: '', period: '7', ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { creator_id: '', operator_id: '', period: '7' }; } };
const br = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const dayStart = (ymd, add = 0) => { const d = new Date(ymd + 'T00:00:00-03:00'); d.setDate(d.getDate() + add); return d; };
export const periodRange = (filters) => {
  const today = br(new Date()); let start = null, end = null;
  if (filters.period === 'yesterday') { start = dayStart(today, -1); end = dayStart(today); }
  else if (filters.period === 'month') start = dayStart(today.slice(0, 8) + '01');
  else if (filters.period === 'lastmonth') { const first = dayStart(today.slice(0, 8) + '01'); const prev = new Date(first); prev.setMonth(prev.getMonth() - 1); start = prev; end = first; }
  else if (filters.period === 'custom') { if (filters.from) start = dayStart(filters.from); if (filters.to) end = dayStart(filters.to, 1); }
  else if (filters.period !== 'all') start = dayStart(today, -(Number(filters.period) - 1));
  return { start, end };
};
const dm = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d);
// "Ontem · 01/10", "7 dias · 26/09 a 02/10": o período sempre escrito com as datas
export const periodText = (filters) => {
  const { start, end } = periodRange(filters); const name = (PERIODS.find(([v]) => v === filters.period) || [, 'Período'])[1];
  if (!start && !end) return filters.period === 'all' ? 'Todo o histórico' : name;
  const a = start ? dm(start) : '…', b = dm(new Date((end || new Date()).getTime() - (end ? 1 : 0)));
  return `${name} · ${a === b ? a : `${a} a ${b}`}`;
};
export const usePersistedFilters = () => {
  const [filters, setRaw] = useState(loadFilters);
  const setFilters = useCallback((fn) => setRaw(f => { const n = typeof fn === 'function' ? fn(f) : fn; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {} return n; }), []);
  return [filters, setFilters];
};
export const useMetrics = () => {
  const [data, setData] = useState(null), [filters, setFilters] = usePersistedFilters(), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const params = () => {
    const p = new URLSearchParams(); ['creator_id', 'operator_id'].forEach(k => filters[k] && p.set(k, filters[k]));
    const { start, end } = periodRange(filters);
    if (start) p.set('start', start.toISOString()); if (end) p.set('end', end.toISOString());
    return p.toString();
  };
  const query = params();
  const reload = useCallback(async () => { setLoading(true); setError(''); try { setData((await api.get(`/metrics?${query}`)).data); } catch (e) { setError(errorText(e)); } finally { setLoading(false); } }, [query]);
  useEffect(() => { reload(); const id = setInterval(reload, 30000); return () => clearInterval(id); }, [reload]);
  return { data, filters, setFilters, error, loading, reload, query };
};
const PERIODS = [['1', 'Hoje'], ['yesterday', 'Ontem'], ['7', '7 dias'], ['30', '30 dias'], ['month', 'Este mês'], ['lastmonth', 'Mês passado'], ['custom', 'Personalizado']];
// barra de filtros reutilizável: botões de período sempre à vista + criadora + chatter
export const FilterBar = ({ filters, setFilters, loading, onReload, chatter = true }) => {
  const { creators } = useApp(); const [users, setUsers] = useState([]);
  useEffect(() => { if (chatter) api.get('/users').then(r => setUsers(r.data)).catch(() => {}); }, [chatter]);
  const change = (key, value) => setFilters(f => ({ ...f, [key]: value }));
  return <div className="filter-panel" data-testid="filter-bar">
    <div className="period-chips" role="group" aria-label="Período">{PERIODS.map(([v, l]) => <button key={v} type="button" data-testid={`period-${v}`} className={filters.period === v ? 'on' : ''} onClick={() => change('period', v)}>{l}</button>)}
      {filters.period === 'custom' && <span className="date-range" data-testid="metric-date-range"><input type="date" aria-label="De" value={filters.from || ''} max={filters.to || undefined} onChange={e => change('from', e.target.value)}/><span>até</span><input type="date" aria-label="Até" value={filters.to || ''} min={filters.from || undefined} onChange={e => change('to', e.target.value)}/></span>}
    </div>
    <div className="filter-row">
      <label className="filter-field"><span>Criadora</span><Select id="metric-creator-filter" value={filters.creator_id} onChange={e => change('creator_id', e.target.value)}><option value="">Todas</option>{creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
      {chatter && <label className="filter-field"><span>Chatter</span><Select id="metric-operator-filter" value={filters.operator_id} onChange={e => change('operator_id', e.target.value)}><option value="">Todos</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></label>}
      {onReload && <button title="Atualizar" data-testid="refresh-metrics" className="icon-btn" onClick={onReload} disabled={loading}><RefreshCw size={17} className={loading ? 'spin' : ''}/></button>}
    </div>
  </div>;
};
export const MetricFilters = ({ metrics }) => {
  const { filters, setFilters, data, loading, reload, error } = metrics;
  return <><FilterBar filters={filters} setFilters={setFilters} loading={loading} onReload={reload}/><div className="observation-line"><Badge testId="metrics-coverage" tone={data?.summary.coverage === 'partial' ? 'amber' : 'neutral'}>{data?.summary.coverage === 'partial' ? 'Amostra parcial' : 'Sem dados observados'}</Badge><span data-testid="metrics-last-observed">Última leitura: {dateTime(data?.summary.last_observed_at)}</span></div>{error && <Notice id="metrics-error" tone="danger">{error}</Notice>}</>;
};
