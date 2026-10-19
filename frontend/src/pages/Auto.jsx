import React, { useEffect, useState, useMemo } from 'react';
import { RefreshCw, Sparkles, AlertTriangle, XCircle, DollarSign, Inbox, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, dateTime } from '../lib/api';
import { PageHeading, Stat, Badge, Button, Field, Notice, Empty, SectionHeading, Avatar } from '../components/Common';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '../components/ui/sheet';
import { Switch } from '../components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';
import { Progress } from '../components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

const DAYS = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
const LS_KEY = 'auto-filters';

function loadFilters() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function saveFilters(f) { try { localStorage.setItem(LS_KEY, JSON.stringify(f)); } catch {} }

function formatWindows(windows) {
  if (!windows?.length) return '—';
  return windows.map(w => {
    const hours = w.start === w.end ? '0h–24h' : `${w.start}h–${w.end}h`;
    const days = !w.days?.length ? 'todos os dias' : w.days.map(d => DAYS[d]).join(' ');
    return `${hours} · ${days}`;
  }).join(' + ');
}

export default function Auto() {
  const [configs, setConfigs] = useState([]);
  const [day, setDay] = useState(new Date().toLocaleDateString('sv', { timeZone: 'America/Sao_Paulo' }));
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState(() => ({ q: '', status: 'todas', ficha: true, ...loadFilters() }));
  const [edit, setEdit] = useState(null);
  const [confirmReal, setConfirmReal] = useState(null);
  const [sheetError, setSheetError] = useState('');
  const [histCreator, setHistCreator] = useState('todas');

  useEffect(() => { saveFilters(filters); }, [filters]);

  const load = async () => {
    setBusy(true);
    try {
      const [cfgs, rep] = await Promise.all([
        api.get('/auto/configs'),
        api.get(`/auto/report?day=${day}${histCreator !== 'todas' ? `&creator_id=${histCreator}` : ''}`),
      ]);
      setConfigs(cfgs.data || []);
      setD(rep.data);
    } catch (e) { toast.error(errorText(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [day, histCreator]);

  const toggle = async (c, enabled) => {
    if (enabled && !c.ficha_pronta) { toast.error('Preencha a ficha da IA antes de ligar'); return; }
    try { await api.post(`/auto/config/toggle?creator_id=${c.creator_id}&enabled=${enabled}`); toast.success(enabled ? 'Ligada' : 'Desligada'); load(); }
    catch (e) { toast.error(errorText(e)); }
  };

  const stats = useMemo(() => {
    const ligadas = configs.filter(c => c.enabled);
    const ensaio = ligadas.filter(c => c.essay).length;
    const real = ligadas.length - ensaio;
    const respostas = configs.reduce((a, c) => a + (c.today || 0) + (c.today_essay || 0), 0);
    const ensaioResp = configs.reduce((a, c) => a + (c.today_essay || 0), 0);
    const travados = d?.summary?.travados || 0;
    const motivos = Object.entries(d?.summary?.motivos || {}).sort((a,b) => b[1]-a[1]).slice(0,3).map(([k]) => k).join(', ');
    const gasto = d?.summary?.cost_usd || 0;
    const calls = d?.summary?.calls || 1;
    return { ligadas: ligadas.length, real, ensaio, respostas, ensaioResp, travados, motivos, gasto, porResp: gasto / Math.max(1, calls) };
  }, [configs, d]);

  const filtered = useMemo(() => {
    let list = configs;
    if (filters.q) list = list.filter(c => c.name.toLowerCase().includes(filters.q.toLowerCase()));
    if (filters.status === 'ligadas') list = list.filter(c => c.enabled);
    else if (filters.status === 'desligadas') list = list.filter(c => !c.enabled);
    else if (filters.status === 'ensaio') list = list.filter(c => c.enabled && c.essay);
    else if (filters.status === 'real') list = list.filter(c => c.enabled && !c.essay);
    const hidden = filters.ficha ? list.filter(c => !c.ficha_pronta).length : 0;
    if (filters.ficha) list = list.filter(c => c.ficha_pronta);
    return { list, hidden };
  }, [configs, filters]);

  const openEdit = (c) => { setEdit({ ...c, windows: c.windows || [{start:0,end:24,days:null}] }); setSheetError(''); };
  const saveEdit = async () => {
    setSheetError('');
    try { await api.put('/auto/config', edit); toast.success('Salvo'); setEdit(null); load(); }
    catch (e) { setSheetError(errorText(e)); }
  };
  const setMode = (essay) => {
    if (!essay && edit.essay) setConfirmReal(edit);
    else setEdit({ ...edit, essay });
  };
  const confirmMode = () => { setEdit({ ...edit, essay: false }); setConfirmReal(null); };

  return (
    <>
      <PageHeading title="Ensaio automático" description="A IA responde os fãs das criadoras ligadas, dentro dos horários de cada uma.">
        <input type="date" value={day} onChange={e => setDay(e.target.value)} />
        <Button variant="ghost" disabled={busy} onClick={load}><RefreshCw size={15}/>Atualizar</Button>
      </PageHeading>

      <div className="stats-grid">
        <Stat id="au-ligadas" label="Ligadas agora" value={stats.ligadas} caption={`${stats.real} em envio real · ${stats.ensaio} em ensaio`} icon={Sparkles}/>
        <Stat id="au-respostas" label="Respostas hoje" value={stats.respostas} caption={`${stats.respostas - stats.ensaioResp} enviadas · ${stats.ensaioResp} em ensaio`} icon={Sparkles}/>
        <Stat id="au-travadas" label="Travadas para a equipe" value={stats.travados} caption={stats.motivos || '—'} icon={AlertTriangle}/>
        <Stat id="au-gasto" label="Gasto de IA hoje" value={`US$ ${stats.gasto.toFixed(2)}`} caption={`US$ ${stats.porResp.toFixed(4)} por resposta`} icon={DollarSign}/>
      </div>

      <div style={{display:'flex',gap:12,alignItems:'center',margin:'16px 0',flexWrap:'wrap'}}>
        <div style={{position:'relative'}}>
          <Search size={14} style={{position:'absolute',left:8,top:10,opacity:0.5}}/>
          <input className="table-search" style={{paddingLeft:28,maxWidth:200}} placeholder="Buscar criadora" value={filters.q} onChange={e => setFilters({...filters, q: e.target.value})}/>
        </div>
        <ToggleGroup type="single" value={filters.status} onValueChange={v => v && setFilters({...filters, status: v})}>
          <ToggleGroupItem value="todas">Todas</ToggleGroupItem>
          <ToggleGroupItem value="ligadas">Ligadas</ToggleGroupItem>
          <ToggleGroupItem value="desligadas">Desligadas</ToggleGroupItem>
          <ToggleGroupItem value="ensaio">Ensaio</ToggleGroupItem>
          <ToggleGroupItem value="real">Envio real</ToggleGroupItem>
        </ToggleGroup>
        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:13}}>
          <Checkbox checked={filters.ficha} onCheckedChange={v => setFilters({...filters, ficha: !!v})}/>
          Só com ficha pronta
        </label>
      </div>

      <div className="table-scroll">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Criadora</TableHead>
              <TableHead>Modo</TableHead>
              <TableHead>Ligada</TableHead>
              <TableHead>Horários</TableHead>
              <TableHead>Hoje</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.list.map(c => (
              <TableRow key={c.creator_id}>
                <TableCell>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <Avatar name={c.name} src={c.avatar} size={32}/>
                    <div>
                      <strong>{c.name}</strong>
                      <div style={{fontSize:12,opacity:0.6}}>{c.ficha_pronta ? 'ficha pronta' : 'sem ficha'}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {!c.enabled ? <Badge tone="neutral">Desligada</Badge> : c.essay ? <Badge tone="warn">Ensaio</Badge> : <Badge tone="good">Envio real</Badge>}
                </TableCell>
                <TableCell>
                  <Switch checked={c.enabled} onCheckedChange={v => toggle(c, v)}/>
                </TableCell>
                <TableCell style={{fontSize:12}}>{formatWindows(c.windows)}</TableCell>
                <TableCell>
                  <div style={{fontSize:12}}>{c.today || 0} / {c.max_per_day}</div>
                  <Progress value={Math.min(100, ((c.today||0)/Math.max(1,c.max_per_day))*100)} style={{height:4,marginTop:2,background: c.limit_hit ? '#c44' : undefined}}/>
                  {c.limit_hit && <div style={{color:'#c44',fontSize:11}}>Limite do dia atingido</div>}
                  <div style={{fontSize:11,opacity:0.6}}>até {c.max_per_fan} por fã</div>
                </TableCell>
                <TableCell><Button variant="outline" size="sm" onClick={() => openEdit(c)}>Editar</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {filtered.hidden > 0 && <div style={{marginTop:8,fontSize:13,opacity:0.7}}>{filtered.hidden} criadoras sem ficha da IA escondidas · <button onClick={() => setFilters({...filters, ficha:false})} style={{background:'none',border:'none',color:'#48c',cursor:'pointer'}}>mostrar todas</button></div>}
      {!filtered.list.length && <Empty title="Nenhuma criadora" description="Ajuste os filtros ou ligue uma criadora." icon={Inbox}/>}

      <SectionHeading title="Histórico de respostas">
        <Select value={histCreator} onValueChange={setHistCreator}>
          <SelectTrigger style={{width:180}}><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            {configs.map(c => <SelectItem key={c.creator_id} value={c.creator_id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </SectionHeading>
      {d && d.rows?.length ? (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Hora</th><th>Fã</th><th>Última do fã</th><th>Sugerido</th><th>Resultado</th></tr></thead>
            <tbody>{d.rows.map(r => <tr key={r.id}><td>{dateTime(r.at)}</td><td>{r.fan_name || r.fan_ref?.slice(0,8)}</td><td>{(r.last_fan||'').slice(0,60)}</td><td>{(r.suggested_text||'').slice(0,60)}</td><td>{r.decision}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <Empty title="Sem decisões" description="Nada neste dia." icon={Inbox}/>}

      <Sheet open={!!edit} onOpenChange={v => !v && setEdit(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle style={{display:'flex',alignItems:'center',gap:8}}>
              {edit && <Avatar name={edit.name} src={edit.avatar} size={32}/>}
              {edit?.name}
              <Badge tone={edit?.ficha_pronta ? 'good' : 'neutral'}>{edit?.ficha_pronta ? 'ficha pronta' : 'sem ficha'}</Badge>
            </SheetTitle>
          </SheetHeader>
          {edit && (
            <div style={{padding:'16px 0',display:'flex',flexDirection:'column',gap:16}}>
              {sheetError && <Notice>{sheetError}</Notice>}
              <div>
                <div style={{fontSize:13,marginBottom:4}}>Modo</div>
                <ToggleGroup type="single" value={edit.essay ? 'ensaio' : 'real'} onValueChange={v => v && setMode(v === 'ensaio')}>
                  <ToggleGroupItem value="ensaio">Ensaio</ToggleGroupItem>
                  <ToggleGroupItem value="real">Envio real</ToggleGroupItem>
                </ToggleGroup>
                <div style={{fontSize:12,opacity:0.6,marginTop:4}}>{edit.essay ? 'Só registra o que enviaria.' : 'A IA manda as mensagens.'}</div>
              </div>
              <Field label="Respostas por dia" id="max-day"><input id="max-day" type="number" min={1} max={1000} value={edit.max_per_day} onChange={e => setEdit({...edit, max_per_day: +e.target.value})}/></Field>
              <Field label="Por fã, por dia" id="max-fan"><input id="max-fan" type="number" min={1} max={50} value={edit.max_per_fan} onChange={e => setEdit({...edit, max_per_fan: +e.target.value})}/></Field>
              <div style={{fontSize:12,opacity:0.6}}>Zera à meia-noite (Brasília)</div>
              <div>
                <div style={{fontSize:13,marginBottom:4}}>Horários</div>
                <div style={{display:'flex',gap:6,marginBottom:8}}>
                  <Button size="sm" variant="outline" onClick={() => setEdit({...edit, windows:[...edit.windows, {start:0,end:8,days:null}]})}>Madrugada 0h–8h</Button>
                  <Button size="sm" variant="outline" onClick={() => setEdit({...edit, windows:[...edit.windows, {start:18,end:24,days:null}]})}>Noite 18h–24h</Button>
                  <Button size="sm" variant="outline" onClick={() => setEdit({...edit, windows:[...edit.windows, {start:0,end:24,days:null}]})}>Dia todo</Button>
                </div>
                {edit.windows.map((w,i) => (
                  <div key={i} style={{border:'1px solid #ddd',borderRadius:8,padding:8,marginBottom:8}}>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <span>De</span>
                      <select value={w.start} onChange={e => setEdit({...edit, windows: edit.windows.map((x,j) => j===i ? {...x, start:+e.target.value} : x)})}>{[...Array(25)].map((_,h) => <option key={h} value={h}>{h}h</option>)}</select>
                      <span>até</span>
                      <select value={w.end} onChange={e => setEdit({...edit, windows: edit.windows.map((x,j) => j===i ? {...x, end:+e.target.value} : x)})}>{[...Array(25)].map((_,h) => <option key={h} value={h}>{h}h</option>)}</select>
                      <button onClick={() => setEdit({...edit, windows: edit.windows.filter((_,j)=>j!==i)})} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer'}}>🗑</button>
                    </div>
                    <div style={{marginTop:6,display:'flex',gap:4}}>
                      {DAYS.map((d,di) => (
                        <button key={di} onClick={() => setEdit({...edit, windows: edit.windows.map((x,j) => { if(j!==i) return x; const days = x.days||[]; const next = days.includes(di) ? days.filter(v=>v!==di) : [...days,di].sort(); return {...x, days: next.length?next:null}; })})} style={{padding:'2px 6px',fontSize:11,background:(w.days||[]).includes(di)?'#48c':'#eee',color:(w.days||[]).includes(di)?'#fff':'#333',border:'none',borderRadius:4,cursor:'pointer'}}>{d}</button>
                      ))}
                    </div>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setEdit({...edit, windows:[...edit.windows, {start:0,end:24,days:null}]})}>+ Adicionar faixa</Button>
                <div style={{fontSize:11,opacity:0.6,marginTop:4}}>Nenhum dia marcado = todos os dias. Faixa que passa da meia-noite vale (ex.: 22h até 6h). Se um chatter estiver em turno nesta criadora, a IA pausa só ela.</div>
              </div>
            </div>
          )}
          <SheetFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={saveEdit}>Salvar</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirmReal} onOpenChange={v => !v && setConfirmReal(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar envio real</AlertDialogTitle>
            <AlertDialogDescription>A IA vai mandar mensagens de verdade para os fãs da {confirmReal?.name}. Confirmar?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmMode}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
