import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Chrome, ShieldCheck, MousePointerClick, Download, PlayCircle, Layers, Sparkles, Monitor, Users, Gauge, KeyRound, FolderArchive, Globe } from 'lucide-react';
import { Brand } from '../components/Brand';
import { useApp } from '../App';
import { api } from '../lib/api';
import { download } from '../lib/api';

export default function InstallExtension() {
  const { user } = useApp();
  const [desktop, setDesktop] = useState(null);
  useEffect(() => { api.get('/desktop/release').then(r => setDesktop(r.data)).catch(() => setDesktop({ available: false })); }, []);
  const installer = desktop?.installer;
  const getInstaller = () => { window.location.href = '/api/desktop/installer'; };
  const portable = desktop?.portable;
  const getPortable = () => { window.location.href = '/api/desktop/portable'; };
  const getExtension = async () => {
    const r = await api.get('/extension/release');
    await download('/extension/download', r.data.filename);
  };
  const mb = installer?.size ? ` · ${Math.round(installer.size / 1048576)} MB` : '';
  const pmb = portable?.size ? ` · ${Math.round(portable.size / 1048576)} MB` : '';
  return <div className="ext-page">
    <header className="ext-header"><Link data-testid="ext-brand-home" to="/"><Brand/></Link><Link className="ext-back" data-testid="ext-back" to="/"><ArrowLeft size={15}/>{user ? 'Voltar ao painel' : 'Entrar no Alta Pulse'}</Link></header>
    <main className="ext-main">
      <section className="ext-hero">
        <span className="eyebrow" data-testid="ext-eyebrow">ALTA PULSE PARA WINDOWS</span>
        <h1 data-testid="ext-title">Toda a operação<br/><span>em uma janela só.</span></h1>
        <p data-testid="ext-subtitle">A central de operação da agência: cada criadora num perfil isolado, troca com um clique, e tudo o que acontece no atendimento vira número para o gestor. Turno, fila de fãs, tempo de resposta, ofertas, vendas, nota de qualidade por chatter e a Alta Ajuda com IA para escrever melhor.</p>
        <div className="ext-cta">
          {installer
            ? <button className="ext-download-btn" data-testid="download-installer" onClick={getInstaller}><Download size={17}/>Baixar o Alta Pulse{installer.version ? ` · v${installer.version}` : ''}{mb}</button>
            : <button className="ext-download-btn" data-testid="download-installer" disabled><Download size={17}/>Instalador em preparação</button>}
          <span className="ext-trust" data-testid="ext-trust"><ShieldCheck size={14}/>Perfis isolados · Senhas só com o gestor · Atualiza sozinho</span>
        </div>
      </section>

      <section className="ext-steps">
        <div><span className="ext-step-num">01</span><Download size={20}/><h2>Baixe o instalador</h2><p>Clique no botão acima. O arquivo {installer ? <strong>{installer.filename}</strong> : 'do Alta Pulse'} vai para a pasta Downloads.</p></div>
        <div><span className="ext-step-num">02</span><MousePointerClick size={20}/><h2>Abra o arquivo baixado</h2><p>Dois cliques. Se o Windows mostrar o aviso azul "O Windows protegeu o computador", clique em <strong>Mais informações</strong> e depois em <strong>Executar assim mesmo</strong>.</p></div>
        <div><span className="ext-step-num">03</span><Layers size={20}/><h2>Ele instala e abre sozinho</h2><p>Sem escolher pasta e sem senha de administrador. Fica um atalho <strong>Alta Pulse</strong> na área de trabalho e as atualizações chegam sozinhas.</p></div>
        <div><span className="ext-step-num">04</span><PlayCircle size={20}/><h2>Entre e inicie o turno</h2><p>Use o mesmo e-mail e senha do painel. Clique na criadora, entre com o acesso salvo pelo gestor e inicie o turno.</p></div>
      </section>

      {portable && <section className="ext-alt" data-testid="ext-portable">
        <FolderArchive size={22}/>
        <div><h2>O antivírus bloqueou o instalador?</h2><p>Alguns antivírus (como o McAfee) barram instaladores novos. Use a versão sem instalador: baixe o .zip, clique com o botão direito e escolha <strong>Extrair tudo</strong>, e abra o <strong>Alta Pulse</strong> de dentro da pasta. O app avisa quando sair versão nova.</p></div>
        <button className="ext-alt-btn" data-testid="download-portable" onClick={getPortable}><Download size={15}/>Baixar sem instalador{pmb}</button>
      </section>}

      <section className="ext-feat" data-testid="ext-features">
        <div className="ext-feat-tag"><Sparkles size={14}/>O QUE VOCÊ TEM NO ALTA PULSE</div>
        <h2 data-testid="ext-features-title">Muito mais que trocar de perfil.</h2>
        <div className="ext-feat-steps">
          <div><Globe size={18}/><h3>Várias plataformas</h3><p>Privacy, OnlyFans, FatalFans, CloseFans, X, Instagram e Facebook, cada uma numa aba da criadora, com sessão própria e troca com um clique.</p></div>
          <div><KeyRound size={18}/><h3>Cofre de acessos</h3><p>O gestor guarda login e senha de cada plataforma. O chatter entra com um clique sem nunca ver a senha, e cada visualização fica registrada.</p></div>
          <div><Monitor size={18}/><h3>Turno e presença</h3><p>Um botão de turno para todas as criadoras do chatter. O gestor vê quem está com cada perfil, há quanto tempo, e recebe alerta de turno esquecido.</p></div>
          <div><Gauge size={18}/><h3>Fila e tempo de resposta</h3><p>Balão com as conversas sem resposta, tempo de espera de cada fã e tempo médio de resposta por chatter, no app e no painel.</p></div>
          <div><Users size={18}/><h3>Cartão do fã</h3><p>Quanto o fã já gastou, o que costuma comprar, ofertas pendentes, situação da assinatura e as anotações da equipe, ao lado da conversa.</p></div>
          <div><Layers size={18}/><h3>Vendas e qualidade</h3><p>Ofertas e vendas registradas sozinhas, filtros por dia, criadora e chatter, nota de atendimento de 0 a 100 e alertas do que precisa de atenção.</p></div>
        </div>
        <div className="ext-feat-steps one"><div><Sparkles size={18}/><h3>Alta Ajuda com IA</h3><p>O chatter escreve a ideia da mensagem e recebe versões prontas no estilo da criadora, com a tabela de preços dela e o nível de intensidade que ela permite. Quem envia é sempre o chatter.</p></div></div>
        <p className="ext-feat-note"><ShieldCheck size={14}/>O app é um navegador comum com um perfil separado por criadora, instalado só para o seu usuário do Windows. Não usa proxy, não altera a identificação do navegador e não usa API de nenhuma plataforma: as métricas vêm do que aparece na tela durante o atendimento.</p>
      </section>

      <p className="ext-feat-note ext-legacy" data-testid="ext-legacy"><Chrome size={14}/>Ainda usa a extensão antiga para o Chrome? <button className="shift-link" data-testid="download-extension" onClick={getExtension}>Baixar a extensão (.zip)</button> · ela registra só presença e turno.</p>
    </main>
    <footer className="ext-footer"><span>Alta Pulse · Um produto Alta Agency.</span><span>Seu acesso ao painel permanece o mesmo.</span></footer>
  </div>;
}
