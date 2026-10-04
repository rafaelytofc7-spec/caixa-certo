import { useEffect, useMemo, useState } from 'react';
import { get, post, put, todayISO, isoDaysAgo, fmtDateTime } from '../api';
import { useApp } from '../ctx';
import { Modal } from '../components/Modal';
import { MoneyInput, QtyInput } from '../components/Inputs';
import { ProductSearch } from '../components/ProductPicker';
import { norm } from '../text';
import { formatBRL, formatQty, Product, Unit, UNIT_LABEL } from '@folha/shared';
import { PIcon } from '../productPhotos';

const TABS: [string, string][] = [['nova', '📥 Nova compra'], ['historico', '📜 Compras lançadas'], ['fornecedores', '🚚 Fornecedores']];

export function Purchases({ tab }: { tab?: string }) {
  const { go } = useApp();
  const t = TABS.some(([k]) => k === tab) ? tab! : 'nova';
  const [sups, setSups] = useState<any[]>([]);
  const loadSups = () => get('/api/suppliers').then(setSups).catch(() => {});
  useEffect(() => { loadSups(); }, []);
  return (
    <div className="page">
      <div className="page-title"><h1>🚚 Compras</h1>
        <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={t === k ? 'on' : ''} onClick={() => go(`compras/${k}`)}>{l}</button>)}</div></div>
      {t === 'nova' && <NewPurchase sups={sups} onSupsChange={loadSups} />}
      {t === 'historico' && <History />}
      {t === 'fornecedores' && <Suppliers sups={sups} onChange={loadSups} />}
    </div>
  );
}

interface Line { key: number; p: Product; qty: number; cost: number; exp: string; lot: string }
let lk = 1;

