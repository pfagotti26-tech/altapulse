import React, { useEffect, useState } from 'react';
import { api, errorText, dateTime } from '../lib/api';
import { toast } from 'sonner';

export default function Shadow() {
  const [rows, setRows] = useState([]);
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatorId, setCreatorId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (creatorId) params.set('creator_id', creatorId);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (!dateFrom && !dateTo) params.set('days', '7');
      const [shadow, cre] = await Promise.all([
        api.get(`/assist/shadow?${params.toString()}`),
        api.get('/creators'),
      ]);
      setCreators(cre.data || []);
      setRows(shadow.data.actions || []);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [creatorId, dateFrom, dateTo]);

  const nameOf = (id) => {
    const c = creators.find(x => x.id === id);
    return c ? (c.name || c.nome_artistico || id) : id;
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Ações de Sombra</h1>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12, alignItems: 'end' }}>
        <div>
          <label style={{ fontSize: 12, display: 'block' }}>Criadora</label>
          <select value={creatorId} onChange={e => setCreatorId(e.target.value)} style={{ minWidth: 180 }}>
            <option value="">Todas</option>
            {creators.map(c => <option key={c.id} value={c.id}>{c.name || c.nome_artistico}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12, display: 'block' }}>De</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 12, display: 'block' }}>Até</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <button type="button" onClick={() => { setCreatorId(''); setDateFrom(''); setDateTo(''); }}>Limpar</button>
      </div>
      {loading ? <p>Carregando…</p> : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Criadora</th>
                <th>Texto proposto</th>
                <th>Delay</th>
                <th>Mídia</th>
                <th>Última do fã</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{dateTime(r.at)}</td>
                  <td>{nameOf(r.creator_id)}</td>
                  <td style={{ maxWidth: 320 }}>{r.proposed_text}</td>
                  <td>{r.suggested_delay_ms ? `${(r.suggested_delay_ms/1000).toFixed(1)}s` : '—'}</td>
                  <td>{r.has_media_offer ? 'Sim' : 'Não'}</td>
                  <td style={{ maxWidth: 240 }}>{r.last_fan_message || '—'}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6}>Nenhuma ação de sombra com esses filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
