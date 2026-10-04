import { useMemo, useRef, useState } from 'react';
import { Product, formatQty, formatBRL, resolveScan } from '@folha/shared';
import { matchProduct } from '../text';
import { Scanner, ScanReply } from './Scanner';
import { scanErr, scanOk, unlockAudio } from '../scan/feedback';
import { PIcon } from '../productPhotos';

/** acha o produto pelo código lido (EAN, código interno ou etiqueta de balança) */
function scanPick(raw: string, products: Product[], pick: (p: Product) => string | null): ScanReply {
  const r = resolveScan(raw, products);
  if (r.kind === 'unknown') { scanErr(); return { ok: false, msg: `Código ${r.code} não cadastrado. Cadastre em Produtos (📷 no campo EAN).` }; }
  const err = pick(r.product);
  if (err) { scanErr(); return { ok: false, msg: err }; }
  scanOk(); return { ok: true, msg: `✓ ${r.product.icon} ${r.product.name}` };
}

export function ProductPicker({ products, value, onChange }: { products: Product[]; value: number | null; onChange: (id: number | null) => void }) {
  const [f, setF] = useState('');
  const [scan, setScan] = useState(false);
  const list = useMemo(() => products.filter((p) => matchProduct(p, f)), [products, f]);
  return (
    <div className="row picker">
      <button type="button" className="btn" onClick={() => { unlockAudio(); setScan(true); }} aria-label="Ler código de barras com a câmera" title="Ler código com a câmera">📷</button>
      {scan && <Scanner title="Escolher produto pelo código" onClose={() => setScan(false)}
        onDetected={(c) => scanPick(c, products, (p) => { setF(''); onChange(p.id); return null; })} />}
      <input className="input" style={{ width: 170 }} placeholder="Filtrar…" value={f} onChange={(e) => {
        setF(e.target.value);
        const l = products.filter((p) => matchProduct(p, e.target.value)); if (l.length === 1) onChange(l[0].id);
      }} />
      <select className="input grow" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">— escolha o produto —</option>
        {list.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name} ({p.code}) · estoque {formatQty(p.stock_qty, p.unit)}{p.active ? '' : ' · INATIVO'}</option>)}
      </select>
    </div>
  );
}

/** Busca com lista: digita "maca" e toca no produto (sem acento, por nome/código/EAN) */
export function ProductSearch({ products, onPick, placeholder = 'Buscar produto para adicionar…', exclude = [] }: {
  products: Product[]; onPick: (p: Product) => void; placeholder?: string; exclude?: number[];
}) {
  const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const [hi, setHi] = useState(0);
  const [scan, setScan] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const list = useMemo(() => products.filter((p) => p.active && !exclude.includes(p.id) && matchProduct(p, q)).slice(0, 8), [products, q, exclude]);
  const pick = (p: Product) => { onPick(p); setQ(''); setOpen(false); setHi(0); ref.current?.focus(); };
  return (
    <div className="psearch">
      {scan && <Scanner title="Adicionar pelo código" continuous onClose={() => setScan(false)}
        onDetected={(c) => scanPick(c, products, (p) => (!p.active ? `${p.name} está inativo.` : exclude.includes(p.id) ? `${p.name} já está na lista.` : (onPick(p), null)))} />}
      <div className="field-scan">
      <input ref={ref} className="input" value={q} placeholder={placeholder} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && list[hi]) { e.preventDefault(); pick(list[hi]); }
          else if (e.key === 'Enter' && q.trim()) { e.preventDefault(); const r = resolveScan(q, products); if (r.kind !== 'unknown' && r.product.active && !exclude.includes(r.product.id)) pick(r.product); }
        }} />
      <button type="button" className="btn" onClick={() => { unlockAudio(); setScan(true); }} aria-label="Ler código de barras com a câmera" title="Ler código com a câmera">📷</button>
      </div>
      {open && q && <ul className="psearch-list" role="listbox">
        {list.map((p, i) => <li key={p.id} role="option" aria-selected={i === hi} className={i === hi ? 'hi' : ''} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
          <span className="em"><PIcon p={p} /></span><span className="grow"><b>{p.name}</b> <span className="small muted">cód. {p.code}</span></span>
          <span className="small muted num">{formatBRL(p.price_cents)} · tem {formatQty(p.stock_qty, p.unit)}</span></li>)}
        {!list.length && <li className="muted">Nenhum produto com “{q}”.</li>}
      </ul>}
    </div>
  );
}
