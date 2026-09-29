import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Chrome, ShieldCheck, Puzzle, MousePointerClick, Download, PlayCircle } from 'lucide-react';
import { Brand } from '../components/Brand';
import { useApp } from '../App';
import { api } from '../lib/api';
import { download } from '../lib/api';

export default function InstallExtension() {
  const { user } = useApp();
  const getExtension = async () => {
    const r = await api.get('/extension/release');
    await download('/extension/download', r.data.filename);
  };
  return <div className="ext-page">
    <header className="ext-header"><Link data-testid="ext-brand-home" to="/"><Brand/></Link><Link className="ext-back" data-testid="ext-back" to="/"><ArrowLeft size={15}/>{user ? 'Voltar ao painel' : 'Entrar no Alta Pulse'}</Link></header>
    <main className="ext-main">
      <section className="ext-hero">
        <span className="eyebrow" data-testid="ext-eyebrow">EXTENSÃO PARA GOOGLE CHROME</span>
        <h1 data-testid="ext-title">Monitore no Chrome<br/><span>que você já usa.</span></h1>
        <p data-testid="ext-subtitle">Sem instalar programa. Sem bloqueio do Windows. A extensão acompanha presença, turnos e atendimento direto no navegador dos chatters — usando a própria sessão da Privacy que eles já abrem.</p>
        <div className="ext-cta">
          <button className="ext-download-btn" data-testid="download-extension" onClick={getExtension}><Download size={17}/>Baixar a extensão (.zip)</button>
          <span className="ext-trust" data-testid="ext-trust"><ShieldCheck size={14}/>Sem API da Privacy · Sem senhas · Sem conteúdo de conversa</span>
        </div>
      </section>

      <section className="ext-steps">
        <div><span className="ext-step-num">01</span><Download size={20}/><h2>Baixe e descompacte</h2><p>Clique em baixar e extraia a pasta <strong>Alta-Pulse-Extensao</strong> em um lugar fixo do computador.</p></div>
        <div><span className="ext-step-num">02</span><Puzzle size={20}/><h2>Abra as extensões</h2><p>No Chrome, acesse <strong>chrome://extensions</strong> e ligue o <strong>Modo do desenvolvedor</strong> no canto superior direito.</p></div>
        <div><span className="ext-step-num">03</span><MousePointerClick size={20}/><h2>Carregar sem compactação</h2><p>Clique em <strong>Carregar sem compactação</strong> e selecione a pasta que você extraiu. A extensão Alta Pulse aparece na barra.</p></div>
        <div><span className="ext-step-num">04</span><PlayCircle size={20}/><h2>Entre e escolha a criadora</h2><p>Abra a extensão, entre com seu acesso Alta Pulse, escolha a criadora atendida e inicie seu turno.</p></div>
      </section>

      <section className="ext-boundaries">
        <div><Chrome size={19}/><div><h2 data-testid="ext-boundary-chrome">Usa o Chrome real, sem bloqueio</h2><p>Como roda dentro do Chrome que o chatter já usa para acessar a Privacy, não há o bloqueio WAF-403 que o aplicativo desktop enfrentava. Nada de instalador assinado.</p></div></div>
        <div><ShieldCheck size={19}/><div><h2 data-testid="ext-boundary-privacy">Privacidade por princípio</h2><p>A extensão não lê mensagens, não copia cookies, não usa a API da Privacy e não envia nenhum conteúdo. Só registra presença, turno e horários observados.</p></div></div>
        <div><Puzzle size={19}/><div><h2 data-testid="ext-boundary-store">Distribuição pela sua conta</h2><p>Para instalação com um clique e atualização automática, publique esta mesma pasta como extensão <strong>não listada</strong> na Chrome Web Store da agência.</p></div></div>
      </section>
    </main>
    <footer className="ext-footer"><span>Alta Pulse · Um produto Alta Agency.</span><span>Seu acesso ao painel permanece o mesmo.</span></footer>
  </div>;
}
