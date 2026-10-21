import React, { useState, useEffect, useCallback } from 'react';
import { MessageSquare, CalendarClock, Settings2, FileChartColumn, RefreshCw, Inbox, Send, Plus, Trash2, Upload, Banknote, Users, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../App';
import { api, errorText, money, dateTime } from '../lib/api';
import { PageHeading, Button, Input, Badge, Modal, Field, Select, Submit, FormError, Empty, Notice, Stat, SectionHeading } from '../components/Common';

// Lote 161 — WhatsApp de vendas da criadora. Canal separado da Privacy; nada de conteúdo adulto.
// Conversas e pedidos: gestor e chatters com a criadora atribuída. Configuração e relatório: gestor.
const KIND = { call: 'Chamada ao vivo', custom: 'Vídeo personalizado', photos: 'Fotos', videos: 'Vídeos' };
const DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const STAGE = { novo: ['neutral', 'novo'], idade: ['amber', 'confirmando idade'], conversando: ['neutral', 'conversando'], escolhendo: ['neutral', 'escolhendo'], pedido: ['neutral', 'montando pedido'], aguardando_pix: ['amber', 'esperando Pix'], cliente: ['green', 'cliente'], bloqueado: ['red', 'bloqueado'] };
const OSTATUS = { aguardando_pix: ['amber', 'esperando Pix'], pago: ['green', 'pago'], expirado: ['neutral', 'expirado'], cancelado: ['neutral', 'cancelado'], devolvido: ['red', 'devolvido'] };
const reais = c => c == null ? '' : (c / 100).toFixed(2).replace('.', ',');
const cents = v => Math.round(parseFloat(String(v || '0').replace(/\./g, '').replace(',', '.')) * 100) || 0;
const Sw = ({ on, onClick, label, id, disabled }) => <button type="button" disabled={disabled} className={`switch ${on ? 'on' : ''}`} aria-pressed={!!on} aria-label={label} title={label} data-testid={id} onClick={onClick}><i/></button>;
const slotText = o => o.slot_start ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(o.slot_start)) : '';

