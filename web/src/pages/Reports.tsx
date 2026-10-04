import { useEffect, useState } from 'react';
import { get, isoDaysAgo, todayISO, fmtDate } from '../api';
import { downloadReportCsv } from '../files';
import { useApp } from '../ctx';
import { formatBRL, formatQty, pctToText, Unit, BRAND } from '@folha/shared';
import { PIcon } from '../productPhotos';

const PRESETS: [string, () => [string, string]][] = [
  ['Hoje', () => [todayISO(), todayISO()]], ['Ontem', () => [isoDaysAgo(1), isoDaysAgo(1)]],
  ['7 dias', () => [isoDaysAgo(6), todayISO()]], ['30 dias', () => [isoDaysAgo(29), todayISO()]],
  ['Este mês', () => [todayISO().slice(0, 8) + '01', todayISO()]],
];

export function Reports() {
  const { toast, status } = useApp();
  const [from, setFrom] = useState(todayISO()); const [to, setTo] = useState(todayISO());
  const [r, setR] = useState<any>(null);
  useEffect(() => { get(`/api/reports?from=${from}&to=${to}`).then(setR).catch((e) => toast(e.message, 'erro')); }, [from, to, toast]);
  const csv = (s: string) => () => { downloadReportCsv(s, from, to).catch((e) => alert(e.message)); };
  const s = r?.summary;
  const maxCat = Math.max(1, ...(r?.by_category ?? []).map((c: any) => c.total_cents));
  return (
    <div className="page print-area report">
      <div className="page-title">
        <h1>📊 Relatórios</h1>
        <div className="tabs no-print">{PRESETS.map(([l, f]) => { const [a, b] = f(); return <button key={l} className={a === from && b === to ? 'on' : ''} onClick={() => { setFrom(a); setTo(b); }}>{l}</button>; })}</div>
        <div className="row no-print"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /><span>até</span>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <span className="spacer" />
        <button className="btn no-print" onClick={() => window.print()}>🖨 Imprimir</button>
      </div>
      <div className="print-only"><b>{status?.store?.name}</b> — Relatório de {fmtDate(from)} a {fmtDate(to)} · {BRAND.name}</div>
      {s && <>
        <div className="grid4">
          <div className="stat verde"><div className="lbl">Vendido</div><div className="val">{formatBRL(s.total_cents)}</div></div>
          <div className="stat"><div className="lbl">Vendas · ticket médio</div><div className="val">{s.sales_count} · {formatBRL(s.ticket_medio_cents)}</div></div>
          <div className="stat verde"><div className="lbl">Margem estimada</div><div className="val">{s.imported_count && s.total_cents === s.imported_total_cents ? '—' : <>{formatBRL(s.margin_cents)} <span style={{ fontSize: 16 }}>({pctToText(s.margin_pct_x100)})</span></>}</div>
            {s.imported_count > 0 && <span className="small muted">{s.total_cents === s.imported_total_cents ? 'vendas importadas não têm custo' : `só das vendas feitas no ${BRAND.name}`}</span>}</div>
          <div className="stat tomate"><div className="lbl">Perdas (custo)</div><div className="val">{formatBRL(s.loss_cost_cents)}</div></div>
        </div>
        <div className="row wrap small muted">
          <span>Bruto {formatBRL(s.gross_cents)}</span>·<span>Descontos {formatBRL(s.discount_cents)}</span>·<span>Custo {formatBRL(s.cost_cents)}</span>·
          <span>Canceladas: {s.canceled_count} ({formatBRL(s.canceled_total_cents)})</span>
        </div>
        {s.promo_items_count > 0 && <div className="row wrap small" style={{ margin: '6px 0' }} data-testid="promo-summary"><span className="promo-badge">PROMO</span>
          <span>Vendido em promoção: <b>{formatBRL(s.promo_total_cents)}</b> em {s.promo_items_count} item(ns) de {s.promo_sales_count} venda(s) · o freguês economizou <b>{formatBRL(s.promo_savings_cents)}</b></span></div>}
        {s.imported_count > 0 && <div className="ok-box small" style={{ margin: '8px 0' }} data-testid="imported-note">
          Inclui <b>{s.imported_count} venda(s) importada(s) do sistema antigo</b> ({formatBRL(s.imported_total_cents)}): só o total, sem itens e sem forma de pagamento
          (aparecem como “Não informado” e “Sistema antigo”). Por isso a margem, as categorias e os produtos contam só as vendas feitas no {BRAND.name}.
        </div>}
        <div className="grid2">
          <Section title="Por forma de pagamento" csv={csv('pagamentos')}>
            <table className="t"><thead><tr><th>Forma</th><th className="r">Qtd</th><th className="r">Total</th></tr></thead>
              <tbody>{r.by_payment.map((p: any) => <tr key={p.method}><td>{p.label}</td><td className="r">{p.n}</td><td className="r"><b>{formatBRL(p.total_cents)}</b></td></tr>)}</tbody></table>
          </Section>
          <Section title="Por operador" csv={csv('operadores')}>
            <table className="t"><thead><tr><th>Operador</th><th className="r">Vendas</th><th className="r">Total</th></tr></thead>
              <tbody>{r.by_operator.map((o: any) => <tr key={o.name}><td>{o.name}</td><td className="r">{o.sales_count}</td><td className="r"><b>{formatBRL(o.total_cents)}</b></td></tr>)}</tbody></table>
          </Section>
        </div>
        <Section title="Por categoria" csv={csv('categorias')}>
          <table className="t"><thead><tr><th>Categoria</th><th style={{ width: '40%' }} /><th className="r">Vendido</th><th className="r">Margem est.</th></tr></thead>
            <tbody>{r.by_category.map((c: any) => <tr key={c.name}><td><b>{c.name}</b></td>
              <td><div style={{ height: 12, borderRadius: 6, background: c.color, width: `${(c.total_cents / maxCat) * 100}%` }} /></td>
              <td className="r"><b>{formatBRL(c.total_cents)}</b></td><td className="r">{formatBRL(c.total_cents - c.cost_cents)}</td></tr>)}</tbody></table>
        </Section>
        <Section title="Por produto" csv={csv('produtos')}>
          <table className="t"><thead><tr><th>Produto</th><th className="r">Quantidade</th><th className="r">Vendido</th><th className="r">Custo</th><th className="r">Margem est.</th></tr></thead>
            <tbody>{r.by_product.map((p: any) => <tr key={p.id}><td><PIcon p={p} /> {p.name}{p.promo_total_cents > 0 && <> <span className="promo-badge" title={`Em promoção: ${formatBRL(p.promo_total_cents)}`}>PROMO</span></>}</td><td className="r">{formatQty(p.qty, p.unit as Unit)}</td>
              <td className="r"><b>{formatBRL(p.total_cents)}</b></td><td className="r">{formatBRL(p.cost_cents)}</td><td className="r">{formatBRL(p.total_cents - p.cost_cents)}</td></tr>)}</tbody></table>
        </Section>
        <Section title="Perdas do período" csv={csv('perdas')}>
          <div className="row wrap" style={{ marginBottom: 8 }}>{r.losses.map((l: any) => <span key={l.reason} className="tag bad">{l.label}: {formatBRL(l.cost_cents)} ({l.n})</span>)}</div>
          <table className="t"><thead><tr><th>Data</th><th>Produto</th><th>Motivo</th><th className="r">Qtd</th><th className="r">Custo</th><th>Quem</th></tr></thead>
            <tbody>{r.loss_items.map((l: any) => <tr key={l.id}><td>{l.created_at.slice(0, 16)}</td><td>{l.name}</td><td>{r.losses.find((x: any) => x.reason === l.reason)?.label}</td>
              <td className="r">{formatQty(l.qty, l.unit)}</td><td className="r neg">{formatBRL(l.cost_cents)}</td><td>{l.user_name}</td></tr>)}</tbody></table>
          {!r.loss_items.length && <div className="muted">Sem perdas no período.</div>}
        </Section>
        <div className="row no-print"><button className="btn" onClick={csv('vendas')}>⬇ CSV de todas as vendas</button><button className="btn" onClick={csv('resumo')}>⬇ CSV por dia</button></div>
      </>}
    </div>
  );
}

function Section({ title, csv, children }: { title: string; csv: () => void; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}><h3 className="grow" style={{ margin: 0 }}>{title}</h3><button className="btn btn-sm no-print" onClick={csv}>⬇ CSV</button></div>
      {children}
    </div>
  );
}
