import React, { useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw, Sparkles, Pencil, XCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, dateTime } from '../lib/api';
import { PageHeading, Stat, Button, Empty, Notice, Select } from '../components/Common';

// Sombra: medidor da Alta Ajuda. Para as criadoras com "Modo sombra" ligado na ficha, cada sugestão fica guardada ao
// lado do que o chatter enviou de verdade. Nada aqui envia mensagem: é só leitura para melhorar as fichas e as regras.
const pct = (v) => v == null ? '—' : `${v}%`;
const int = (v) => v == null ? '—' : Number(v).toLocaleString('pt-BR');
const money = (c) => c == null ? '' : 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const STATUS = {
  igual: ['Igual', 'ok'], editado: ['Editado', 'warn'], diferente: ['Diferente', 'bad'], midia: ['Mandou mídia', 'info'],
  sem_resposta: ['Sem resposta', 'muted'], pendente: ['Aguardando', 'muted'],
};
function Tag({ st }) { const [l, cls] = STATUS[st] || [st, 'muted']; return <span className={`shadow-tag ${cls}`}>{l}</span>; }
function Table({ rows, first }) {
  return <div className="table-scroll"><table><thead><tr><th>{first}</th><th>Sugestões</th><th>Iguais</th><th>Editadas</th><th>Diferentes</th><th>Mídia</th><th>Sem resposta</th><th>Aproveitamento</th><th>Semelhança</th></tr></thead>
    <tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.name || '—'}</strong></td><td className="tabular">{int(r.n)}</td><td className="tabular">{int(r.igual)}</td><td className="tabular">{int(r.editado)}</td><td className="tabular">{int(r.diferente)}</td><td className="tabular">{int(r.midia)}</td><td className="tabular">{int(r.sem_resposta)}</td><td className="tabular">{pct(r.aproveitamento)}</td><td className="tabular">{pct(r.similaridade)}</td></tr>)}</tbody></table></div>;
}

// lote 100: ensinar a IA pelo exemplo. 👍 IA = a sugestão estava boa; 👍 enviado = o chatter fez melhor; ✏️ = escrever como deveria ser.
// Vira exemplo aprovado da criadora (a IA imita o jeito nas próximas sugestões, sem copiar).
const REASONS = [['', 'motivo (opcional)'], ['tom', 'tom errado'], ['contexto', 'fora de contexto'], ['repetiu', 'repetiu'], ['vender', 'devia vender'], ['inventou', 'inventou coisa'], ['outro', 'outro']];
function Teach({ r }) {
  const [open, setOpen] = useState(false), [txt, setTxt] = useState(r.example && r.example.kind === 'corrigido' ? r.example.good : ''), [why, setWhy] = useState(''), [done, setDone] = useState(''), [busy, setBusy] = useState(false);
  const send = async (better, label) => {
    setBusy(true);
    try { await api.post('/assist/examples', { creator_id: r.creator_id, fan_text: r.last_fan || '', ai_text: r.proposed || '', better_text: better, reason: why, source: 'sombra', ref_id: r.id }); setDone(label); setOpen(false); toast.success('Exemplo salvo: a IA vai seguir esse jeito.'); }
    catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  const ex = r.example;
  const saved = done ? <small className="shadow-tag info">✓ {done}</small>
    : ex ? <div style={{ fontSize: 12 }}><small className="shadow-tag info">✓ {ex.kind === 'corrigido' ? '✏️ corrigido' : '👍 aprovado'}{ex.by_name ? ` por ${ex.by_name}` : ''}</small>
        {ex.kind === 'corrigido' && <div className="shadow-txt" style={{ marginTop: 4 }}>{ex.good}</div>}
        {ex.reason && <small className="body-muted">motivo: {ex.reason}</small>}</div> : null;
  if (done) return saved;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 150 }}>
    {saved}
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      <Button variant="outline" disabled={busy || !r.proposed} title="A sugestão da IA estava boa" onClick={() => send('', '👍 IA')}>👍 IA</Button>
      {r.sent && <Button variant="outline" disabled={busy} title="O que o chatter mandou ficou melhor" onClick={() => send(r.sent, '👍 enviado')}>👍 enviado</Button>}
      <Button variant="outline" disabled={busy} title="Escrever como deveria ser" onClick={() => setOpen(!open)}>✏️</Button>
    </div>
    {open && <>
      <textarea className="assist-textarea" rows={3} maxLength={1200} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Como ela responderia"/>
      <Select value={why} onChange={(e) => setWhy(e.target.value)}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      <Button disabled={busy || !txt.trim()} onClick={() => send(txt.trim(), '✏️ corrigido')}>Salvar</Button>
    </>}
  </div>;
}

