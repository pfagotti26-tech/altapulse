import React, { useEffect, useState } from 'react';
import { RefreshCw, Sparkles, AlertTriangle, XCircle, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, dateTime } from '../lib/api';
import { PageHeading, Stat, Button, Empty, Notice } from '../components/Common';

// AUTO (Grok) — resumo do ensaio. Só leitura. Nada envia.
export default function Auto() {
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
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
      {!d ? <p className="body-muted">Carregando…</p> : <>
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
