import React, { useEffect, useState } from 'react';
import { KeyRound, Eye, EyeOff, Trash2, Pencil, Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, dateTime } from '../lib/api';
import { Button, Field, Select, Submit, FormError, Notice } from './Common';

// Cofre de acessos da criadora (bloco F): uma linha por plataforma. Gestor cadastra/vê a senha
// (cada visualização é auditada); chatter vê só o login e "senha salva" e entra pelo app.
export default function Credentials({ creator, isManager }) {
  const [platforms, setPlatforms] = useState([]), [rows, setRows] = useState([]), [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [revealed, setRevealed] = useState({});
  const load = async () => {
    const [p, r] = await Promise.all([api.get('/platforms'), api.get('/credentials', { params: { creator_id: creator.id } })]);
    setPlatforms(p.data); setRows(r.data);
  };
  useEffect(() => { load().catch(e => toast.error(errorText(e))); }, [creator.id]);
  const byPlatform = Object.fromEntries(rows.map(r => [r.platform, r]));
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const body = { creator_id: creator.id, platform: form.platform, login: form.login.trim(), note: form.note?.trim() || null };
    if (form.password) body.password = form.password;
    try { await api.put('/credentials', body); await load(); setEditing(null); toast.success('Acesso salvo no cofre.'); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function reveal(r) {
    if (revealed[r.id]) { setRevealed(s => ({ ...s, [r.id]: null })); return; }
    try { const res = await api.post(`/credentials/${r.id}/reveal`); setRevealed(s => ({ ...s, [r.id]: res.data.password })); } catch (err) { toast.error(errorText(err)); }
  }
  async function remove(r) {
    if (!window.confirm(`Remover o acesso de ${r.platform_label}? Os chatters deixam de conseguir entrar pelo app.`)) return;
    try { await api.delete(`/credentials/${r.id}`); await load(); toast.success('Acesso removido.'); } catch (err) { toast.error(errorText(err)); }
  }
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast.success('Copiado.'); } catch { toast.error('Não foi possível copiar.'); } };
  return <div className="vault" data-testid={`vault-${creator.id}`}>
    <div className="section-heading"><div><h2><KeyRound size={16}/> Acessos das plataformas</h2><p>{isManager ? 'Só gestores cadastram e veem senhas. Cada visualização fica na auditoria.' : 'Você entra pelo Alta Pulse desktop com um clique; a senha não é exibida.'}</p></div>{isManager && !editing && <Button variant="outline" data-testid="vault-add" onClick={() => { setEditing({}); setError(''); }}><Pencil size={14}/>Cadastrar acesso</Button>}</div>
    {editing && isManager && <form className="form-stack vault-form" onSubmit={save} data-testid="vault-form">
      <Field id="vault-platform" label="Plataforma"><Select id="vault-platform" name="platform" defaultValue={editing.platform || 'privacy'} disabled={!!editing.id}>{platforms.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
      <Field id="vault-login" name="login" label="Login (e-mail, usuário ou CPF)" defaultValue={editing.login || ''} required maxLength={320} autoComplete="off"/>
      <Field id="vault-password" name="password" label={editing.id ? 'Nova senha (deixe em branco para manter)' : 'Senha'} type="password" required={!editing.id} maxLength={1024} autoComplete="new-password"/>
      <Field id="vault-note" name="note" label="Observação (opcional)" defaultValue={editing.note || ''} placeholder="Ex.: 2FA no celular da criadora" maxLength={300}/>
      <FormError error={error}/>
      <div className="form-actions"><Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Submit busy={busy} id="vault-save">Salvar no cofre</Submit></div>
    </form>}
    {rows.length ? <div className="table-scroll"><table><thead><tr><th>Plataforma</th><th>Login</th><th>Senha</th><th>Observação</th><th>Atualizado</th>{isManager && <th/>}</tr></thead><tbody>
      {rows.map(r => <tr key={r.id} data-testid={`vault-row-${r.platform}`}><td><strong>{r.platform_label}</strong></td><td className="tabular">{r.login} {isManager && <button className="icon-btn" title="Copiar login" onClick={() => copy(r.login)}><Copy size={13}/></button>}</td>
        <td className="tabular">{isManager ? <span className="vault-secret">{revealed[r.id] ? <>{revealed[r.id]} <button className="icon-btn" title="Copiar senha" onClick={() => copy(revealed[r.id])}><Copy size={13}/></button></> : '••••••••'} <button className="icon-btn" title={revealed[r.id] ? 'Ocultar' : 'Mostrar senha (fica na auditoria)'} data-testid={`vault-reveal-${r.platform}`} onClick={() => reveal(r)}>{revealed[r.id] ? <EyeOff size={14}/> : <Eye size={14}/>}</button></span> : <span className="subtle-label"><Check size={13}/> senha salva</span>}</td>
        <td>{r.note || '—'}</td><td>{dateTime(r.updated_at)}<span className="inherited-label">{r.updated_by_name}</span></td>
        {isManager && <td><div className="row-actions"><button className="icon-btn" title="Editar" data-testid={`vault-edit-${r.platform}`} onClick={() => { setEditing(r); setError(''); }}><Pencil size={14}/></button><button className="icon-btn" title="Remover" data-testid={`vault-delete-${r.platform}`} onClick={() => remove(r)}><Trash2 size={14}/></button></div></td>}
      </tr>)}
    </tbody></table></div> : <div className="inline-empty">{isManager ? 'Nenhum acesso cadastrado para esta criadora.' : 'O gestor ainda não cadastrou acessos para esta criadora.'}</div>}
    <Notice id="vault-notice">No app, quando a aba da criadora estiver na tela de login da plataforma, aparece "Entrar com o acesso salvo". Código de verificação (2FA) e captcha continuam sendo feitos pela pessoa.</Notice>
  </div>;
}