function Conversas({ creators }) {
  const [cid, setCid] = useState(''), [status, setStatus] = useState('todas'), [rows, setRows] = useState(null), [open, setOpen] = useState(null), [d, setD] = useState(null), [text, setText] = useState(''), [busy, setBusy] = useState(false), [offer, setOffer] = useState(null);
  const load = useCallback(async () => { try { const r = await api.get('/wa/contacts', { params: { creator_id: cid, status } }); setRows(r.data); } catch (e) { toast.error(errorText(e)); } }, [cid, status]);
  const loadOne = useCallback(async (id) => { if (!id) return; try { const r = await api.get(`/wa/contacts/${id}`); setD(r.data); } catch (e) { toast.error(errorText(e)); } }, []);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  useEffect(() => { loadOne(open); if (!open) return; const t = setInterval(() => loadOne(open), 10000); return () => clearInterval(t); }, [open, loadOne]);
  async function act(path, body, ok) { setBusy(true); try { await api.post(`/wa/contacts/${open}/${path}`, body || {}); if (ok) toast.success(ok); await loadOne(open); await load(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } }
  async function send(e) { e.preventDefault(); if (!text.trim()) return; await act('send', { text }); setText(''); }
  const c = d?.contact;
  return <>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      <Select id="wa-c-creator" value={cid} onChange={e => setCid(e.target.value)}><option value="">Todas as criadoras</option>{creators.map(x => <option key={x.creator_id} value={x.creator_id}>{x.name}</option>)}</Select>
      <Select id="wa-c-status" value={status} onChange={e => setStatus(e.target.value)}><option value="todas">Todas</option><option value="humano">Precisa de humano</option><option value="pix">Esperando Pix</option><option value="clientes">Clientes</option><option value="bloqueados">Bloqueados</option></Select>
    </div>
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <section className="data-section" style={{ flex: '1 1 300px', maxWidth: 380, padding: 0, overflow: 'hidden' }}>
        {rows && !rows.length && <Empty id="wa-c-empty" icon={Inbox} title="Nenhuma conversa" description="Quando alguém mandar mensagem para o número da criadora, aparece aqui."/>}
        {(rows || []).map(r => <button key={r.id} type="button" onClick={() => setOpen(r.id)} data-testid={`wa-contact-${r.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', textAlign: 'left', padding: '12px 16px', border: 0, borderTop: '1px solid var(--line, #e7e7e9)', background: open === r.id ? '#faf0f2' : 'transparent', cursor: 'pointer', font: 'inherit' }}>
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{r.name || `…${r.phone_end}`} · {r.creator_name}</strong><span className="body-muted" style={{ fontSize: 12 }}>{dateTime(r.last_in_at)}</span></span>
          <span className="body-muted" style={{ fontSize: 13 }}>{r.last_text}</span>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{r.blocked ? <Badge tone="red">{r.blocked}</Badge> : r.human ? <Badge tone="red">{r.human_by ? `com ${r.human_by}` : `precisa de você · ${r.human_reason || ''}`}</Badge> : <Badge tone={STAGE[r.stage]?.[0]}>{STAGE[r.stage]?.[1] || r.stage}</Badge>}{r.source && <Badge tone="neutral">{r.source === 'tiktok' ? 'TikTok' : 'Instagram'}</Badge>}</span>
        </button>)}
      </section>
      <section className="data-section" style={{ flex: '999 1 460px', minWidth: 0 }}>
        {!c ? <Empty id="wa-c-none" icon={MessageSquare} title="Escolha uma conversa" description="A IA atende sozinha. Você assume quando ela travar ou quando quiser."/> : <>
          <SectionHeading title={`${c.name || 'Contato'} · final ${c.phone_end}`} caption={`${c.age_ok ? '18+ confirmado' : 'idade não confirmada'}${c.spent_cents ? ` · já gastou ${money(c.spent_cents)}` : ''}${c.human ? ` · ${c.human_by ? `com ${c.human_by}` : 'IA parada'}` : ' · IA atendendo'}`}>
            <div className="row-actions" style={{ flexWrap: 'wrap' }}>
              {!c.age_ok && !c.blocked && <><Button variant="outline" disabled={busy} onClick={() => act('age', { ok: true }, 'Idade confirmada.')}>Confirmar 18+</Button><Button variant="outline" disabled={busy} onClick={() => act('age', { ok: false }, 'Bloqueado por idade.')}>É menor</Button></>}
              {!c.blocked && (c.human ? <Button variant="outline" disabled={busy} onClick={() => act('return', null, 'Devolvida para a IA.')}>Devolver à IA</Button> : <Button disabled={busy} onClick={() => act('take', null, 'Você assumiu.')}>Assumir</Button>)}
              {!c.blocked && c.age_ok && <Button variant="outline" onClick={() => setOffer({ item_id: d.items[0]?.id || '' })}><Banknote size={15}/>Vender</Button>}
              {!c.blocked && <Button variant="outline" disabled={busy} onClick={() => act('block', { reason: 'bloqueado pela equipe' }, 'Bloqueado.')}><Ban size={15}/>Bloquear</Button>}
            </div>
          </SectionHeading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 460, overflowY: 'auto', padding: '6px 2px' }}>
            {d.messages.map(m => <div key={m.id} style={{ alignSelf: m.dir === 'in' ? 'flex-start' : 'flex-end', maxWidth: '75%', background: m.dir === 'in' ? '#fff' : '#C41E3A', color: m.dir === 'in' ? 'inherit' : '#fff', border: m.dir === 'in' ? '1px solid #e7e7e9' : 0, borderRadius: 10, padding: '8px 12px', fontSize: 14, whiteSpace: 'pre-wrap' }}>{m.text}<div style={{ fontSize: 10, opacity: .75, marginTop: 3 }}>{m.dir === 'out' ? (m.by === 'ia' ? 'IA' : m.by.replace('chatter:', '')) + ' · ' : ''}{dateTime(m.at)}{m.dir === 'out' && !m.ok ? ' · não enviada' : ''}</div></div>)}
          </div>
          {!c.blocked && <form onSubmit={send} style={{ display: 'flex', gap: 8, marginTop: 10 }}><Input id="wa-text" value={text} onChange={e => setText(e.target.value)} placeholder={d.window_open ? 'Escreva como a criadora (assume a conversa)' : 'Passou de 24 h: só modelo aprovado'} disabled={!d.window_open} maxLength={2000}/><Button type="submit" disabled={busy || !d.window_open}><Send size={15}/>Enviar</Button></form>}
          {d.orders.length > 0 && <div style={{ marginTop: 16 }}><SectionHeading title="Pedidos deste contato"/><OrdersTable rows={d.orders} onChange={() => loadOne(open)}/></div>}
        </>}
      </section>
    </div>
    <OfferModal offer={offer} setOffer={setOffer} d={d} onDone={() => { setOffer(null); loadOne(open); }}/>
  </>;
}

function OfferModal({ offer, setOffer, d, onDone }) {
  const [slots, setSlots] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const item = d?.items?.find(i => i.id === offer?.item_id);
  useEffect(() => { setError(''); if (!item || item.kind !== 'call') { setSlots([]); return; } api.get(`/wa/slots/${d.contact.creator_id}`, { params: { item_id: item.id } }).then(r => setSlots(r.data)).catch(() => setSlots([])); }, [item, d]);
  async function submit(e) { e.preventDefault(); setBusy(true); setError(''); try { await api.post(`/wa/contacts/${d.contact.id}/offer`, offer); toast.success('Pix enviado para o contato.'); onDone(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); } }
  const set = (k, v) => setOffer(o => ({ ...o, [k]: v }));
  return <Modal title="Vender" description="Manda as instruções de Pix e segura o pedido. Só aparece o que a criadora vende neste WhatsApp." open={!!offer} onClose={() => setOffer(null)} id="wa-offer">{offer && d && <form className="form-stack" onSubmit={submit}>
    <Field id="wa-o-item" label="Item"><Select id="wa-o-item" value={offer.item_id} onChange={e => setOffer({ item_id: e.target.value })}>{d.items.map(i => <option key={i.id} value={i.id}>{KIND[i.kind]} · {i.name} · {money(i.cents)}</option>)}</Select></Field>
    {item?.kind === 'call' && <Field id="wa-o-slot" label="Horário"><Select id="wa-o-slot" value={offer.slot_ts || ''} onChange={e => set('slot_ts', +e.target.value)}><option value="">Escolha</option>{slots.map(s => <option key={s.ts} value={s.ts}>{s.label}</option>)}</Select></Field>}
    {item?.kind === 'custom' && <><Field id="wa-o-para" label="Para quem" value={offer.custom?.para || ''} onChange={e => set('custom', { ...offer.custom, para: e.target.value })}/><Field id="wa-o-oc" label="Ocasião" value={offer.custom?.ocasiao || ''} onChange={e => set('custom', { ...offer.custom, ocasiao: e.target.value })}/><Field id="wa-o-rec" label="Recado" value={offer.custom?.recado || ''} onChange={e => set('custom', { ...offer.custom, recado: e.target.value })}/></>}
    <FormError error={error}/><div className="form-actions"><Button type="button" variant="outline" onClick={() => setOffer(null)}>Cancelar</Button><Submit id="wa-o-send" busy={busy}>Mandar Pix</Submit></div></form>}</Modal>;
}

function OrdersTable({ rows, onChange }) {
  const [busy, setBusy] = useState('');
  async function post(o, path, body, ok) { setBusy(o.id); try { await api.post(`/wa/orders/${o.id}/${path}`, body || {}); toast.success(ok); onChange(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(''); } }
  async function deliver(o, file) { if (!file) return; const fd = new FormData(); fd.append('file', file); setBusy(o.id); try { await api.post(`/wa/orders/${o.id}/deliver`, fd); toast.success('Entregue no WhatsApp.'); onChange(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(''); } }
  return <div className="table-scroll"><table><thead><tr><th>Pedido</th><th>Criadora</th><th>Contato</th><th>Valor</th><th>Situação</th><th/></tr></thead><tbody>
    {rows.map(o => <tr key={o.id}><td><strong>{o.item}</strong><div className="body-muted" style={{ fontSize: 12 }}>{KIND[o.kind]}{o.slot_start ? ` · ${slotText(o)}` : ''}{o.custom?.para ? ` · para ${o.custom.para}: "${o.custom.recado}"` : ''}</div></td>
      <td>{o.creator_name || ''}</td><td>{o.contact_name || '—'}</td><td>{money(o.cents)}</td>
      <td><Badge tone={OSTATUS[o.status]?.[0]}>{OSTATUS[o.status]?.[1] || o.status}</Badge>{o.kind === 'call' && o.status === 'pago' && <div className="body-muted" style={{ fontSize: 12 }}>{o.call_status}</div>}{o.delivered_at && <div className="body-muted" style={{ fontSize: 12 }}>entregue {dateTime(o.delivered_at)}</div>}</td>
      <td><div className="row-actions" style={{ flexWrap: 'wrap' }}>
        {o.status === 'aguardando_pix' && <Button disabled={busy === o.id} onClick={() => post(o, 'paid', null, 'Marcado como pago.')}>Pix caiu</Button>}
        {o.status === 'aguardando_pix' && <Button variant="outline" disabled={busy === o.id} onClick={() => post(o, 'status', { status: 'cancelado' }, 'Cancelado.')}>Cancelar</Button>}
        {o.status === 'pago' && o.kind === 'call' && o.call_status === 'agendada' && <><Button variant="outline" onClick={() => navigator.clipboard?.writeText(o.room || '').then(() => toast.success('Link da criadora copiado.'))}>Copiar link da criadora</Button><Button variant="outline" disabled={busy === o.id} onClick={() => post(o, 'status', { status: 'feita' }, 'Chamada feita.')}>Feita</Button><Button variant="outline" disabled={busy === o.id} onClick={() => post(o, 'status', { status: 'faltou_criadora' }, 'Marcado.')}>Criadora faltou</Button></>}
        {o.status === 'pago' && o.kind !== 'call' && !o.delivered_at && <label className="photo-btn" style={{ cursor: 'pointer' }}><Upload size={14}/>{busy === o.id ? 'Enviando…' : 'Entregar arquivo'}<input type="file" hidden accept="image/jpeg,image/png,video/mp4" onChange={e => { deliver(o, e.target.files?.[0]); e.target.value = ''; }}/></label>}
        {o.status === 'pago' && <Button variant="outline" disabled={busy === o.id} onClick={() => post(o, 'status', { status: 'devolvido' }, 'Marcado como devolvido. Faça o estorno no banco.')}>Devolvido</Button>}
      </div></td></tr>)}
  </tbody></table></div>;
}

function Pedidos({ creators }) {
  const [cid, setCid] = useState(''), [status, setStatus] = useState('abertos'), [rows, setRows] = useState(null);
  const load = useCallback(async () => { try { const r = await api.get('/wa/orders', { params: { creator_id: cid, status } }); setRows(r.data); } catch (e) { toast.error(errorText(e)); } }, [cid, status]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  return <section className="data-section">
    <SectionHeading title="Pedidos e chamadas" caption="Chamada paga recebe lembrete 30 min antes e o link 5 min antes, sozinha. Copie o link da criadora e mande para ela."><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Select id="wa-p-creator" value={cid} onChange={e => setCid(e.target.value)}><option value="">Todas as criadoras</option>{creators.map(x => <option key={x.creator_id} value={x.creator_id}>{x.name}</option>)}</Select>
      <Select id="wa-p-status" value={status} onChange={e => setStatus(e.target.value)}><option value="abertos">Em aberto</option><option value="pago">Pagos</option><option value="todos">Todos</option></Select></div></SectionHeading>
    {rows && (rows.length ? <OrdersTable rows={rows} onChange={load}/> : <Empty id="wa-p-empty" icon={CalendarClock} title="Nada em aberto" description="Pix para conferir, chamadas marcadas e entregas aparecem aqui."/>)}
  </section>;
}

function ConfigModal({ creator, onClose }) {
  const [d, setD] = useState(null), [cfg, setCfg] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (!creator) return; setError(''); api.get(`/wa/config/${creator.creator_id}`).then(r => { setD(r.data); setCfg(r.data.cfg); }).catch(e => toast.error(errorText(e))); }, [creator]);
  if (!creator || !cfg) return null;
  const set = (k, v) => setCfg(c => ({ ...c, [k]: v })); const sub = (k, f, v) => setCfg(c => ({ ...c, [k]: { ...c[k], [f]: v } }));
  const setItem = (i, f, v) => setCfg(c => ({ ...c, items: c.items.map((x, j) => j === i ? { ...x, [f]: v } : x) }));
  const week = cfg.agenda.week || {}; const setDay = (k, v) => sub('agenda', 'week', { ...week, [k]: v });
  async function save(e) { e.preventDefault(); setBusy(true); setError(''); try { const { creator_id, updated_at, updated_by, ...body } = cfg; await api.post(`/wa/config/${creator.creator_id}`, body); toast.success('WhatsApp salvo.'); onClose(true); } catch (err) { setError(errorText(err)); } finally { setBusy(false); } }
  return <Modal title={`WhatsApp · ${creator.name}`} description="Só o que estiver ligado é oferecido. Nada de conteúdo adulto neste canal." open onClose={() => onClose(false)} id="wa-cfg" wide><form className="form-stack" onSubmit={save}>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Sw on={cfg.enabled} label="Atendimento ligado" id="wa-cfg-on" onClick={() => set('enabled', !cfg.enabled)}/><b>{cfg.enabled ? 'Atendimento ligado' : 'Atendimento desligado'}</b></div>
    <div className="form-grid"><Field id="wa-cfg-phone" label="Número divulgado" value={cfg.display_phone} onChange={e => set('display_phone', e.target.value)} placeholder="+55 11 9…"/><Field id="wa-cfg-pid" label="ID do número na Meta (phone_number_id)" value={cfg.phone_number_id} onChange={e => set('phone_number_id', e.target.value.replace(/\D/g, ''))}/></div>
    <SectionHeading title="O que vende aqui" caption="A IA só oferece o que estiver ligado."/>
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>{Object.entries(KIND).map(([k, l]) => <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Sw on={cfg.sells[k]} label={l} id={`wa-sell-${k}`} onClick={() => sub('sells', k, !cfg.sells[k])}/>{l}</label>)}</div>
    <div className="table-scroll"><table><thead><tr><th>Tipo</th><th>Nome</th><th>Valor (R$)</th><th>Min.</th><th>Entrega (dias)</th><th>Como a IA apresenta</th><th>Ligado</th><th/></tr></thead><tbody>
      {cfg.items.map((it, i) => <tr key={it.id || i} style={{ opacity: cfg.sells[it.kind] ? 1 : .5 }}>
        <td><Select id={`wa-it-k-${i}`} value={it.kind} onChange={e => setItem(i, 'kind', e.target.value)}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></td>
        <td><Input value={it.name} maxLength={40} onChange={e => setItem(i, 'name', e.target.value)} aria-label="Nome"/></td>
        <td><Input style={{ width: 100 }} defaultValue={reais(it.cents)} onBlur={e => setItem(i, 'cents', cents(e.target.value))} aria-label="Valor"/></td>
        <td><Input style={{ width: 70 }} type="number" min={0} max={180} value={it.minutes || 0} onChange={e => setItem(i, 'minutes', +e.target.value)} aria-label="Minutos" disabled={it.kind !== 'call'}/></td>
        <td><Input style={{ width: 70 }} type="number" min={0} max={30} value={it.days || 0} onChange={e => setItem(i, 'days', +e.target.value)} aria-label="Dias" disabled={it.kind === 'call'}/></td>
        <td><Input value={it.pitch || ''} maxLength={200} onChange={e => setItem(i, 'pitch', e.target.value)} aria-label="Como apresentar"/></td>
        <td><Sw on={it.on} label="Ligado" onClick={() => setItem(i, 'on', !it.on)}/></td>
        <td><button type="button" className="icon-btn" aria-label="Remover" onClick={() => set('items', cfg.items.filter((_, j) => j !== i))}><Trash2 size={15}/></button></td></tr>)}
    </tbody></table></div>
    <div><Button type="button" variant="outline" onClick={() => set('items', [...cfg.items, { id: '', kind: Object.keys(KIND).find(k => cfg.sells[k]) || 'call', name: '', cents: 0, minutes: 10, days: 3, pitch: '', on: true }])}><Plus size={15}/>Adicionar item</Button></div>
    <SectionHeading title="Agenda da chamada ao vivo" caption="Horários em que a IA pode marcar. Vazio = folga."/>
    <div className="form-grid">{DAYS.map((n, k) => { const r = (week[String(k)] || [])[0]; return <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Sw on={!!r} label={n} onClick={() => setDay(String(k), r ? [] : [['19:00', '22:00']])}/><span style={{ width: 34 }}>{n}</span>
      {r ? <><Input type="time" style={{ width: 110 }} value={r[0]} onChange={e => setDay(String(k), [[e.target.value, r[1]]])} aria-label={`${n} início`}/><span>às</span><Input type="time" style={{ width: 110 }} value={r[1]} onChange={e => setDay(String(k), [[r[0], e.target.value]])} aria-label={`${n} fim`}/></> : <span className="body-muted">folga</span>}</label>; })}</div>
    <div className="form-grid"><Field id="wa-gap" label="Intervalo entre chamadas (min)" type="number" min={0} max={120} value={cfg.agenda.gap_min} onChange={e => sub('agenda', 'gap_min', +e.target.value)}/><Field id="wa-lead" label="Marcar com antecedência de (h)" type="number" min={0} max={72} value={cfg.agenda.lead_h} onChange={e => sub('agenda', 'lead_h', +e.target.value)}/><Field id="wa-max" label="Máximo de chamadas por dia" type="number" min={1} max={50} value={cfg.agenda.max_day} onChange={e => sub('agenda', 'max_day', +e.target.value)}/></div>
    <Field id="wa-blocked" label="Dias bloqueados (AAAA-MM-DD, separados por vírgula)" value={(cfg.agenda.blocked || []).join(', ')} onChange={e => sub('agenda', 'blocked', e.target.value.split(',').map(x => x.trim()).filter(Boolean))}/>
    <SectionHeading title="Pagamento"/>
    <div className="form-grid"><Field id="wa-prov" label="Meio de pagamento"><Select id="wa-prov" value={cfg.pay.provider} onChange={e => sub('pay', 'provider', e.target.value)}><option value="manual">Manual (chatter confere o Pix)</option><option value="asaas">Asaas (em breve)</option><option value="mercadopago">Mercado Pago (em breve)</option></Select></Field>
      <Field id="wa-pct" label="Parte da criadora (%)" type="number" min={0} max={100} value={cfg.pay.creator_pct} onChange={e => sub('pay', 'creator_pct', +e.target.value)}/><Field id="wa-hold" label="Segurar horário esperando Pix (min)" type="number" min={5} max={120} value={cfg.pay.hold_min} onChange={e => sub('pay', 'hold_min', +e.target.value)}/></div>
    <Field id="wa-pix" label="Texto do Pix que a IA manda (chave da agência)"><textarea id="wa-pix" className="assist-textarea" rows={2} maxLength={600} value={cfg.pay.pix_text} onChange={e => sub('pay', 'pix_text', e.target.value)}/></Field>
    <SectionHeading title="Conversa e chamada"/>
    <Field id="wa-welcome" label="Primeira mensagem (sempre pergunta se tem mais de 18)"><textarea id="wa-welcome" className="assist-textarea" rows={2} maxLength={600} value={cfg.welcome} onChange={e => set('welcome', e.target.value)}/></Field>
    <div className="form-grid"><Field id="wa-room" label="Link fixo da sala (vazio = um link novo por chamada)" value={cfg.room_link} onChange={e => set('room_link', e.target.value)} placeholder="https://…"/><Field id="wa-tpl" label="Modelo aprovado na Meta para lembrete (fora de 24 h)" value={cfg.templates.reminder} onChange={e => sub('templates', 'reminder', e.target.value)}/></div>
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Sw on={cfg.reminders} label="Lembretes" onClick={() => set('reminders', !cfg.reminders)}/>Lembrete 30 min antes e link 5 min antes</label><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Sw on={cfg.after_call} label="Depois da chamada" onClick={() => set('after_call', !cfg.after_call)}/>Agradecer depois da chamada</label></div>
    <Notice id="wa-fixed" tone="neutral">Sempre valem: confirma 18+ antes de tudo (sinal de menor bloqueia); pedido sexual, encontro, contato pessoal, pagamento por fora ou "é você mesma? é robô?" param a IA e avisam {d?.chatters?.length ? d.chatters.join(', ') : 'o gestor (nenhum chatter atribuído)'}.</Notice>
    <FormError error={error}/><div className="form-actions"><Button type="button" variant="outline" onClick={() => onClose(false)}>Cancelar</Button><Submit id="wa-cfg-save" busy={busy}>Salvar</Submit></div>
  </form></Modal>;
}

function Criadoras({ data, reload }) {
  const [edit, setEdit] = useState(null);
  return <section className="data-section">
    {!data.ready && <Notice id="wa-not-ready" tone="amber">O WhatsApp ainda não foi ligado no servidor (WA_TOKEN, WA_APP_SECRET e WA_VERIFY_TOKEN). Dá para configurar as criadoras, mas nada é enviado até lá.</Notice>}
    <div className="table-scroll"><table><thead><tr><th>Criadora</th><th>Atendimento</th><th>Número</th><th>Vende</th><th>Precisa de humano</th><th>7 dias</th><th/></tr></thead><tbody>
      {data.creators.map(c => <tr key={c.creator_id}><td><strong>{c.name}</strong></td><td>{c.enabled ? <Badge tone="green">ligado</Badge> : <Badge tone="neutral">desligado</Badge>}</td><td>{c.display_phone || <span className="body-muted">—</span>}{c.display_phone && !c.connected && <div className="body-muted" style={{ fontSize: 12 }}>falta o ID da Meta</div>}</td>
        <td>{c.sells.length ? c.sells.map(k => KIND[k]).join(', ') : <span className="body-muted">nada</span>}</td><td>{c.open_human || <span className="body-muted">0</span>}</td><td>{money(c.week_cents)}</td>
        <td><Button variant="outline" data-testid={`wa-edit-${c.creator_id}`} onClick={() => setEdit(c)}><Settings2 size={15}/>Configurar</Button></td></tr>)}
    </tbody></table></div>
    {edit && <ConfigModal creator={edit} onClose={(saved) => { setEdit(null); if (saved) reload(); }}/>}
  </section>;
}

function Relatorio({ creators }) {
  const [days, setDays] = useState(7), [cid, setCid] = useState(''), [d, setD] = useState(null);
  useEffect(() => { api.get('/wa/report', { params: { days, creator_id: cid } }).then(r => setD(r.data)).catch(e => toast.error(errorText(e))); }, [days, cid]);
  if (!d) return null; const f = d.funnel;
  return <>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>{[1, 7, 30].map(n => <Button key={n} variant={days === n ? 'default' : 'outline'} onClick={() => setDays(n)}>{n === 1 ? 'Hoje' : `${n} dias`}</Button>)}
      <Select id="wa-r-creator" value={cid} onChange={e => setCid(e.target.value)}><option value="">Todas as criadoras</option>{creators.map(x => <option key={x.creator_id} value={x.creator_id}>{x.name}</option>)}</Select></div>
    <div className="stats-grid"><Stat id="wa-k-c" label="Conversaram" value={f.contacts} caption={`${f.age_ok} confirmaram 18+ · ${d.blocked_minor} menores bloqueados`} icon={Users}/><Stat id="wa-k-ch" label="Escolheram algo" value={f.chose} caption="pediram Pix" icon={MessageSquare}/>
      <Stat id="wa-k-p" label="Pagaram" value={f.paid} caption={`${f.calls_done} chamadas feitas`} icon={Banknote} tone="green"/><Stat id="wa-k-v" label="Faturado" value={money(d.cents)} caption={`parte das criadoras: ${money(d.creator_cents)}`} icon={FileChartColumn}/></div>
    <section className="data-section"><SectionHeading title="De onde vieram" caption={`Instagram ${d.sources.instagram} · TikTok ${d.sources.tiktok} (pela primeira mensagem)`}/>
      <div className="table-scroll"><table><thead><tr><th>Criadora</th><th>Conversas</th><th>Pedidos pagos</th><th>Conversão</th><th>Faturado</th><th>Chamadas feitas</th><th>Faltas da criadora</th></tr></thead><tbody>
        {d.per_creator.map(p => <tr key={p.creator_id}><td><strong>{p.name}</strong></td><td>{p.contacts}</td><td>{p.paid}</td><td>{p.contacts ? `${Math.round(100 * p.paid / p.contacts)}%` : '—'}</td><td>{money(p.cents)}</td><td>{p.calls_done}</td><td>{p.no_show}</td></tr>)}
      </tbody></table></div>
      <p className="body-muted" style={{ fontSize: 12 }}>Por tipo: {Object.entries(d.by_kind).map(([k, v]) => `${d.kinds[k]} ${v.count} (${money(v.cents)})`).join(' · ') || '—'}</p></section>
  </>;
}

export default function WhatsApp() {
  const { user } = useApp(); const mgr = user.role === 'manager';
  const [tab, setTab] = useState('conversas'), [data, setData] = useState(null), [k, setK] = useState(0);
  const load = useCallback(() => api.get('/wa/creators').then(r => setData(r.data)).catch(e => toast.error(errorText(e))), []);
  useEffect(() => { load(); }, [load, k]);
  const T = (key, Icon, label) => <button className={tab === key ? 'selected' : ''} data-testid={`wa-tab-${key}`} onClick={() => setTab(key)}><Icon size={16}/>{label}</button>;
  const creators = data?.creators || [];
  return <><PageHeading eyebrow="CANAL DE VENDAS" title="WhatsApp" description="Número da criadora divulgado no Instagram e no TikTok. A IA confirma 18+, vende o que estiver ligado e chama você quando trava. Nada de conteúdo adulto."><Button variant="outline" onClick={() => setK(x => x + 1)}><RefreshCw size={15}/>Atualizar</Button></PageHeading>
    <div className="page-tabs">{T('conversas', MessageSquare, 'Conversas')}{T('pedidos', CalendarClock, 'Pedidos e chamadas')}{mgr && T('criadoras', Settings2, 'Criadoras')}{mgr && T('relatorio', FileChartColumn, 'Relatório')}</div>
    {data && <div key={`${tab}-${k}`}>{tab === 'conversas' ? <Conversas creators={creators}/> : tab === 'pedidos' ? <Pedidos creators={creators}/> : tab === 'criadoras' ? <Criadoras data={data} reload={load}/> : <Relatorio creators={creators}/>}</div>}
  </>;
}
