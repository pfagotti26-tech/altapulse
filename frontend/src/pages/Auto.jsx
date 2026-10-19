import React, { useEffect, useState } from 'react';
import { RefreshCw, Sparkles, AlertTriangle, XCircle, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, dateTime } from '../lib/api';
import { PageHeading, Stat, Button, Empty, Notice } from '../components/Common';

// AUTO (Grok) — resumo do ensaio. Só leitura. Nada envia.
export default function Auto() {
  const [configs, setConfigs] = useState([]);
  const [cfgError, setCfgError] = useState(false);
  const [saveError, setSaveError] = useState('');
  const loadConfigs = () => api.get('/auto/configs').then(r => { setConfigs(r.data || []); setCfgError(false); }).catch(() => setCfgError(true));
  useEffect(() => { loadConfigs(); }, []);
  const toggle = async (cid, enabled) => { try { await api.post(`/auto/config/toggle?creator_id=${cid}&enabled=${enabled}`); toast.success(enabled ? 'Ligado' : 'Desligado'); loadConfigs(); } catch(e){ toast.error(errorText(e)); } };
  const saveOne = async (cfg) => { setSaveError(''); try { await api.put('/auto/config', cfg); toast.success('Salvo'); loadConfigs(); } catch(e){ setSaveError(errorText(e)); toast.error(errorText(e)); } };
  const addWindow = (cid) => { setConfigs(cs => cs.map(c => c.creator_id === cid ? {...c, windows: [...(c.windows||[]), {start:0, end:24, days:null}]} : c)); };
  const removeWindow = (cid, i) => { setConfigs(cs => cs.map(c => c.creator_id === cid ? {...c, windows: c.windows.filter((_,j)=>j!==i)} : c)); };
  const updateWindow = (cid, i, field, val) => { setConfigs(cs => cs.map(c => c.creator_id === cid ? {...c, windows: c.windows.map((w,j) => j===i ? {...w, [field]: val} : w)} : c)); };
  const [day, setDay] = useState(new Date().toLocaleDateString('sv', { timeZone: 'America/Sao_Paulo' }));
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { setD((await api.get(`/auto/report?day=${day}`)).data); }
    catch (e) { toast.error(errorText(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [day]);
  const s = d && d.summary;
  return (
    <>
      <PageHeading title="Ensaio automático" subtitle="Só leitura. Nada é enviado.">
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <Button variant="ghost" disabled={busy} onClick={load}><RefreshCw size={15}/>Atualizar</Button>
      </PageHeading>
      {cfgError && <Notice>Não foi possível carregar a configuração.</Notice>}
      {saveError && <Notice>{saveError}</Notice>}
      {!d ? <p className="body-muted">Carregando…</p> : <>
      {configs.map(cfg => (
        <div key={cfg.creator_id} style={{margin:'16px 0',padding:12,background:'#1a1a2e',borderRadius:8,color:'#fff'}}>
          <strong>{cfg.name}</strong>
          {cfg.limit_hit && <span style={{marginLeft:12,color:'#f88'}}>limite do dia atingido</span>}
          <div style={{marginTop:8}}>
            <label>Ligado <input type="checkbox" checked={cfg.enabled} onChange={e => toggle(cfg.creator_id, e.target.checked)} /></label>
            <label style={{marginLeft:12}}>Ensaio <input type="checkbox" checked={cfg.essay} onChange={e => setConfigs(cs => cs.map(c => c.creator_id===cfg.creator_id ? {...c, essay: e.target.checked} : c))} /></label>
            <label style={{marginLeft:12}}>Max/dia <input type="number" value={cfg.max_per_day} onChange={e => setConfigs(cs => cs.map(c => c.creator_id===cfg.creator_id ? {...c, max_per_day: +e.target.value} : c))} style={{width:70,color:"#111",background:"#fff"}} /></label>
            <label style={{marginLeft:12}}>Max/fã <input type="number" value={cfg.max_per_fan} onChange={e => setConfigs(cs => cs.map(c => c.creator_id===cfg.creator_id ? {...c, max_per_fan: +e.target.value} : c))} style={{width:50,color:"#111",background:"#fff"}} /></label>
            <Button onClick={() => saveOne(cfg)} style={{marginLeft:12}}>Salvar</Button>
          </div>
          <div style={{marginTop:8}}>
            {(cfg.windows||[]).map((w,i) => (
              <div key={i} style={{marginTop:4}}>
                <input type="number" value={w.start} onChange={e => updateWindow(cfg.creator_id, i, 'start', +e.target.value)} style={{width:50,color:"#111",background:"#fff"}} />
                <span> às </span>
                <input type="number" value={w.end} onChange={e => updateWindow(cfg.creator_id, i, 'end', +e.target.value)} style={{width:50,color:"#111",background:"#fff"}} />
                <span style={{marginLeft:8,fontSize:12,opacity:0.8}}>{w.start===w.end ? '24h' : `${w.start}h–${w.end}h`}</span>
                <button onClick={() => removeWindow(cfg.creator_id, i)} style={{marginLeft:8,background:'#c44',color:'#fff',border:'none',borderRadius:4,padding:'2px 6px'}}>×</button>
              </div>
            ))}
            <button onClick={() => addWindow(cfg.creator_id)} style={{marginTop:4,background:'#48c',color:'#fff',border:'none',borderRadius:4,padding:'4px 8px'}}>+ faixa</button>
          </div>
        </div>
      ))}

        <div className="stats-grid">
          <Stat id="au-ensaios" label="Ensaios" value={s.ensaios} icon={Sparkles}/>
          <Stat id="au-travados" label="Travados" value={s.travados} icon={AlertTriangle}/>
          <Stat id="au-erros" label="Erros" value={s.erros} icon={XCircle}/>
          <Stat id="au-gasto" label="Gasto IA (US$)" value={s.cost_usd.toFixed(4)} caption={`${s.calls} chamadas`} icon={DollarSign}/>
        </div>
        {Object.keys(s.motivos).length > 0 && (
          <Notice>Motivos de trava: {Object.entries(s.motivos).map(([k,v]) => `${k} (${v})`).join(', ')}</Notice>
        )}
        {!d.rows.length ? <Empty title="Nenhuma decisão neste dia"/> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Hora</th><th>Fã</th><th>Última msg</th><th>Sugerido</th><th>Resultado</th></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{dateTime(r.at)}</td>
                    <td>{r.fan_name || r.fan_ref?.slice(0, 8) || '—'}</td>
                    <td>{(r.last_fan || '').slice(0, 80)}</td>
                    <td>{(r.suggested_text || '—').slice(0, 120)}</td>
                    <td>{r.decision}{r.reason ? ` · ${r.reason}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>}
    </>
  );
}
