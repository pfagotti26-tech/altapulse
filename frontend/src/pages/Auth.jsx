import React, { useState } from 'react';
import { ArrowRight, ShieldCheck, Fingerprint, Layers3, Activity, Monitor } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { Brand, BrandMark } from '../components/Brand';
import { Field, Submit, FormError } from '../components/Common';
import { Link } from 'react-router-dom';
export default function Auth({ setup, onLogin }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e) { e.preventDefault(); setBusy(true); setError(''); const data = Object.fromEntries(new FormData(e.currentTarget));
    try { await api.post(setup ? '/auth/setup' : '/auth/login', data); await onLogin(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <div className="auth-page"><header className="auth-header"><Brand variant="white"/><span data-testid="auth-header-tag">UM PRODUTO ALTA AGENCY</span></header><div className="auth-main">
    <section className="auth-intro"><Brand variant="white" stacked id="auth-product-brand"/><span className="eyebrow" data-testid="auth-eyebrow">PESSOAS. CONTEXTO. RESULTADOS.</span><h1 data-testid="auth-headline">Sua operação.<br/><em>No centro.</em></h1><p data-testid="auth-subtitle">O ponto de encontro entre suas criadoras,<br className="desktop-br"/> sua equipe e cada resultado.</p>
    <div className="auth-operation-art" aria-hidden="true"><div className="art-line"/><div className="art-node"><Layers3 size={20}/><span>Criadoras</span></div><div className="art-node center"><BrandMark id="auth-operation-mark"/></div><div className="art-node"><Activity size={20}/><span>Operação</span></div><div className="art-node"><Monitor size={20}/><span>App desktop</span></div></div></section>
    <section className="auth-form-section"><div className="auth-form-icon"><Fingerprint size={27}/></div><span className="eyebrow" data-testid="auth-form-eyebrow">ACESSO AO GERENCIADOR</span><h2 data-testid="auth-form-title">{setup ? 'Sua agência começa aqui.' : 'Bom ter você de volta.'}</h2><p className="body-muted" data-testid="auth-form-description">{setup ? 'Cadastre o primeiro gestor do seu workspace.' : 'Entre para acompanhar sua operação.'}</p><form onSubmit={submit} className="form-stack">
      {setup && <><Field id="setup-name" name="name" label="Seu nome" placeholder="Como podemos chamar você?" required minLength={2} maxLength={70}/><Field id="setup-agency" name="agency_name" label="Nome da agência" placeholder="Sua agência" required minLength={2} maxLength={70}/></>}
      <Field id="auth-email" name="email" label="E-mail de trabalho" type="email" placeholder="voce@agencia.com.br" required autoComplete="username"/>
      <Field id="auth-password" name="password" label="Senha do gerenciador" type="password" placeholder={setup ? 'Mínimo de 8 caracteres' : 'Sua senha'} minLength={8} maxLength={128} required autoComplete={setup ? 'new-password' : 'current-password'}/><FormError error={error}/><Submit id="auth-submit" busy={busy}>{setup ? 'Criar meu workspace' : 'Entrar no workspace'}<ArrowRight size={17}/></Submit>
    </form><div className="auth-security" data-testid="auth-security"><ShieldCheck size={16}/><span>Este acesso é independente da sua conta Privacy.<br/>Nunca solicitamos a senha das criadoras.</span></div><div className="auth-desktop-download"><Link data-testid="login-download-details" to="/instalar">Instalar a extensão para Chrome<ArrowRight size={13}/></Link></div></section>
    </div><footer className="auth-footer"><span data-testid="auth-copyright">© {new Date().getFullYear()} Alta Pulse · Alta Agency</span><span data-testid="auth-footer-note">Gestão com contexto. Privacidade por princípio.</span></footer></div>;
}