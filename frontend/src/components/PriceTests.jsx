// Lote 143 (Claude): teste de faixas de preço — o que cada faixa rende por oferta
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, errorText } from '../lib/api';
import { SectionHeading, Badge } from './Common';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

const brl = (c) => 'R$ ' + ((c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PriceTests({ names = {} }) {
  const [tests, setTests] = useState([]);
  const load = async () => { try { setTests((await api.get('/assist/price-tests')).data || []); } catch (e) { /* sem acesso */ } };
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  const stop = async (id) => { try { await api.post(`/assist/price-tests/${id}/stop`); toast.success('Teste encerrado'); load(); } catch (e) { toast.error(errorText(e)); } };
  const active = tests.filter((t) => t.active);
  if (!active.length) return null;
  return (
    <div style={{ margin: '24px 0' }}>
      <SectionHeading title="Teste de preço" caption="Cada fã que ainda não comprou recebe sempre a mesma faixa. Depois de 8 ofertas por faixa, a que rende mais por oferta passa a receber mais ofertas." />
      {active.map((t) => (
        <div key={t.id} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
            <strong>{names[t.creator_id] || 'Criadora'} · {t.item}</strong>
            <span style={{ fontSize: 13, color: 'var(--muted, #6b6a75)' }}>{t.total_offers} fãs com oferta · {t.total_paid} pagaram</span>
            <button onClick={() => stop(t.id)} style={{ marginLeft: 'auto', fontSize: 13, padding: '6px 10px', border: '1px solid #d9d7d1', borderRadius: 8, background: 'transparent', cursor: 'pointer' }}>Encerrar teste</button>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Faixa</TableHead><TableHead>Fãs com oferta</TableHead><TableHead>Pagaram</TableHead><TableHead>Conversão</TableHead><TableHead>R$ por oferta</TableHead></TableRow></TableHeader>
            <TableBody>
              {t.variants_stats.map((v) => (
                <TableRow key={v.cents}>
                  <TableCell>{brl(v.cents)} {t.leader_cents === v.cents && v.offers > 0 && <Badge tone="good">rendendo mais</Badge>}</TableCell>
                  <TableCell>{v.offers}</TableCell>
                  <TableCell>{v.paid}</TableCell>
                  <TableCell>{v.offers ? Math.round(v.conv * 100) + '%' : '—'}</TableCell>
                  <TableCell>{v.offers ? brl(v.per_offer_cents) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  );
}
