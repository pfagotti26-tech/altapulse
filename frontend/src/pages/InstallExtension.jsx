import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Chrome, ShieldCheck, Puzzle, MousePointerClick, Download, PlayCircle, Layers, Sparkles, Monitor, Users, Gauge } from 'lucide-react';
import { Brand } from '../components/Brand';
import { useApp } from '../App';
import { api } from '../lib/api';
import { download } from '../lib/api';

export default function InstallExtension() {
  const { user } = useApp();
  const [desktop, setDesktop] = useState(null);
  useEffect(() => { api.get('/desktop/release').then(r => setDesktop(r.data)).catch(() => setDesktop({ available: false })); }, []);
  const installer = desktop?.installer;
  const getInstaller = () => { window.location.href = `${api.defaults.baseURL}/desktop/installer`; };
  const getZip = async () => {
    const r = await api.get('/desktop/release');
    await download('/desktop/download', r.data.zip_filename || r.data.filename);
  };
  const getExtension = async () => {
    const r = await api.get('/extension/release');
    await download('/extension/download', r.data.filename);
  };
  const mb = installer?.size ? ` · ${Math.round(installer.size / 1048576)} MB` : '';
  return <div className="ext-page">
    <header className="ext-header"><Link data-testid="ext-brand-home" to="/"><Brand/></Link><Link className="ext-back" data-testid="ext-back" to="/"><ArrowLeft size={15}/>{user ? 'Voltar ao painel' : 'Entrar no Alta Pulse'}</Link></header>
    <main className="ext-main">
      <section className="ext-hero">
        <span className="eyebrow" data-testid="ext-eyebrow">ALTA PULSE PARA WINDOWS</span>
        <h1 data-testid="ext-title">Todas as criadoras<br/><span>em uma janela só.</span></h1>
        <p data-testid="ext-subtitle">Cada criadora abre num perfil isolado, com login e sessão próprios, e a troca é um clique na lateral. O app registra presença, turno, fila de fãs esperando, tempo de resposta e vendas, sem ler o texto das conversas. Substitui o Lauth na operação.</p>
        <div className="ext-cta">
          {installer
            ? <button className="ext-download-btn" data-testid="download-installer" onClick={getInstaller}><Download size={17}/>Baixar o instalador do Alta Pulse{installer.version ? ` · v${installer.version}` : ''}{mb}</button>
            : <button className="ext-download-btn" data-testid="download-desktop" onClick={getZip} disabled={desktop && desktop.available === false}><Download size={17}/>Baixar o Alta Pulse desktop (.zip){desktop?.zip_version ? ` · v${desktop.zip_version}` : ''}</button>}
          <span className="ext-trust" data-testid="ext-trust"><ShieldCheck size={14}/>Sem API da Privacy · Sem senhas · Sem conteúdo de conversa</span>
        </div>
      </section>

      {installer ? <section className="ext-steps">
        <div><span className="ext-step-num">01</span><Download size={20}/><h2>Baixe o instalador</h2><p>Clique no botão acima. O arquivo <strong>{installer.filename}</strong> vai para a pasta Downloads.</p></div>
        <div><span className="ext-step-num">02</span><MousePointerClick size={20}/><h2>Abra o arquivo baixado</h2><p>Dois cliques. Se o Windows mostrar o aviso azul "O Windows protegeu o computador", clique em <strong>Mais informações</strong> e depois em <strong>Executar assim mesmo</strong>. Isso acontece porque o app ainda não tem assinatura digital.</p></div>
        <div><span className="ext-step-num">03</span><Layers size={20}/><h2>Pronto: ele instala e abre sozinho</h2><p>Sem escolher pasta, sem instalar nada antes. Fica um atalho <strong>Alta Pulse</strong> na área de trabalho e no menu Iniciar. As atualizações chegam sozinhas.</p></div>
        <div><span className="ext-step-num">04</span><PlayCircle size={20}/><h2>Entre e abra uma criadora</h2><p>Use o mesmo e-mail e senha do painel. Clique na criadora, faça o login dela na Privacy uma única vez e inicie o turno.</p></div>
      </section> : <section className="ext-steps">
        <div><span className="ext-step-num">01</span><Download size={20}/><h2>Instale o Node.js</h2><p>Baixe em <strong>nodejs.org</strong> (versão LTS) e instale com as opções padrão. É só na primeira vez em cada computador.</p></div>
        <div><span className="ext-step-num">02</span><Layers size={20}/><h2>Descompacte a pasta</h2><p>Extraia <strong>Alta-Pulse-Desktop</strong> num lugar fixo, por exemplo em Documentos. Não apague a pasta depois.</p></div>
        <div><span className="ext-step-num">03</span><MousePointerClick size={20}/><h2>Abra o Iniciar.bat</h2><p>Dois cliques em <strong>Iniciar.bat</strong>. Na primeira vez ele baixa o navegador do app (cerca de 100 MB) e abre sozinho.</p></div>
        <div><span className="ext-step-num">04</span><PlayCircle size={20}/><h2>Entre e abra uma criadora</h2><p>Use o mesmo acesso do painel. Clique na criadora, faça o login dela na Privacy uma única vez e inicie o turno.</p></div>
      </section>}

      <section className="ext-lauth" data-testid="ext-lauth">
        <div className="ext-lauth-tag"><Sparkles size={14}/>O QUE MUDA EM RELAÇÃO AO LAUTH</div>
        <h2 data-testid="ext-lauth-title">Mesma troca de perfil, mais a supervisão.</h2>
        <div className="ext-lauth-steps">
          <div><Users size={18}/><h3>Perfis, grupos e etiquetas</h3><p>Lateral com busca, grupos, etiquetas coloridas e anotações por criadora. Vários perfis abertos ao mesmo tempo, cada um com sua sessão.</p></div>
          <div><Monitor size={18}/><h3>Turno e presença</h3><p>Iniciar, pausar e encerrar turno direto na lateral. O painel mostra quem está com cada criadora e avisa quando alguém já está atendendo.</p></div>
          <div><Gauge size={18}/><h3>Fila, resposta e vendas</h3><p>Quantos fãs estão esperando e há quanto tempo, tempo de resposta por chatter e vendas confirmadas, tudo nas telas Operação e Vendas.</p></div>
        </div>
        <p className="ext-lauth-note"><ShieldCheck size={14}/>O app não altera a identificação do navegador nem usa proxy. Ele é um Chromium comum com um perfil por criadora, instalado só para o seu usuário do Windows (não pede senha de administrador). As métricas só entram no painel com o armazenamento ativado em Configurações.</p>
      </section>

      {installer && <p className="ext-lauth-note" data-testid="ext-advanced"><Puzzle size={14}/>Para quem prefere rodar pelo código-fonte (Node.js + Iniciar.bat): <button className="shift-link" data-testid="download-desktop" onClick={getZip}>baixar o pacote .zip{desktop?.zip_version ? ` v${desktop.zip_version}` : ''}</button></p>}

      <div className="ext-divider" data-testid="ext-divider"><span>Ou, se preferir continuar no Google Chrome</span></div>

      <section className="ext-boundaries">
        <div><Chrome size={19}/><div><h2 data-testid="ext-boundary-chrome">Extensão para o Chrome</h2><p>Registra presença e turno usando a sessão da Privacy já aberta no Chrome do chatter. Não tem a lateral de perfis nem a leitura de fila e vendas. <button className="shift-link" data-testid="download-extension" onClick={getExtension}>Baixar a extensão (.zip)</button></p></div></div>
        <div><Puzzle size={19}/><div><h2>Como instalar a extensão</h2><p>Em <strong>chrome://extensions</strong>, ligue o Modo do desenvolvedor, clique em <strong>Carregar sem compactação</strong> e escolha a pasta extraída. Depois entre com seu acesso e escolha a criadora.</p></div></div>
        <div><ShieldCheck size={19}/><div><h2 data-testid="ext-boundary-privacy">Privacidade por princípio</h2><p>Nem o app nem a extensão leem mensagens, copiam cookies ou usam a API da Privacy. Só registram presença, turno, horários e valores observados na tela.</p></div></div>
      </section>
    </main>
    <footer className="ext-footer"><span>Alta Pulse · Um produto Alta Agency.</span><span>Seu acesso ao painel permanece o mesmo.</span></footer>
  </div>;
}
