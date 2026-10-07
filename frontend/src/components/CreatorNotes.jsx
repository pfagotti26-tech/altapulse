import React, { useEffect, useState, useCallback } from 'react';
import { Pin, PinOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, dateTime } from '../lib/api';
import { Button } from './Common';

// Anotações da criadora: notas curtas com autor e hora (passagem de turno). Aparecem também no app.
export function CreatorNotes({ creator, user, onChange }) {
  const [rows, setRows] = useState(null), [text, setText] = useState(''), [pinned, setPinned] = useState(false), [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(`/creators/${creator.id}/notes`).then(r => setRows(r.data)).catch(e => toast.error(errorText(e))), [creator.id]);
  useEffect(() => { load(); }, [load]);
  const add = async () => { if (!text.trim()) return; setBusy(true); try { await api.post(`/creators/${creator.id}/notes`, { text: text.trim(), pinned }); setText(''); setPinned(false); await load(); onChange && onChange(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } };
  const del = async (n) => { if (!window.confirm('Apagar esta anotação?')) return; try { await api.delete(`/creator-notes/${n.id}`); await load(); onChange && onChange(); } catch (e) { toast.error(errorText(e)); } };
  const pin = async (n) => { try { await api.patch(`/creator-notes/${n.id}`, { pinned: !n.pinned }); await load(); } catch (e) { toast.error(errorText(e)); } };
  return <div className="form-stack" data-testid="creator-notes">
    <textarea className="assist-textarea" rows={3} maxLength={1000} placeholder="Ex.: fã João prometeu comprar hoje às 21h · não oferecer vídeo essa semana" value={text} onChange={e => setText(e.target.value)}/>
    <div className="row-actions" style={{ justifyContent: 'space-between' }}><label className="checkbox-label small"><input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)}/><span>Fixar no topo</span></label><Button disabled={busy || !text.trim()} onClick={add}>Adicionar nota</Button></div>
    {rows == null ? <p className="body-muted">Carregando…</p> : rows.length ? <div className="note-list">{rows.map(n => <div key={n.id} className={`note-item ${n.pinned ? 'pinned' : ''}`}>
      <p>{n.text}</p><div className="note-meta"><span>{n.pinned ? '📌 ' : ''}{n.author} · {dateTime(n.created_at)}</span><span className="row-actions">
        <button className="icon-btn" title={n.pinned ? 'Desafixar' : 'Fixar no topo'} onClick={() => pin(n)}>{n.pinned ? <PinOff size={14}/> : <Pin size={14}/>}</button>
        {(n.author_id === user.id || user.role !== 'chatter') &&<button className="icon-btn" title="Apagar" onClick={() => del(n)}><Trash2 size={14}/></button>}</span></div></div>)}</div>
      : <div className="inline-empty">Nenhuma anotação ainda.</div>}
  </div>;
}
