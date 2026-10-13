import React, { useEffect, useMemo, useState } from 'react';
import { Megaphone, Send, Image as ImageIcon, UserX, RefreshCw, Download, Info } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, money, dateTime, download } from '../lib/api';
import { PageHeading, Stat, Button, Empty, Notice, Select, Badge } from '../components/Common';

// Conteúdo e disparos: quem fez cada mensagem em massa e cada post, e quanto vendeu. Visível só para quem o
// dono da conta liberou (Equipe → Permissões especiais). "Só os próprios números" vê apenas o que é dele.
export const canContent = (u) => !!(u && (u.owner || (u.perms || []).some(p => p === 'conteudo_relatorio' || p === 'conteudo_proprio')));
const KIND = { mass: 'Mensagem em massa', post: 'Postagem' };
const MEDIA = { photo: '📷 Foto', video: '🎬 Vídeo', mixed: '📷🎬 Foto e vídeo' };
const ATTR = { auto: ['Confirmado', 'green'], probable: ['Provável', 'amber'], manual: ['Manual', 'gold'], none: ['Sem atribuição', 'neutral'] };
const QUAL = { forte: 'Valor único: atribuição quase exata', estimado: 'Valor redondo ou da tabela: pode misturar com vendas do chat no mesmo valor', exato: 'Número da própria Privacy (Engajamento)', 'sem leitura': 'Ainda sem leitura do Engajamento', 'sem valor': 'Disparo sem preço (não vende direto)' };
const day = (d) => d.toISOString().slice(0, 10);
const brToday = () => new Date(Date.now() - 3 * 3600e3);
const plus = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return day(d); };
const RANGES = [['Hoje', 0], ['7 dias', 6], ['30 dias', 29]];

