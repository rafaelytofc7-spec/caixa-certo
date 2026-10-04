import { useEffect, useState } from 'react';
import { get, post, fmtDateTime, fmtDate } from '../api';
import { useApp } from '../ctx';
import { MoneyInput, QtyInput } from '../components/Inputs';
import { ProductPicker } from '../components/ProductPicker';
import { formatBRL, formatQty, LOSS_LABEL, LOSS_REASONS, LossReason, Product, UNIT_LABEL } from '@folha/shared';
import { PIcon } from '../productPhotos';

const TABS: [string, string][] = [['alertas', '⚠ Alertas'], ['entrada', '📥 Entrada'], ['perda', '🗑 Perda / quebra'], ['ajuste', '⚖ Ajuste'], ['kardex', '📜 Kardex']];
const MOV: Record<string, string> = { ENTRADA: 'Entrada', VENDA: 'Venda', CANCELAMENTO: 'Cancelamento', AJUSTE: 'Ajuste', PERDA: 'Perda', INICIAL: 'Inicial', EXCLUSAO: 'Estorno por exclusão' };

export function Stock({ tab }: { tab?: string }) {
  const { go, user } = useApp();
  const t = tab === 'vencendo' || tab === 'baixo' ? 'alertas' : tab && TABS.some((x) => x[0] === tab) ? tab : 'alertas';
  const [products, setProducts] = useState<Product[]>([]);
  const load = () => get('/api/products').then(setProducts).catch(() => {});
  useEffect(() => { load(); }, []);
  const isMgr = user?.role !== 'operador';
  return (
    <div className="page">
      <div className="page-title"><h1>🧺 Estoque</h1>
        <div className="tabs">{TABS.filter(([k]) => isMgr || k !== 'entrada').map(([k, l]) => <button key={k} className={t === k ? 'on' : ''} onClick={() => go(`estoque/${k}`)}>{l}</button>)}</div></div>
      {t === 'entrada' && <Entry products={products} onDone={load} />}
      {t === 'perda' && <Loss products={products} onDone={load} />}
      {t === 'ajuste' && <Adjust products={products} onDone={load} />}
      {t === 'kardex' && <Kardex products={products} />}
      {t === 'alertas' && <Alerts />}
    </div>
  );
}

function Entry({ products, onDone }: { products: Product[]; onDone: () => void }) {
  const { toast } = useApp();
  const [pid, setPid] = useState<number | null>(null);
  const [qty, setQty] = useState(0); const [cost, setCost] = useState(0);
  const [lot, setLot] = useState(''); const [exp, setExp] = useState(''); const [note, setNote] = useState('');
  const p = products.find((x) => x.id === pid);
  useEffect(() => { if (p) setCost(p.cost_cents); }, [pid]); // eslint-disable-line
  const save = async () => {
    try {
      await post('/api/stock/entry', { product_id: pid, qty, unit_cost_cents: cost, lot_code: lot || null, expiry_date: exp || null, note: note || null });
      toast(`Entrada de ${formatQty(qty, p!.unit)} de ${p!.name} lançada.`); setQty(0); setLot(''); setExp(''); setNote(''); onDone();
    } catch (e: any) { toast(e.message, 'erro'); }
  };
  return (
    <div className="card col" style={{ maxWidth: 900 }}>
      <div className="row wrap"><h3 className="grow" style={{ margin: 0 }}>Entrada rápida de um produto</h3>
        <button className="btn btn-sm btn-lima" onClick={() => { location.hash = '#/compras/nova'; }}>🚚 Compra com vários itens / fornecedor</button></div>
      <label className="field">Produto<ProductPicker products={products} value={pid} onChange={setPid} /></label>
      {p && <>
        <div className="grid3">
          <label className="field">Quantidade ({p.unit === 'KG' ? 'kg' : UNIT_LABEL[p.unit]})<QtyInput big kg={p.unit === 'KG'} value={qty} onChange={setQty} /></label>
          <label className="field">Custo {p.unit === 'KG' ? 'por kg' : 'unitário'}<MoneyInput big value={cost} onChange={setCost} /></label>
          <div className="stat"><div className="lbl">Total da nota</div><div className="val">{formatBRL(Math.round(cost * qty / 1000))}</div></div>
        </div>
        <div className="grid3">
          <label className="field">Lote (opcional)<input className="input" value={lot} onChange={(e) => setLot(e.target.value)} /></label>
          <label className="field">Validade (opcional)<input className="input" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></label>
          <label className="field">Obs.<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Fornecedor, nota…" /></label>
        </div>
        <div className="row"><span className="muted grow">Estoque atual: {formatQty(p.stock_qty, p.unit)} → fica {formatQty(p.stock_qty + qty, p.unit)}</span>
          <button className="btn btn-primary btn-big" disabled={qty <= 0} onClick={save}>Lançar entrada</button></div>
      </>}
    </div>
  );
}

