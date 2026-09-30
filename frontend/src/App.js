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
import Performance from './pages/Performance';
import Quality from './pages/Quality';
import Team from './pages/Team';
import Settings from './pages/Settings';
import Reports from './pages/Reports';
import InstallExtension from './pages/InstallExtension';
import Account, { PasswordSetup } from './pages/Account';
import './App.css';
import './AltaTheme.css';
import './Extension.css';

const Context = createContext(null);
export const useApp = () => useContext(Context);
export default function App() {
  const [user, setUser] = useState(null), [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true), [setup, setSetup] = useState(false), [connectionError, setConnectionError] = useState(false);
  const [creators, setCreators] = useState([]);
  const refresh = useCallback(async () => {
    const c = await api.get('/creators'); setCreators(c.data);
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setConnectionError(false);
    try { const status = await api.get('/auth/status'); setSetup(status.data.setup_required);
      if (!status.data.setup_required) { const r = await api.get('/auth/me'); setUser(r.data.user); setConfig(r.data.settings); }
    } catch (e) { if (e.response?.status !== 401) setConnectionError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!user || user.must_change_password) return; refresh().catch(() => {});
    const timer = setInterval(() => refresh().catch(() => {}), 15000); return () => clearInterval(timer);
  }, [user, refresh]);
  const login = async () => { const r = await api.get('/auth/me'); setUser(r.data.user); setConfig(r.data.settings); };
  const logout = async () => { await api.post('/auth/logout'); setUser(null); setCreators([]); };
  if (loading) return <div className="app-loading" data-testid="app-loading"><Brand/><i/></div>;
  if (connectionError) return <div className="app-loading" data-testid="connection-error"><h2>Não foi possível conectar</h2><button data-testid="retry-connection" onClick={load}>Tentar novamente</button></div>;
  return <Context.Provider value={{ user, config, setConfig, creators, refresh, logout, refreshIdentity: login }}><BrowserRouter><Routes>
    <Route path="/instalar" element={<InstallExtension/>}/>
    <Route path="/baixar" element={<Navigate to="/instalar" replace/>}/>
    <Route path="*" element={!user ? <Auth setup={setup} onLogin={login}/> : user.must_change_password ? <PasswordSetup/> : <Shell><Routes>
      <Route path="/" element={<Creators/>}/>
      <Route path="/operacao" element={user.role === 'manager' ? <Operation/> : <Navigate to="/"/>}/>
      <Route path="/vendas" element={user.role === 'manager' ? <Sales/> : <Navigate to="/"/>}/>
      <Route path="/desempenho" element={user.role === 'manager' ? <Performance/> : <Navigate to="/"/>}/>
      <Route path="/qualidade" element={user.role === 'manager' ? <Quality/> : <Navigate to="/"/>}/>
      <Route path="/equipe" element={<Team/>}/>
      <Route path="/relatorios" element={user.role === 'manager' ? <Reports/> : <Navigate to="/"/>}/>
      <Route path="/configuracoes" element={user.role === 'manager' ? <Settings/> : <Navigate to="/"/>}/>
      <Route path="/minha-conta" element={<Account/>}/>
      <Route path="*" element={<Navigate to="/"/>}/>
    </Routes></Shell>}/></Routes><Toaster position="bottom-right" richColors theme="light"/>
  </BrowserRouter></Context.Provider>;
}
