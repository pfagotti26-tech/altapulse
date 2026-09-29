import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Monitor, ArrowLeft, ArrowRight, RotateCw, House, LockKeyhole, Play, X, CircleAlert, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../App';
import { api, errorText, initials } from '../lib/api';
import { Button, Badge, Empty, Notice } from '../components/Common';
import { DesktopDownload } from '../components/DesktopDownload';

export default function BrowserWorkspace() {
  const { creatorId } = useParams(); const { creators, user, isDesktop, desktopDevice, refresh } = useApp();
  const creator = creators.find(c => c.id === creatorId), viewport = useRef(null);
  const [state, setState] = useState({ status: 'closed' }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const ready = desktopDevice?.status === 'approved';
  const profileAvailable = Boolean(creator);
  const canOpen = user.role === 'manager' || creator?.shift?.operator_id === user.id && !creator.shift.paused;
  const open = useCallback(async () => {
    if (!isDesktop) return;
    setBusy(true); setError('');
    try { const result = await window.altaDesktop.open(creatorId); if (result?.error) setError(result.error); }
    catch { setError('Não foi possível abrir o navegador local.'); } finally { setBusy(false); }
  }, [isDesktop, creatorId]);
  useEffect(() => {
    if (!isDesktop) return;
    const off = window.altaDesktop.onState(s => { setState(s); if (s.message) setError(s.message); });
    return () => { off(); window.altaDesktop.close(); };
  }, [creatorId, isDesktop]);
  useEffect(() => {
    if (!isDesktop || !viewport.current) return;
    const layout = () => {
      if (document.querySelector('[role="dialog"]') || document.querySelector('.menu-backdrop')) { window.altaDesktop.layout(null); return; }
      const r = viewport.current.getBoundingClientRect();
      window.altaDesktop.layout({ x: r.x, y: r.y, width: r.width, height: r.height });
    };
    const resize = new ResizeObserver(layout); resize.observe(viewport.current);
    const overlays = new MutationObserver(layout); overlays.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', layout, true); window.addEventListener('resize', layout); layout();
    return () => { resize.disconnect(); overlays.disconnect(); window.removeEventListener('scroll', layout, true); window.removeEventListener('resize', layout); window.altaDesktop.layout(null); };
  }, [isDesktop, creatorId]);
  useEffect(() => {
    if (!ready || !canOpen || !profileAvailable || !isDesktop) return;
    const scheduled = setTimeout(open, 0);
    return () => clearTimeout(scheduled);
  }, [ready, canOpen, creatorId, isDesktop, open, profileAvailable]);
  const start = async () => { setBusy(true); try { if (!creator.shift) await api.post('/shifts', { creator_id: creatorId }); else await api.post(`/shifts/${creator.shift.id}/action`, { action: 'resume' }); await refresh(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  if (!creator) return <Empty id="browser-profile-not-found" icon={LockKeyhole} title="Perfil não disponível" description="Escolha uma criadora autorizada na barra lateral."/>;
  return <section className="browser-workspace"><div className="browser-profile-heading"><div className={`avatar ${creator.color}`}>{initials(creator.name)}</div><div><h1 data-testid="browser-creator-name">{creator.name}</h1><p data-testid="browser-creator-caption">Privacy · Sessão exclusiva deste computador</p></div><Badge testId="browser-runtime-state" tone={state.status === 'open' ? 'green' : 'neutral'}>{!isDesktop ? 'Aplicativo necessário' : state.status === 'open' ? 'Navegador aberto' : state.status === 'loading' ? 'Carregando' : 'Navegador fechado'}</Badge></div>
    <div className="native-browser-toolbar"><div className="browser-nav-controls">{[['back', ArrowLeft, 'Voltar', !state.can_back], ['forward', ArrowRight, 'Avançar', !state.can_forward], ['reload', RotateCw, 'Recarregar', !['open', 'loading', 'error'].includes(state.status)], ['home', House, 'Início da Privacy', state.status !== 'open']].map(([action, Icon, label, unavailable]) => <button key={action} data-testid={`browser-${action}`} title={label} aria-label={label} className="icon-btn" disabled={!isDesktop || unavailable} onClick={() => window.altaDesktop.navigate(action)}><Icon size={16}/></button>)}</div><div className="browser-address" data-testid="browser-address"><LockKeyhole size={13}/><span>Privacy · Navegador local</span></div><button data-testid="close-native-browser" title="Fechar navegador" aria-label="Fechar navegador" className="icon-btn" disabled={!isDesktop || state.status === 'closed'} onClick={() => window.altaDesktop.close()}><X size={17}/></button></div>
    <div className="native-browser-viewport" ref={viewport} data-testid="native-browser-viewport">
      {!isDesktop ? <Empty id="browser-install-required" icon={Monitor} title="O atendimento acontece no aplicativo Alta Pulse." description="Instale no Windows e entre com seu acesso. A criadora abrirá aqui dentro, sem uma janela externa."><DesktopDownload id="browser-download-desktop"/><Link data-testid="browser-install-details" className="text-link" to="/baixar">Ver instalação e requisitos<ArrowRight size={14}/></Link></Empty> : !ready ? <Empty id="browser-device-pending" icon={LockKeyhole} title={desktopDevice?.status === 'revoked' ? 'Computador sem autorização' : 'Aguardando autorização do computador'} description="Um gestor precisa aprovar este computador na página Computadores. Suas permissões de criadoras também serão verificadas."/> : error ? <Empty id="browser-open-error" icon={CircleAlert} title="Não foi possível abrir este perfil" description={error}><Button data-testid="retry-native-browser" disabled={busy} onClick={open}><RotateCw size={15}/>Tentar novamente</Button></Empty> : !canOpen ? <Empty id="browser-shift-required" icon={Play} title="Seu atendimento começa com um turno." description={creator.shift && creator.shift.operator_id !== user.id ? `Há um turno de ${creator.shift.operator_name} para esta criadora.` : 'Identifique seu turno antes de abrir o navegador da criadora.'}>{(!creator.shift || creator.shift.operator_id === user.id) && <Button data-testid="start-shift-and-browser" disabled={busy} onClick={start}><Play size={15}/>{creator.shift ? 'Retomar turno e abrir' : 'Iniciar turno e abrir'}</Button>}</Empty> : state.status === 'closed' ? <Empty id="browser-closed" icon={Monitor} title="Perfil local pronto para abrir" description="O login da Privacy é feito diretamente no navegador. Não há transferência de sessão de outro computador."><Button data-testid="open-native-browser" disabled={busy} onClick={open}><Monitor size={15}/>Abrir navegador</Button></Empty> : <div className="native-browser-wait" data-testid="browser-loading">{state.status === 'loading' ? 'Abrindo o navegador da criadora…' : 'Navegador local conectado'}</div>}
    </div><div className="browser-bottom-bar"><span data-testid="browser-local-scope"><LockKeyhole size={12}/>Sessão local · Não sincronizada</span><span data-testid="browser-collection-state">Leitura de indicadores não ativada</span></div>{state.notice && <Notice id="browser-navigation-notice" tone="amber">{state.notice}</Notice>}
  </section>;
}