function Loss({ products, onDone }: { products: Product[]; onDone: () => void }) {
  const { toast, withManager } = useApp();
  const [pid, setPid] = useState<number | null>(null);
  const [qty, setQty] = useState(0); const [reason, setReason] = useState<LossReason>('estragou'); const [note, setNote] = useState('');
  const [recent, setRecent] = useState<any[]>([]);
  const p = products.find((x) => x.id === pid);
  const loadRecent = () => get('/api/stock/losses').then(setRecent).catch(() => {});
  useEffect(() => { loadRecent(); }, []);
  const save = async () => {
    try {
      const r = await withManager((pin) => post('/api/stock/loss', { product_id: pid, qty, reason, note: note || null, manager_pin: pin }), 'Perda precisa do gerente');
      if (r) { toast(`Perda lançada: ${formatQty(qty, p!.unit)} de ${p!.name} (custo ${formatBRL(r.cost_cents)}).`); setQty(0); setNote(''); onDone(); loadRecent(); }
    } catch (e: any) { toast(e.message, 'erro'); }
  };
  return (
    <div className="grid2">
      <div className="card col">
        <h3>Lançar perda / quebra</h3>
        <div className="muted small">Baixa o estoque e NÃO entra como venda. Precisa do PIN do gerente.</div>
        <label className="field">Produto<ProductPicker products={products} value={pid} onChange={setPid} /></label>
        <div className="field"><span>Motivo</span>
          <div className="tabs">{LOSS_REASONS.map((r) => <button key={r} className={reason === r ? 'on' : ''} onClick={() => setReason(r)}>{LOSS_LABEL[r]}</button>)}</div></div>
        {p && <>
          <label className="field">Quantidade ({p.unit === 'KG' ? 'kg' : UNIT_LABEL[p.unit]})<QtyInput big kg={p.unit === 'KG'} value={qty} onChange={setQty} /></label>
          <div className="muted">Custo estimado da perda: <b>{formatBRL(Math.round(p.cost_cents * qty / 1000))}</b></div>
        </>}
        <label className="field">Obs.<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: caixa caiu do caminhão" /></label>
        <button className="btn btn-danger solid btn-big" disabled={!p || qty <= 0} onClick={save}>Lançar perda</button>
      </div>
      <div className="card">
        <h3>Perdas de hoje</h3>
        <table className="t"><thead><tr><th>Hora</th><th>Produto</th><th>Motivo</th><th className="r">Qtd</th><th className="r">Custo</th></tr></thead>
          <tbody>{recent.map((l) => <tr key={l.id}><td>{l.created_at.slice(11, 16)}</td><td>{l.product_name}</td><td>{LOSS_LABEL[l.reason as LossReason]}</td>
            <td className="r">{formatQty(l.qty, l.unit)}</td><td className="r neg">{formatBRL(l.cost_cents)}</td></tr>)}</tbody></table>
        {!recent.length && <div className="muted" style={{ padding: 10 }}>Nenhuma perda hoje. 🍀</div>}
      </div>
    </div>
  );
}

function Adjust({ products, onDone }: { products: Product[]; onDone: () => void }) {
  const { toast, withManager } = useApp();
  const [pid, setPid] = useState<number | null>(null);
  const [qty, setQty] = useState(0); const [note, setNote] = useState('');
  const p = products.find((x) => x.id === pid);
  useEffect(() => { if (p) setQty(Math.max(0, p.stock_qty)); }, [pid]); // eslint-disable-line
  const save = async () => {
    try {
      const r = await withManager((pin) => post('/api/stock/adjust', { product_id: pid, counted_qty: qty, note: note || null, manager_pin: pin }));
      if (r) { toast(`Estoque ajustado (${r.delta >= 0 ? '+' : ''}${formatQty(r.delta, p!.unit)}).`); onDone(); }
    } catch (e: any) { toast(e.message, 'erro'); }
  };
  return (
    <div className="card col" style={{ maxWidth: 760 }}>
      <h3>Ajuste de contagem</h3>
      <div className="muted small">Contou a banca? Informe quanto tem de verdade. A diferença vai para o kardex.</div>
      <label className="field">Produto<ProductPicker products={products} value={pid} onChange={setPid} /></label>
      {p && <>
        <div className="grid2">
          <div className="stat"><div className="lbl">No sistema</div><div className="val">{formatQty(p.stock_qty, p.unit)}</div></div>
          <label className="field">Contado ({p.unit === 'KG' ? 'kg' : UNIT_LABEL[p.unit]})<QtyInput big kg={p.unit === 'KG'} value={qty} onChange={setQty} /></label>
        </div>
        <label className="field">Motivo<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contagem de sábado" /></label>
        <button className="btn btn-primary btn-big" onClick={save}>Ajustar estoque</button>
      </>}
    </div>
  );
}

