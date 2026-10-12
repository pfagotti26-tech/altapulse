import React, { useEffect, useState } from 'react';
import { api, errorText, dateTime } from '../lib/api';
import { toast } from 'sonner';

export default function Shadow() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(3);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/assist/shadow?days=${days}`);
      setRows(r.data.actions || []);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [days]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Ações de Sombra</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label>Últimos</label>
          <select value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={1}>1 dia</option>
            <option value={3}>3 dias</option>
            <option value={7}>7 dias</option>
          </select>
        </div>
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
                  <td>{r.creator_id}</td>
                  <td style={{ maxWidth: 320 }}>{r.proposed_text}</td>
                  <td>{r.suggested_delay_ms ? `${(r.suggested_delay_ms/1000).toFixed(1)}s` : '—'}</td>
                  <td>{r.has_media_offer ? 'Sim' : 'Não'}</td>
                  <td style={{ maxWidth: 240 }}>{r.last_fan_message || '—'}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6}>Nenhuma ação de sombra neste período.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
