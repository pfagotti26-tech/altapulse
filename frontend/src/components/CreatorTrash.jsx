import React, { useEffect, useState, useCallback } from 'react';
import { RotateCcw, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, dateTime, initials } from '../lib/api';
import { Button } from './Common';

// Lixeira: criadoras excluídas ficam 30 dias aqui (com turnos, vendas, cofre e ficha) e podem voltar.
export function CreatorTrash({ onRestored, reloadKey }) {
  const [rows, setRows] = useState([]), [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get('/creators-trash').then(r => setRows(r.data)).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load, reloadKey]);
  if (!rows.length) return null;
  const restore = async (c) => { setBusy(true); try { const r = (await api.post(`/creators/${c.id}/restore`)).data; toast.success(r.skipped?.length ? `${c.name} restaurada. Não voltou para ${r.skipped.join(', ')} (já com 150 criadoras).` : `${c.name} restaurada, com as mesmas atribuições.`); await load(); onRestored && onRestored(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } };
  const purge = async (c) => { if (!window.confirm(`Excluir ${c.name} de vez? Turnos, vendas, anotações, ficha e acessos dela somem e não dá para desfazer.`)) return; setBusy(true); try { await api.delete(`/creators/${c.id}/purge`, { data: { reason: 'Excluída de vez pela lixeira' } }); toast.success('Excluída de vez.'); await load(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } };
  return <section className="data-section" data-testid="creator-trash">
    <button type="button" className="trash-head" onClick={() => setOpen(!open)}>{open ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}<b>Apagados recentemente</b><span>{rows.length}</span><small>ficam 30 dias e depois somem com os dados</small></button>
    {open && <div className="table-scroll"><table><thead><tr><th>Criadora</th><th>Excluída em</th><th>Por</th><th>Motivo</th><th>Some em</th><th/></tr></thead><tbody>
      {rows.map(c => <tr key={c.id}><td><span className={`avatar tiny-avatar ${c.color}`}>{c.avatar ? <img src={c.avatar} alt=""/> : initials(c.name)}</span> <strong>{c.name}</strong></td><td>{dateTime(c.deleted_at)}</td><td>{c.deleted_by}</td><td className="body-muted">{c.deleted_reason}</td><td>{dateTime(c.purge_at).split(' ')[0]}</td>
        <td className="row-actions"><Button variant="outline" disabled={busy} onClick={() => restore(c)}><RotateCcw size={14}/>Restaurar</Button><Button variant="ghost" disabled={busy} title="Excluir de vez" onClick={() => purge(c)}><Trash2 size={14}/></Button></td></tr>)}
    </tbody></table></div>}
  </section>;
}