function NewPurchase({ sups, onSupsChange }: { sups: any[]; onSupsChange: () => void }) {
  const { toast, refreshStatus } = useApp();
  const [products, setProducts] = useState<Product[]>([]);
  const [sup, setSup] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [newSup, setNewSup] = useState(false);
  const [done, setDone] = useState<any>(null);
  const loadP = () => get('/api/products?active=1').then(setProducts).catch(() => {});
  useEffect(() => { loadP(); }, []);
  const active = sups.filter((s) => s.active);
  const total = lines.reduce((a, l) => a + Math.round((l.cost * l.qty) / 1000), 0);
  const upd = (k: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const valid = lines.length > 0 && lines.every((l) => l.qty > 0);
  const save = async () => {
    setBusy(true);
    try {
      const r = await post('/api/purchases', { supplier_id: sup || null, note: note || null,
        items: lines.map((l) => ({ product_id: l.p.id, qty: l.qty, unit_cost_cents: l.cost, expiry_date: l.exp || null, lot_code: l.lot || null })) });
      setDone({ ...r, supplier: sups.find((s) => s.id === sup)?.name }); setLines([]); setNote(''); loadP(); refreshStatus();
      toast(`Compra nº ${r.id} lançada: ${r.items_count} item(ns), ${formatBRL(r.total_cents)}.`);
    } catch (e: any) { toast(e.message, 'erro'); } finally { setBusy(false); }
  };
  return (
    <>
      {done && <div className="ok-box row wrap">✅ Compra nº {done.id}{done.supplier ? ` de ${done.supplier}` : ''} lançada — {done.items_count} item(ns), {formatBRL(done.total_cents)}. O estoque já foi atualizado.
        <span className="spacer" /><button className="btn btn-sm" onClick={() => setDone(null)}>OK</button></div>}
      <div className="card col">
        <div className="grid2 tight">
          <label className="field">Fornecedor
            <div className="row" style={{ gap: 6 }}>
              <select className="input grow" value={sup} onChange={(e) => setSup(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— sem fornecedor / avulso —</option>{active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" className="btn btn-sm" onClick={() => setNewSup(true)}>+ Novo</button>
            </div></label>
          <label className="field">Nota / observação<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: NF 1234, pago no PIX" /></label>
        </div>
        <label className="field">Adicionar produto<ProductSearch products={products} exclude={lines.map((l) => l.p.id)}
          onPick={(p) => setLines((ls) => [...ls, { key: lk++, p, qty: 0, cost: p.cost_cents, exp: '', lot: '' }])} /></label>
        {!lines.length ? <div className="empty-state"><span className="em">📦</span><b>Nenhum item ainda</b><span className="muted">Busque o produto acima (ex.: “tomate”) e informe quanto chegou e o custo.</span></div> :
          <div className="plines">
            <div className="pline head"><span>Produto</span><span>Quantidade</span><span>Custo</span><span>Validade</span><span className="r">Total</span><span /></div>
            {lines.map((l) => (
              <div key={l.key} className="pline">
                <span className="pn"><span className="em"><PIcon p={l.p} /></span><span><b>{l.p.name}</b><small className="muted">tem {formatQty(l.p.stock_qty, l.p.unit as Unit)} → {formatQty(l.p.stock_qty + l.qty, l.p.unit as Unit)}</small></span></span>
                <label className="pf"><small>{l.p.unit === 'KG' ? 'kg' : UNIT_LABEL[l.p.unit as Unit]}</small><QtyInput kg={l.p.unit === 'KG'} value={l.qty} onChange={(v) => upd(l.key, { qty: v })} autoFocus /></label>
                <label className="pf"><small>{l.p.unit === 'KG' ? 'por kg' : 'por un.'}</small><MoneyInput value={l.cost} onChange={(v) => upd(l.key, { cost: v })} /></label>
                <label className="pf"><small>validade</small><input className="input" type="date" value={l.exp} onChange={(e) => upd(l.key, { exp: e.target.value })} /></label>
                <span className="r num pt"><b>{formatBRL(Math.round((l.cost * l.qty) / 1000))}</b></span>
                <button className="btn btn-sm btn-ghost x-line" aria-label={`Tirar ${l.p.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>
              </div>))}
          </div>}
        <div className="row wrap purchase-foot">
          <div className="stat grow"><div className="lbl">Total da compra</div><div className="val">{formatBRL(total)}</div></div>
          <button className="btn btn-primary btn-big" disabled={!valid || busy} onClick={save}>{busy ? 'Lançando…' : `Lançar compra (${lines.length})`}</button>
        </div>
        <div className="small muted">Dá entrada no estoque de todos os itens de uma vez, atualiza o custo de cada produto e guarda quem lançou. Se algum item der erro, nada é lançado.</div>
      </div>
      {newSup && <SupplierForm s={{ name: '', phone: '', doc: '', note: '', active: true }} onClose={() => setNewSup(false)} onDone={(x) => { setNewSup(false); onSupsChange(); if (x?.id) setSup(x.id); }} />}
    </>
  );
}

function History() {
  const { toast } = useApp();
  const [from, setFrom] = useState(isoDaysAgo(29)); const [to, setTo] = useState(todayISO());
  const [rows, setRows] = useState<any[]>([]); const [q, setQ] = useState('');
  const [view, setView] = useState<any>(null);
  useEffect(() => { get(`/api/purchases?from=${from}&to=${to}`).then(setRows).catch((e) => toast(e.message, 'erro')); }, [from, to, toast]);
  const shown = useMemo(() => rows.filter((r) => !q || norm(`${r.supplier_name ?? ''} ${r.note ?? ''} ${r.user_name} ${r.id}`).includes(norm(q))), [rows, q]);
  const total = shown.reduce((a, r) => a + r.total_cents, 0);
  return (
    <div className="card">
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <input className="input grow" style={{ minWidth: 180 }} placeholder="Buscar fornecedor, nota, nº…" value={q} onChange={(e) => setQ(e.target.value)} />
        <input type="date" className="input" style={{ width: 170 }} value={from} onChange={(e) => setFrom(e.target.value)} /><span>até</span>
        <input type="date" className="input" style={{ width: 170 }} value={to} onChange={(e) => setTo(e.target.value)} />
        <span className="tag ok big-tag">{shown.length} compra(s) · {formatBRL(total)}</span>
      </div>
      <div className="table-wrap"><table className="t"><thead><tr><th>Nº</th><th>Data</th><th>Fornecedor</th><th>Nota</th><th className="r">Itens</th><th className="r">Total</th><th>Quem lançou</th></tr></thead>
        <tbody>{shown.map((r) => <tr key={r.id} className="click" onClick={() => setView(r)}><td><b>{r.id}</b></td><td>{fmtDateTime(r.created_at)}</td><td>{r.supplier_name ?? <span className="muted">avulso</span>}</td>
          <td className="small">{r.note ?? ''}</td><td className="r">{r.items_count}</td><td className="r"><b>{formatBRL(r.total_cents)}</b></td><td>{r.user_name}</td></tr>)}</tbody></table></div>
      {!shown.length && <div className="empty-mini">Nenhuma compra no período.</div>}
      {view && <PurchaseView p={view} onClose={() => setView(null)} />}
    </div>
  );
}

function PurchaseView({ p, onClose }: { p: any; onClose: () => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { get(`/api/purchases/${p.id}/items`).then(setItems).catch(() => setItems([])); }, [p.id]);
  return (
    <Modal title={`Compra nº ${p.id}`} onClose={onClose} size="mid">
      <div className="muted">{fmtDateTime(p.created_at)} · {p.supplier_name ?? 'avulso'} · lançada por {p.user_name}{p.note ? ` · ${p.note}` : ''}</div>
      <table className="t"><thead><tr><th>Produto</th><th className="r">Qtd</th><th className="r">Custo</th><th className="r">Total</th></tr></thead>
        <tbody>{(items ?? []).map((i, k) => <tr key={k}><td>{i.name}</td><td className="r">{formatQty(i.qty, i.unit)}</td><td className="r">{formatBRL(i.unit_cost_cents)}</td>
          <td className="r"><b>{formatBRL(Math.round((i.unit_cost_cents * i.qty) / 1000))}</b></td></tr>)}
          <tr><td colSpan={3}><b>Total</b></td><td className="r"><b>{formatBRL(p.total_cents)}</b></td></tr></tbody></table>
    </Modal>
  );
}

function Suppliers({ sups, onChange }: { sups: any[]; onChange: () => void }) {
  const [edit, setEdit] = useState<any>(null);
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}><h3 className="grow" style={{ margin: 0 }}>Fornecedores</h3>
        <button className="btn btn-primary" onClick={() => setEdit({ name: '', phone: '', doc: '', note: '', active: true })}>+ Novo fornecedor</button></div>
      <div className="table-wrap"><table className="t"><thead><tr><th>Nome</th><th>Telefone</th><th>CNPJ/CPF</th><th>Obs.</th><th>Situação</th><th /></tr></thead>
        <tbody>{sups.map((s) => <tr key={s.id}><td><b>{s.name}</b></td><td>{s.phone ? <a href={`https://wa.me/55${s.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{s.phone}</a> : '—'}</td>
          <td>{s.doc || '—'}</td><td className="small muted">{s.note}</td><td>{s.active ? <span className="tag ok">Ativo</span> : <span className="tag">Inativo</span>}</td>
          <td className="r"><button className="btn btn-sm" onClick={() => setEdit({ ...s, active: !!s.active })}>Editar</button></td></tr>)}</tbody></table></div>
      {!sups.length && <div className="empty-mini">Cadastre o CEASA, a granja, o sítio… e lance as compras por fornecedor.</div>}
      {edit && <SupplierForm s={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); onChange(); }} />}
    </div>
  );
}

function SupplierForm({ s, onClose, onDone }: { s: any; onClose: () => void; onDone: (x?: any) => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ ...s }); const [err, setErr] = useState('');
  const save = async () => {
    if (!f.name.trim()) return setErr('Digite o nome do fornecedor.');
    const body = { name: f.name.trim(), phone: f.phone ?? '', doc: f.doc ?? '', note: f.note ?? '', active: !!f.active };
    try { const r = s.id ? await put(`/api/suppliers/${s.id}`, body) : await post('/api/suppliers', body); toast('Fornecedor salvo.'); onDone(r); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title={s.id ? `Editar ${s.name}` : 'Novo fornecedor'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Voltar</button><button className="btn btn-primary" onClick={save}>Salvar</button></>}>
      <label className="field">Nome<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus placeholder="Ex.: Ceasa — Box do Seu Antônio" /></label>
      <div className="grid2 tight">
        <label className="field">Telefone / WhatsApp<input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="field">CNPJ/CPF (opcional)<input className="input" value={f.doc} onChange={(e) => setF({ ...f, doc: e.target.value })} /></label>
      </div>
      <label className="field">Observação<input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Dia de entrega, forma de pagamento…" /></label>
      {s.id && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativo</label>}
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}
