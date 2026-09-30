import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck, Check, LogOut, Camera, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../App';
import { api, errorText } from '../lib/api';
import { Brand } from '../components/Brand';
import { PageHeading, Button, Submit, FormError, Notice, Avatar, shrinkImage } from '../components/Common';
import './Account.css';

const PasswordField = ({ id, label, value, onChange, autoComplete = 'new-password', minLength = 10, invalid = false }) => {
  const [visible, setVisible] = useState(false);
  return <div className="field"><label htmlFor={id} data-testid={`${id}-label`}>{label}</label><div className="account-password-input"><input id={id} data-testid={id} type={visible ? 'text' : 'password'} value={value} onChange={onChange} required minLength={minLength} maxLength={128} autoComplete={autoComplete} aria-invalid={invalid} spellCheck={false}/><button type="button" className="icon-btn" data-testid={`${id}-visibility`} title={visible ? 'Ocultar senha' : 'Mostrar senha'} aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={visible} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></div>;
};

export default function Account({ forced = false }) {
  const { user, refreshIdentity } = useApp();
  const [current, setCurrent] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  async function pickPhoto(e) { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setPhotoBusy(true); try { const image = await shrinkImage(file); await api.put('/auth/avatar', { image }); await refreshIdentity(); toast.success('Foto atualizada.'); } catch (err) { toast.error(err.response ? errorText(err) : err.message); } finally { setPhotoBusy(false); } }
  async function removePhoto() { setPhotoBusy(true); try { await api.delete('/auth/avatar'); await refreshIdentity(); toast.success('Foto removida.'); } catch (err) { toast.error(errorText(err)); } finally { setPhotoBusy(false); } }
  const lengthOk = password.length >= 10, combinationOk = /\p{L}/u.test(password) && /\d/.test(password), matches = Boolean(confirm) && password === confirm;
  async function submit(event) {
    event.preventDefault(); setError(''); setSaved(false);
    if (!lengthOk || !combinationOk || password !== password.trim()) { setError('Use pelo menos 10 caracteres, com letras e números, sem espaços nas pontas.'); return; }
    if (!matches) { setError('A confirmação da nova senha não confere.'); return; }
    if (password === current) { setError('Escolha uma senha diferente da atual.'); return; }
    setBusy(true);
    try {
      await api.post('/auth/password', { current_password: current, new_password: password, confirm_password: confirm });
      setCurrent(''); setPassword(''); setConfirm(''); setSaved(true);
      await refreshIdentity(); toast.success('Sua senha foi atualizada. Os outros acessos foram encerrados.');
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <div className={`account-page ${forced ? 'first-password-page' : ''}`}><PageHeading eyebrow={forced ? 'SEU PRIMEIRO ACESSO' : 'SEU ACESSO PESSOAL'} title={forced ? 'Crie sua senha pessoal.' : 'Minha conta'} description={forced ? 'Substitua a senha provisória antes de entrar no painel.' : 'Sua identificação e a segurança do seu acesso ao Alta Pulse.'}/><div className="account-layout"><section className="account-identity">{forced ? <div className="account-identity-icon"><ShieldCheck size={27}/></div> : <div className="account-photo" data-testid="account-photo"><Avatar user={user} className="account-photo-avatar"/><div className="account-photo-actions"><label className="photo-btn" data-testid="account-photo-upload"><Camera size={14}/>{photoBusy ? 'Enviando…' : user.avatar ? 'Trocar foto' : 'Colocar foto'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickPhoto} disabled={photoBusy}/></label>{user.avatar && <button type="button" className="photo-btn ghost" onClick={removePhoto} disabled={photoBusy}><Trash2 size={14}/>Remover</button>}</div></div>}<h2 data-testid="account-name">{user.name}</h2><p data-testid="account-email">{user.email}</p><span data-testid="account-role">{user.role === 'manager' ? 'Gestor da agência' : 'Chatter'}</span><div className="account-security-note"><KeyRound size={18}/><p data-testid="account-password-scope">Esta senha é apenas do Alta Pulse. A senha da Privacy não é alterada.</p></div></section><section className="account-password-section"><h2 data-testid="password-section-title">{forced ? 'Da senha provisória para a sua.' : 'Alterar minha senha'}</h2><form className="form-stack" onSubmit={submit}><PasswordField id="current-password" label={forced ? 'Senha provisória recebida' : 'Senha atual'} value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" minLength={8}/><PasswordField id="new-password" label="Nova senha pessoal" value={password} onChange={e => setPassword(e.target.value)}/><div className="password-rules"><span data-testid="password-rule-length" className={lengthOk ? 'met' : ''}><Check size={13}/>Pelo menos 10 caracteres</span><span data-testid="password-rule-combination" className={combinationOk ? 'met' : ''}><Check size={13}/>Letras e números</span></div><PasswordField id="confirm-password" label="Repita a nova senha" value={confirm} onChange={e => setConfirm(e.target.value)} invalid={Boolean(confirm) && !matches}/><FormError error={error}/>{saved && <p role="status" className="password-success" data-testid="password-change-success"><Check size={16}/>Senha alterada com sucesso.</p>}<div className="form-actions"><Submit id="save-password" busy={busy}>{forced ? 'Salvar senha e entrar' : 'Salvar nova senha'}</Submit></div></form><p className="password-session-note" data-testid="password-session-note">Ao salvar, seus acessos nos outros computadores serão encerrados. Este acesso continuará aberto.</p></section></div></div>;
}

export const PasswordSetup = () => {
  const { logout } = useApp();
  return <div className="password-setup"><header><Brand/><Button data-testid="password-setup-logout" variant="outline" onClick={logout}><LogOut size={15}/>Sair</Button></header><main><Account forced/></main><footer data-testid="password-setup-footer">Alta Pulse · Seu acesso é individual.</footer></div>;
};