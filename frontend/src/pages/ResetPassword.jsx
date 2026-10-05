import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ArrowRight, KeyRound, ShieldCheck, Loader2 } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { Brand } from '../components/Brand';
import { Field, Submit, FormError } from '../components/Common';
// Link do e-mail ("Esqueci minha senha" ou convite de integrante): confere o código, pede a senha nova e já entra
export default function ResetPassword({ onLogin }) {
  const [params] = useSearchParams(); const token = params.get('t') || '';
  const [info, setInfo] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (!token) { setInfo({ valid: false }); return; } api.get(`/auth/reset/${encodeURIComponent(token)}`).then(r => setInfo(r.data)).catch(() => setInfo({ valid: false })); }, [token]);
  async function submit(e) { e.preventDefault(); setBusy(true); setError(''); const data = Object.fromEntries(new FormData(e.currentTarget));
    try { await api.post('/auth/reset', { token, new_password: data.new_password, confirm_password: data.confirm_password }); try { sessionStorage.setItem('alta-welcome', '1'); } catch {} await onLogin(); window.location.replace('/'); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  const invite = info?.kind === 'invite';
  return <div className="auth-page"><header className="auth-header"><Brand variant="white"/><span>UM PRODUTO ALTA AGENCY</span></header><div className="auth-main auth-main-single">
    <section className="auth-form-section" data-testid="reset-page">
      {!info ? <p className="body-muted"><Loader2 className="spin" size={16}/> Conferindo o link…</p> : !info.valid ? <><div className="auth-form-icon"><KeyRound size={27}/></div><span className="eyebrow">LINK INVÁLIDO</span><h2 data-testid="reset-invalid">Este link expirou ou já foi usado.</h2><p className="body-muted">Por segurança cada link vale uma vez só. Peça outro em "Esqueci minha senha" na tela de entrada, ou fale com seu gestor.</p><div className="auth-desktop-download" style={{ marginTop: 22 }}><Link to="/">Ir para a entrada<ArrowRight size={13}/></Link></div></>
      : <><div className="auth-form-icon"><KeyRound size={27}/></div><span className="eyebrow">{invite ? 'SEU PRIMEIRO ACESSO' : 'NOVA SENHA'}</span><h2 data-testid="reset-title">{invite ? `Bem-vindo(a), ${info.name.split(' ')[0]}.` : `Olá, ${info.name.split(' ')[0]}. Crie sua nova senha.`}</h2><p className="body-muted">Acesso de <b>{info.email}</b>. Use pelo menos 10 caracteres, com letra e número. Seus outros logins serão encerrados.</p>
      <form onSubmit={submit} className="form-stack"><Field id="reset-password" name="new_password" label="Nova senha" type="password" required minLength={10} maxLength={128} autoComplete="new-password" placeholder="Mínimo de 10 caracteres"/><Field id="reset-confirm" name="confirm_password" label="Repita a nova senha" type="password" required minLength={10} maxLength={128} autoComplete="new-password"/><FormError error={error}/><Submit id="reset-submit" busy={busy}>{invite ? 'Definir senha e entrar' : 'Salvar nova senha e entrar'}<ArrowRight size={17}/></Submit></form>
      <div className="auth-security"><ShieldCheck size={16}/><span>Seu acesso é individual. Não compartilhe a senha com ninguém, nem com o gestor.</span></div></>}
    </section></div><footer className="auth-footer"><span>© {new Date().getFullYear()} Alta Pulse · Alta Agency</span><span>Gestão com contexto. Privacidade por princípio.</span></footer></div>;
}
