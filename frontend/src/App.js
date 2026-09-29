import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api } from './lib/api';
import { Toaster } from './components/ui/sonner';
import { Shell } from './components/Shell';
import { Brand } from './components/Brand';
import Auth from './pages/Auth';
import Creators from './pages/Creators';
import Operation from './pages/Operation';
import Sales from './pages/Sales';
import Quality from './pages/Quality';
import Team from './pages/Team';
import Settings from './pages/Settings';
import Reports from './pages/Reports';
import DownloadDesktop from './pages/DownloadDesktop';
import BrowserWorkspace from './pages/BrowserWorkspace';
import DesktopDevices from './pages/DesktopDevices';
import './App.css';
import './AltaTheme.css';
import './Desktop.css';

const Context = createContext(null);
export const useApp = () => useContext(Context);
export default function App() {
  const [user, setUser] = useState(null), [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true), [setup, setSetup] = useState(false), [connectionError, setConnectionError] = useState(false);
  const [creators, setCreators] = useState([]), [station, setStation] = useState(null);
  const isDesktop = Boolean(window.altaDesktop?.installed);
  const [desktopDevice, setDesktopDevice] = useState(null);
  const refresh = useCallback(async () => {
    const [c, s] = await Promise.all([api.get('/creators'), api.get('/station/status')]);
    setCreators(c.data); setStation(s.data);
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setConnectionError(false);
    try { const status = await api.get('/auth/status'); setSetup(status.data.setup_required);
      if (!status.data.setup_required) { const r = await api.get('/auth/me'); setUser(r.data.user); setConfig(r.data.settings); }
    } catch (e) { if (e.response?.status !== 401) setConnectionError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!user || !isDesktop) { setDesktopDevice(null); return; }
    let active = true;
    let running = false;
    const register = async () => {
      if (running) return;
      running = true;
      try {
        let d = await window.altaDesktop.register();
        if (d?.error && window.altaDesktop.authorize) {
          const info = await window.altaDesktop.info();
          const ticket = await api.post('/desktop/auth/ticket', { machine_id: info.machine_id });
          if (!active) return;
          const auth = await window.altaDesktop.authorize(ticket.data.ticket);
          if (!auth?.error) d = await window.altaDesktop.register();
        }
        if (active && !d?.error) setDesktopDevice(d);
      } catch { /* A próxima tentativa revalida a sessão, sem transferir cookies. */ }
      finally { running = false; }
    };
    register(); const id = setInterval(register, 15000);
    return () => { active = false; clearInterval(id); };
  }, [user, isDesktop]);
  useEffect(() => { if (!user) return; refresh().catch(() => {});
    const timer = setInterval(() => refresh().catch(() => {}), 15000); return () => clearInterval(timer);
  }, [user, refresh]);
  const login = async () => { const r = await api.get('/auth/me'); setUser(r.data.user); setConfig(r.data.settings); };
  const logout = async () => { if (isDesktop) await window.altaDesktop.close(); await api.post('/auth/logout'); setUser(null); setCreators([]); };
  if (loading) return <div className="app-loading" data-testid="app-loading"><Brand/><i/></div>;
  if (connectionError) return <div className="app-loading" data-testid="connection-error"><h2>Não foi possível conectar</h2><button data-testid="retry-connection" onClick={load}>Tentar novamente</button></div>;
  return <Context.Provider value={{ user, config, setConfig, creators, station, refresh, logout, isDesktop, desktopDevice }}><BrowserRouter><Routes>
    <Route path="/baixar" element={<DownloadDesktop/>}/>
    <Route path="*" element={!user ? <Auth setup={setup} onLogin={login}/> : <Shell><Routes>
      <Route path="/" element={<Creators/>}/>
      <Route path="/operacao" element={user.role === 'manager' ? <Operation/> : <Navigate to="/"/>}/>
      <Route path="/vendas" element={user.role === 'manager' ? <Sales/> : <Navigate to="/"/>}/>
      <Route path="/qualidade" element={user.role === 'manager' ? <Quality/> : <Navigate to="/"/>}/>
      <Route path="/equipe" element={<Team/>}/>
      <Route path="/relatorios" element={user.role === 'manager' ? <Reports/> : <Navigate to="/"/>}/>
      <Route path="/configuracoes" element={user.role === 'manager' ? <Settings/> : <Navigate to="/"/>}/>
      <Route path="/navegador/:creatorId" element={<BrowserWorkspace/>}/>
      <Route path="/computadores" element={<DesktopDevices/>}/>
      <Route path="*" element={<Navigate to="/"/>}/>
    </Routes></Shell>}/></Routes><Toaster position="bottom-right" richColors theme="light"/>
  </BrowserRouter></Context.Provider>;
}