export default function Content({ user }) {
  const today = day(brToday());
  const [from, setFrom] = useState(plus(today, -6)), [to, setTo] = useState(today);
  const [f, setF] = useState({ creator_id: '', kind: '', author: '', attribution: '' });
  const [meta, setMeta] = useState(null), [sum, setSum] = useState(null), [items, setItems] = useState([]), [busy, setBusy] = useState(false), [goals, setGoals] = useState(null), [alerts, setAlerts] = useState([]);
  const qs = useMemo(() => new URLSearchParams({ start: from, end: plus(to, 1), ...f }).toString(), [from, to, f]);
  const load = async () => {
    setBusy(true);
    try { const [s, i, g, a] = await Promise.all([api.get(`/content/summary?${qs}`), api.get(`/content/items?${qs}`), api.get(`/content/goals?${qs}`), api.get('/content/alerts?days=7')]); setSum(s.data); setItems(i.data.items); setGoals(g.data); setAlerts(a.data.alerts || []); }
    catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  useEffect(() => { api.get('/content/meta').then(r => setMeta(r.data)).catch(e => toast.error(errorText(e))); }, []);
  useEffect(() => { load(); }, [qs]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = (meta && meta.perms) || {};
  const assign = async (it, author_id) => {
    try { const r = await api.patch(`/content/items/${it.id}/author`, { author_id: author_id || null }); setItems(xs => xs.map(x => x.id === it.id ? { ...x, ...r.data } : x)); toast.success('Atribuição salva.'); load(); }
    catch (e) { toast.error(errorText(e)); }
  };
  const t = sum && sum.totals;
  const setRange = (n) => { setTo(today); setFrom(plus(today, -n)); };
  const month = () => { setFrom(today.slice(0, 8) + '01'); setTo(today); };
  return <>
    <PageHeading eyebrow={p.conteudo_relatorio ? 'SÓ PARA QUEM O DONO LIBEROU' : 'SEUS NÚMEROS'} title="Conteúdo e disparos" description="Quem disparou cada mensagem em massa e quem postou cada publicação, e quanto cada um vendeu no período.">
      <Button variant="ghost" disabled={busy} onClick={load}><RefreshCw size={15}/>Atualizar</Button>
      <Button variant="outline" onClick={() => download(`/content/export.csv?${qs}`, `conteudo-e-disparos-${from}-a-${to}.csv`).catch(e => toast.error(errorText(e)))}><Download size={15}/>Planilha</Button>
    </PageHeading>
    <section className="panel ai-panel ct-filters">
      <div className="ct-row">
        {RANGES.map(([l, n]) => <Button key={l} variant="outline" onClick={() => setRange(n)}>{l}</Button>)}<Button variant="outline" onClick={month}>Este mês</Button>
        <label>De <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}/></label>
        <label>Até <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}/></label>
      </div>
      <div className="ct-row">
        <Select id="ct-creator" value={f.creator_id} onChange={e => setF({ ...f, creator_id: e.target.value })}><option value="">Todas as criadoras</option>{(meta?.creators || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select id="ct-kind" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="">Disparos e posts</option><option value="mass">Só mensagens em massa</option><option value="post">Só postagens</option></Select>
        {p.conteudo_relatorio && <Select id="ct-author" value={f.author} onChange={e => setF({ ...f, author: e.target.value })}><option value="">Todas as pessoas</option><option value="none">Sem atribuição</option>{(meta?.people || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
        <Select id="ct-attr" value={f.attribution} onChange={e => setF({ ...f, attribution: e.target.value })}><option value="">Qualquer atribuição</option>{Object.entries(ATTR).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
      </div>
    </section>
    {!t ? <p className="body-muted">Carregando…</p> : !t.items ? <Empty icon={Megaphone} title="Nada no período" description="Os disparos e posts aparecem aqui quando alguém envia pelo app, e também pela leitura do calendário e do Engajamento da Privacy (a cada 3 h)."/> : <>
      <div className="stats-grid">
        <Stat id="ct-rev" label="Vendido" value={money(t.revenue_cents)} caption={`${t.purchases} compras no período`} icon={Megaphone} tone="green"/>
        <Stat id="ct-mass" label="Mensagens em massa" value={t.mass} caption="disparos no período" icon={Send}/>
        <Stat id="ct-post" label="Postagens" value={t.post} caption="publicações no período" icon={ImageIcon}/>
        <Stat id="ct-none" label="Sem atribuição" value={t.unattributed} caption={`Confirmados ${t.by_attr.auto} · prováveis ${t.by_attr.probable} · manuais ${t.by_attr.manual}`} icon={UserX}/>
      </div>
      {t.unattributed > 0 && p.conteudo_relatorio && <Notice id="ct-none-note">{t.unattributed} item(ns) sem dono: feitos fora do app (celular ou navegador comum) ou antes do registro começar. {p.conteudo_atribuir ? 'Dá para atribuir na lista abaixo.' : ''}</Notice>}
      {goals && (goals.today.length > 0 || goals.by_creator.length > 0) && <section className="panel ai-panel"><h2>Metas de posts</h2><p className="body-muted">Meta definida na ficha da criadora. Conta publicados + agendados para mais tarde no mesmo dia. Dia sem leitura da Privacy não conta como meta batida.</p>
        {goals.today.length > 0 && <div className="table-scroll"><table><thead><tr><th>Hoje</th><th>Responsável</th><th>Posts</th><th>Pagos</th><th>Mensagem em massa</th><th>Vídeos (semana)</th><th>Situação</th></tr></thead>
          <tbody>{goals.today.map(g => <tr key={g.creator_id}><td><strong>{g.creator_name}</strong></td><td>{g.responsible}</td>
            <td className="tabular">{g.posts_done}{g.posts_sched ? ` + ${g.posts_sched} agend.` : ''} / {g.goals.posts_day}</td><td className="tabular">{g.goals.paid_day ? `${g.paid}/${g.goals.paid_day}` : '—'}</td>
            <td className="tabular">{g.goals.mass_day ? `${g.mass}/${g.goals.mass_day}` : '—'}</td><td className="tabular">{g.goals.videos_week ? `${g.videos_week}/${g.goals.videos_week}` : '—'}</td>
            <td>{g.met ? <Badge tone="green">Cumprida</Badge> : <Badge tone="amber">Falta {Object.entries(g.missing).map(([k, v]) => `${v} ${{ posts: 'post', paid: 'pago', mass: 'mensagem em massa', videos_week: 'vídeo' }[k]}`).join(', ')}</Badge>}</td></tr>)}</tbody></table></div>}
        {goals.by_creator.length > 0 && <div className="ai-two" style={{ marginTop: 12 }}>
          <div><h3 style={{ fontSize: 14 }}>Cumprimento por criadora</h3><div className="table-scroll"><table><thead><tr><th>Criadora</th><th>Dias</th><th>Batidas</th><th>%</th><th>Sem leitura</th></tr></thead><tbody>{goals.by_creator.map(b => <tr key={b.key}><td>{b.name}</td><td className="tabular">{b.days}</td><td className="tabular">{b.met}</td><td className="tabular"><strong>{b.pct}%</strong></td><td className="tabular">{b.no_read}</td></tr>)}</tbody></table></div></div>
          <div><h3 style={{ fontSize: 14 }}>Cumprimento por responsável</h3><div className="table-scroll"><table><thead><tr><th>Pessoa</th><th>Dias</th><th>Batidas</th><th>%</th></tr></thead><tbody>{goals.by_person.map(b => <tr key={b.key}><td>{b.name}</td><td className="tabular">{b.days}</td><td className="tabular">{b.met}</td><td className="tabular"><strong>{b.pct}%</strong></td></tr>)}</tbody></table></div></div>
        </div>}
        {alerts.length > 0 && <><h3 style={{ fontSize: 14, marginTop: 12 }}>Alertas dos últimos 7 dias</h3>{alerts.slice(0, 20).map(a => <div key={a.id} className="ct-alert"><Badge tone={a.level === 'cobranca' ? 'red' : 'amber'}>{a.checkpoint}</Badge><span className="body-muted" style={{ fontSize: 12 }}>{dateTime(a.created_at)}</span><span>{a.text}</span></div>)}</>}
      </section>}
      <section className="panel ai-panel"><h2>{p.conteudo_relatorio ? 'Por pessoa' : 'Seu resultado'}</h2><p className="body-muted">Mensagem em massa: vendas de mensagem paga no mesmo valor do disparo, até 7 dias depois (ou até o próximo disparo no mesmo valor). Postagem: compras e faturamento do Engajamento da Privacy.</p>
        <div className="table-scroll"><table><thead><tr><th>Pessoa</th><th>Disparos</th><th>Posts</th><th>Compras</th><th>Vendido (mensagem em massa)</th><th>Vendido (posts)</th><th>Total</th><th>Por item</th><th>Criadoras</th></tr></thead>
          <tbody>{sum.by_author.map(b => <tr key={b.key}><td><strong>{b.name}</strong></td><td className="tabular">{b.mass}</td><td className="tabular">{b.post}</td><td className="tabular">{b.purchases}</td><td className="tabular">{money(b.mass_cents)}</td><td className="tabular">{money(b.post_cents)}</td><td className="tabular"><strong>{money(b.revenue_cents)}</strong></td><td className="tabular">{money(b.per_item_cents)}</td><td className="body-muted" style={{ fontSize: 12 }}>{b.creators.join(', ')}</td></tr>)}</tbody></table></div></section>
      {sum.by_creator.length > 0 && <section className="panel ai-panel"><h2>Por criadora</h2>
        <div className="table-scroll"><table><thead><tr><th>Criadora</th><th>Disparos</th><th>Posts</th><th>Compras</th><th>Vendido (mensagem em massa)</th><th>Vendido (posts)</th><th>Total</th><th>Por item</th><th>Leitura</th></tr></thead>
          <tbody>{sum.by_creator.map(b => { const rd = meta?.reads?.[b.key] || {}; return <tr key={b.key}><td><strong>{b.name}</strong></td><td className="tabular">{b.mass}</td><td className="tabular">{b.post}</td><td className="tabular">{b.purchases}</td><td className="tabular">{money(b.mass_cents)}</td><td className="tabular">{money(b.post_cents)}</td><td className="tabular"><strong>{money(b.revenue_cents)}</strong></td><td className="tabular">{money(b.per_item_cents)}</td><td className="body-muted" style={{ fontSize: 11 }}>{rd.posts_at ? `posts ${dateTime(rd.posts_at)}` : 'posts —'}<br/>{rd.calendar_at ? `calendário ${dateTime(rd.calendar_at)}` : 'calendário —'}</td></tr>; })}</tbody></table></div></section>}
      <section className="panel ai-panel"><h2>Item a item</h2><p className="body-muted"><Info size={12}/> Confirmado = feito pelo app e encontrado na Privacy. Provável = clique no app, ainda não encontrado no calendário/Engajamento. Manual = atribuído pelo admin.</p>
        <div className="table-scroll"><table className="ct-items"><thead><tr><th>Data</th><th>Criadora</th><th>Tipo</th><th>Texto</th><th>Preço</th><th>Quem fez</th><th>Compras</th><th>Vendido</th></tr></thead>
          <tbody>{items.map(it => { const r = it.result || {}; const [al, at] = ATTR[it.attribution] || ATTR.none; return <tr key={it.id}>
            <td className="tabular">{dateTime(it.at)}{it.status === 'scheduled' && <div><Badge tone="amber">Agendado</Badge></div>}</td>
            <td>{it.creator_name}</td><td>{it.has_thumb && p.conteudo_relatorio && <img className="ct-thumb" alt="" loading="lazy" src={`${api.defaults.baseURL}/content/thumb/${it.id}`}/>}{KIND[it.kind] || it.kind}{it.media_type && <div className="body-muted" style={{ fontSize: 11 }}>{MEDIA[it.media_type]}</div>}</td>
            <td className="ct-text" title={it.text}>{it.text || <span className="body-muted">—</span>}{it.audience?.length > 0 && <div className="body-muted" style={{ fontSize: 11 }}>Para: {it.audience.join(', ')}</div>}</td>
            <td className="tabular">{money(it.price_cents)}</td>
            <td>{p.conteudo_atribuir ? <Select id={`ct-a-${it.id}`} value={it.author_id || ''} onChange={e => assign(it, e.target.value)}><option value="">Sem atribuição</option>{(meta?.people || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select> : <strong>{it.author_name || 'Sem atribuição'}</strong>}<div><Badge tone={at}>{al}</Badge></div></td>
            <td className="tabular" title={QUAL[r.quality] || ''}>{r.purchases ?? 0}{(r.h24 != null || r.h72 != null) && <div className="body-muted" style={{ fontSize: 11 }}>24h {r.h24 ?? '—'} · 72h {r.h72 ?? '—'}</div>}{r.quality === 'estimado' && <div className="body-muted" style={{ fontSize: 11 }}>estimado</div>}</td>
            <td className="tabular"><strong>{money(r.revenue_cents)}</strong>{it.kind === 'post' && r.likes != null && <div className="body-muted" style={{ fontSize: 11 }}>{r.likes} curtidas · {r.comments} coment.</div>}</td>
          </tr>; })}</tbody></table></div></section>
      <Notice id="ct-tip">Dica para medir mensagem em massa com precisão: use um valor "quebrado" e diferente a cada disparo (ex.: R$ 49,87 em vez de R$ 49,90). Assim nenhuma venda do chat no mesmo valor se mistura.</Notice>
    </>}
  </>;
}