export default function Shadow() {
  const [days, setDays] = useState(7), [creator, setCreator] = useState(''), [only, setOnly] = useState(''), [d, setD] = useState(null), [busy, setBusy] = useState(false);
  const [start, setStart] = useState(''), [end, setEnd] = useState('');  // período De/Até (vale no lugar dos atalhos de dias)
  const load = async () => { setBusy(true); try { setD((await api.get(`/assist/shadow?days=${days}&creator_id=${encodeURIComponent(creator)}&start=${start}&end=${end}`)).data); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } };
  useEffect(() => { load(); }, [days, creator, start, end]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = d && d.total;
  const rows = d ? d.rows.filter((r) => !only || r.status === only) : [];
  const enabledNames = d ? d.creators.filter((c) => d.enabled.includes(c.id)).map((c) => c.name) : [];
  return <>
    <PageHeading eyebrow="ALTA AJUDA" title="Sombra" description="O que a IA sugeriu ao lado do que o chatter enviou de verdade. Serve para ver onde a Alta Ajuda acerta, onde o chatter corrige e o que vale ajustar na ficha. Nada aqui envia mensagem.">
      <Select id="shadow-creator" value={creator} onChange={(e) => setCreator(e.target.value)}><option value="">Todas as criadoras</option>{(d ? d.creators : []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      {[7, 30, 90].map((n) => <Button key={n} variant={days === n && !start && !end ? undefined : 'outline'} onClick={() => { setStart(''); setEnd(''); setDays(n); }}>{n} dias</Button>)}
      <label className="body-muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>De <input type="date" value={start} onChange={(e) => setStart(e.target.value)}/></label>
      <label className="body-muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>Até <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}/></label>
      <Button variant="ghost" disabled={busy} onClick={load}><RefreshCw size={15}/>Atualizar</Button>
    </PageHeading>
    {!d ? <p className="body-muted">Carregando…</p> : <>
      {!d.enabled.length && <Notice tone="danger" id="shadow-off">Nenhuma criadora está com o Modo sombra ligado. Ligue na ficha da criadora (aba Alta Ajuda) para começar a registrar.</Notice>}
      {!!d.enabled.length && <Notice id="shadow-on">Em sombra: {enabledNames.join(', ')}. Os registros duram 120 dias.</Notice>}
      {!t.n ? <Empty title="Nenhuma sugestão registrada no período" description="Com o Modo sombra ligado, cada sugestão da Alta Ajuda aparece aqui junto com o que o chatter enviou." icon={ShieldCheck}/> : <>
        <div className="stats-grid">
          <Stat id="sh-n" label={`Sugestões em ${d.days} dias`} value={int(t.n)} caption={`${int(t.sem_resposta)} sem resposta · ${int(t.pendente)} aguardando`} icon={Sparkles}/>
          <Stat id="sh-ok" label="Aproveitamento" value={pct(t.aproveitamento)} caption={`${int(t.igual)} enviadas iguais · ${int(t.editado)} editadas`} icon={ShieldCheck} tone="green"/>
          <Stat id="sh-ed" label="Editadas" value={int(t.editado)} caption="O chatter partiu da sugestão e mudou o texto" icon={Pencil}/>
          <Stat id="sh-no" label="Diferentes" value={int(t.diferente)} caption="O chatter escreveu outra coisa: os casos mais úteis para ler" icon={XCircle} tone="red"/>
          <Stat id="sh-media" label="Mídias enviadas" value={int(t.media.n)} caption={`${int(t.media.pagas)} pagas (${money(t.media.valor_cents)}) · ${int(t.media.gratis)} grátis · ${int(t.media.abaixo_sugerido)} abaixo do preço sugerido`} icon={Clock}/>
        </div>
        <section className="panel ai-panel"><h2>Por criadora</h2><p className="body-muted">Aproveitamento baixo numa criadora costuma ser ficha incompleta (voz, exemplos de mensagens, roteiro). Semelhança é o quanto o texto enviado parece com o sugerido.</p><Table rows={d.by_creator} first="Criadora"/></section>
        <section className="panel ai-panel"><h2>Por chatter</h2><Table rows={d.by_user} first="Chatter"/></section>
        <section className="panel ai-panel">
          <h2>Sugestão × enviado</h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {[['', 'Tudo'], ['diferente', 'Diferentes'], ['editado', 'Editadas'], ['igual', 'Iguais'], ['midia', 'Mídia'], ['sem_resposta', 'Sem resposta']].map(([k, l]) => <Button key={k} variant={only === k ? undefined : 'outline'} onClick={() => setOnly(k)}>{l}</Button>)}
          </div>
          {!rows.length ? <p className="body-muted">Nada com esse filtro.</p> : <div className="table-scroll"><table className="shadow-table"><thead><tr><th>Quando</th><th>Criadora · chatter</th><th>Última do fã</th><th>Sugestão da IA</th><th>Enviado</th><th>Resultado</th><th>Ensinar a IA</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id} className={`st-${r.status}`}>
              <td className="tabular" style={{ whiteSpace: 'nowrap' }}>{dateTime(r.at)}</td>
              <td><strong>{r.creator_name}</strong><br/><small className="body-muted">{r.user_name}{r.product ? ` · sugeriu ${r.product}${r.product_cents ? ' ' + money(r.product_cents) : ''}` : ''}</small></td>
              <td className="shadow-txt muted">{r.last_fan || '—'}</td>
              <td className="shadow-txt">{r.proposed}</td>
              <td className="shadow-txt">{r.sent || <span className="body-muted">—</span>}{r.media_kind && <><br/><small className={r.product_cents && r.media_cents != null && r.media_cents < r.product_cents ? 'shadow-tag bad' : 'shadow-tag info'}>{r.media_kind} {r.media_free ? 'grátis' : r.media_cents != null ? money(r.media_cents) : 'paga'}{r.product_cents && r.media_cents != null && r.media_cents < r.product_cents ? ' · abaixo do sugerido' : ''}</small></>}</td>
              <td><Tag st={r.status}/>{r.similarity != null && r.status !== 'midia' && <><br/><small className="tabular">{Math.round(r.similarity * 100)}%</small></>}</td>
              <td><Teach r={r}/></td>
            </tr>)}</tbody></table></div>}
        </section>
      </>}
      <Notice id="shadow-note"><Clock size={13}/> "Sem resposta" = a criadora não mandou nada nas 2 horas seguintes à sugestão, ou o chatter trocou de conversa. Igual = 90% ou mais de semelhança; editado = entre 40% e 90%.</Notice>
    </>}
  </>;
}