function Kardex({ products }: { products: Product[] }) {
  const [pid, setPid] = useState<number | null>(null);
  const [data, setData] = useState<any>(null);
  useEffect(() => { if (pid) get(`/api/stock/kardex/${pid}`).then(setData); else setData(null); }, [pid]);
  return (
    <div className="card col">
      <label className="field">Produto<ProductPicker products={products} value={pid} onChange={setPid} /></label>
      {data && (
        <table className="t"><thead><tr><th>Data/hora</th><th>Movimento</th><th>Obs.</th><th>Usuário</th><th className="r">Qtd</th><th className="r">Saldo</th></tr></thead>
          <tbody>{data.movements.map((m: any) => (
            <tr key={m.id}><td>{fmtDateTime(m.created_at)}</td><td><span className={`tag ${m.qty < 0 ? (m.type === 'PERDA' ? 'bad' : '') : 'ok'}`}>{MOV[m.type]}</span></td>
              <td className="small">{m.note}</td><td>{m.user_name ?? '—'}</td>
              <td className={`r ${m.qty < 0 ? 'neg' : 'pos'}`}>{m.qty > 0 ? '+' : ''}{formatQty(m.qty, data.product.unit)}</td><td className="r"><b>{formatQty(m.balance_after, data.product.unit)}</b></td></tr>))}</tbody></table>
      )}
    </div>
  );
}

/** Alertas: lotes vencendo + produtos abaixo do mínimo, com o que fazer em cada caso */
export function Alerts({ compact = false }: { compact?: boolean }) {
  const { user } = useApp();
  const [exp, setExp] = useState<any[] | null>(null);
  const [low, setLow] = useState<any[] | null>(null);
  useEffect(() => { get('/api/stock/expiring').then(setExp).catch(() => setExp([])); get('/api/stock/low').then(setLow).catch(() => setLow([])); }, []);
  const isMgr = user?.role !== 'operador';
  const lim = compact ? 6 : 999;
  return (
    <div className={compact ? 'col' : 'grid2'}>
      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}><h3 className="grow" style={{ margin: 0 }}>⏰ Vencendo</h3>{exp && <span className={`tag ${exp.length ? 'warn' : 'ok'}`}>{exp.length}</span>}</div>
        {exp === null ? <div className="muted">Carregando…</div> : !exp.length ? <div className="empty-mini">🍀 Nada vencendo.</div> : <>
          <ul className="alert-list">{exp.slice(0, lim).map((l) => <li key={l.id}>
            <span className="em"><PIcon p={{ name: l.product_name, icon: l.icon }} /></span><span className="grow"><b>{l.product_name}</b><span className="small muted"> · {l.lot_code ?? 'sem lote'} · sobrou {formatQty(l.qty_left, l.unit)}</span></span>
            {l.days_left < 0 ? <span className="tag bad">Vencido</span> : l.days_left === 0 ? <span className="tag bad">Vence hoje</span> : <span className="tag warn">{l.days_left === 1 ? 'amanhã' : `${l.days_left} dias`} · {fmtDate(l.expiry_date)}</span>}
          </li>)}</ul>
          {exp.length > lim && <div className="small muted">+ {exp.length - lim} outros</div>}
          {!compact && <div className="small muted" style={{ marginTop: 8 }}>Venda primeiro (deixe na frente da banca), faça promoção no <b>Preço do dia</b> ou lance como <b>perda</b> se estragou.</div>}
        </>}
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}><h3 className="grow" style={{ margin: 0 }}>📉 Estoque baixo</h3>{low && <span className={`tag ${low.length ? 'warn' : 'ok'}`}>{low.length}</span>}</div>
        {low === null ? <div className="muted">Carregando…</div> : !low.length ? <div className="empty-mini">✅ Tudo abastecido.</div> : <>
          <ul className="alert-list">{low.slice(0, lim).map((p) => <li key={p.id}>
            <span className="em"><PIcon p={p} /></span><span className="grow"><b>{p.name}</b><span className="small muted"> · mínimo {formatQty(p.min_stock, p.unit)}</span></span>
            <span className={`tag ${p.stock_qty <= 0 ? 'bad' : 'warn'}`}>tem {formatQty(p.stock_qty, p.unit)}</span>
          </li>)}</ul>
          {low.length > lim && <div className="small muted">+ {low.length - lim} outros</div>}
          {!compact && isMgr && <div className="row" style={{ marginTop: 10 }}><button className="btn btn-sm btn-primary" onClick={() => { location.hash = '#/compras/nova'; }}>🚚 Lançar compra</button></div>}
        </>}
      </div>
    </div>
  );
}

