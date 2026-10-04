import { useEffect, useMemo, useState } from 'react';
import { del, fmtDateTime, get, post, put } from '../api';
import { matchProduct, norm } from '../text';
import { useApp } from '../ctx';
import { Modal } from '../components/Modal';
import { MoneyInput, QtyInput } from '../components/Inputs';
import { Category, formatBRL, formatQty, Product, UNIT_NAME, UNITS, Unit, UNIT_LABEL, isValidGtin, normalizeScan, parseScaleLabel, resolveScan, promoActive } from '@folha/shared';
import { Scanner } from '../components/Scanner';
import { Promotions } from './Promotions';
import { scanErr, scanOk } from '../scan/feedback';
import { PIcon } from '../productPhotos';

const ICONS = '🍅 🍌 🥬 🧅 🥔 🥕 🍊 🍎 🍋 🍉 🍇 🍐 🍍 🥭 🍓 🥒 🫑 🍆 🥦 🎃 🧄 🫚 🌿 🌶️ 🥚 🫘 🧀 🥖 💧 🥤 🛍️ 🧺 🍠 🥥 🥑 🌽 🍈 🍑 🍒 🥝'.split(' ');

const isMgrRole = (r?: string) => r === 'admin' || r === 'gerente';

export function Products({ tab: tabProp }: { tab?: string }) {
  const { toast, go, user } = useApp();
  const mgr = isMgrRole(user?.role);
  const [delP, setDelP] = useState<Product | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [list, setList] = useState<Product[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [q, setQ] = useState(''); const [cat, setCat] = useState<number | ''>('');
  const [edit, setEdit] = useState<Partial<Product> | null>(null);
  const [scan, setScan] = useState(false);
  const blank = (extra: Partial<Product> = {}): Partial<Product> => ({ unit: 'KG', active: true, category_id: cats[0]?.id, price_cents: 0, cost_cents: 0, min_stock: 3000, icon: '🧺', ...extra });
  /** lê na câmera: achou → abre o produto; não achou → novo produto com o EAN preenchido */
  const onScanList = (raw: string) => {
    const r = resolveScan(raw, list);
    if (r.kind !== 'unknown') { scanOk(); setScan(false); setEdit(r.product); return { close: true }; }
    scanErr(); setScan(false);
    setEdit(blank({ unit: 'UN', min_stock: 5000, ean: r.code, code: suggestCode(list) }));
    toast(`Código ${r.code} não está cadastrado: preencha o novo produto.`);
    return { close: true };
  };
  const tab = tabProp === 'atalhos' || tabProp === 'precos' || tabProp === 'promocoes' ? tabProp : 'lista';
  const setTab = (t: string) => go(`produtos/${t}`);
  const load = () => Promise.all([get('/api/products'), get('/api/categories')]).then(([p, c]) => { setList(p); setCats(c); }).catch((e) => toast(e.message, 'erro'));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const shown = useMemo(() => list.filter((p) => (!cat || p.category_id === cat) &&
    matchProduct(p, q)), [list, q, cat]);

  return (
    <div className="page">
      <div className="page-title"><h1>🥕 Produtos</h1>
        <div className="tabs"><button className={tab === 'lista' ? 'on' : ''} onClick={() => setTab('lista')}>Cadastro</button>
          <button className={tab === 'precos' ? 'on' : ''} onClick={() => setTab('precos')}>🏷 Preço do dia</button>
          <button className={tab === 'promocoes' ? 'on' : ''} onClick={() => setTab('promocoes')}>🔥 Promoções</button>
          <button className={tab === 'atalhos' ? 'on' : ''} onClick={() => setTab('atalhos')}>Atalhos da banca (24)</button></div>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => setEdit(blank())}>+ Novo produto</button>
      </div>
      {tab === 'lista' ? (
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="input grow" placeholder="Buscar por nome, código ou EAN" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn" onClick={() => setScan(true)} title="Ler o código de barras com a câmera e abrir o produto">📷 Ler código</button>
            <select className="input" style={{ width: 220 }} value={cat} onChange={(e) => setCat(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Todas as categorias</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {mgr && <button className={`btn ${showDeleted ? 'btn-primary' : ''}`} onClick={() => setShowDeleted((v) => !v)} data-testid="show-deleted"
              title="Ver produtos apagados que têm histórico e restaurar">{showDeleted ? '← Voltar aos produtos' : '🗑 Mostrar apagados'}</button>}
          </div>
          {showDeleted ? <DeletedList q={q} onRestored={load} /> : <table className="t">
            <thead><tr><th>Cód.</th><th>Produto</th><th>Categoria</th><th>Un.</th><th className="r">Preço</th><th className="r">Custo</th><th className="r">Estoque</th><th>Atalho</th><th>Situação</th>{mgr && <th aria-label="Apagar" />}</tr></thead>
            <tbody>{shown.map((p) => (
              <tr key={p.id} className="click" onClick={() => setEdit(p)}>
                <td>{p.code}</td><td><b><PIcon p={p} /> {p.name}</b>{p.ean && <div className="small muted">EAN {p.ean}</div>}</td>
                <td><span className="tag" style={{ background: `color-mix(in srgb, ${p.category_color} 22%, white)` }}>{p.category_name}</span></td>
                <td>{UNIT_LABEL[p.unit]}</td><td className="r">{formatBRL(p.price_cents)}{p.unit === 'KG' ? '/kg' : ''}{promoActive(p) && <div className="small"><span className="promo-badge">PROMO</span> <b className="promo-price">{formatBRL(p.promo_price_cents!)}</b></div>}</td><td className="r">{formatBRL(p.cost_cents)}</td>
                <td className={`r ${p.stock_qty <= p.min_stock ? 'neg' : ''}`}>{formatQty(p.stock_qty, p.unit)}</td>
                <td>{p.shortcut_pos ?? '—'}</td><td>{p.active ? <span className="tag ok">Ativo</span> : <span className="tag bad">Inativo</span>}</td>
                {mgr && <td className="r"><button className="btn btn-sm btn-ghost row-del" title={`Apagar ${p.name}`} aria-label={`Apagar ${p.name}`}
                  onClick={(e) => { e.stopPropagation(); setDelP(p); }}>🗑</button></td>}
              </tr>))}</tbody>
          </table>}
        </div>
      ) : tab === 'precos' ? <PriceEditor products={list} cats={cats} onSaved={load} /> : tab === 'promocoes' ? <Promotions /> : <ShortcutEditor products={list} onSaved={load} />}
      {edit && <ProductForm initial={edit} cats={cats} products={list} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }}
        onDeleted={() => { setEdit(null); load(); }} />}
      {delP && <DeleteProduct product={delP} onClose={() => setDelP(null)} onDeleted={() => { setDelP(null); load(); }} />}
      {scan && <Scanner title="Achar produto pelo código" onClose={() => setScan(false)} onDetected={onScanList} />}
    </div>
  );
}

/** próximo código numérico livre (sugestão para produto novo) */
export const suggestCode = (list: Product[]) => String(list.reduce((m, p) => (/^\d{1,6}$/.test(p.code) ? Math.max(m, Number(p.code)) : m), 0) + 1);

/** avisos do campo EAN: dígito verificador errado, etiqueta de balança, código já usado */
function eanWarning(ean: string, others: Product[], selfId?: number): string | null {
  if (!ean) return null;
  const dup = others.find((o) => o.id !== selfId && (o.ean === ean || o.code === ean));
  if (dup) return `Esse código já está no produto “${dup.name}”.`;
  if (/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(ean) && !isValidGtin(ean)) return 'O dígito verificador não confere: confira o número (ou leia com a câmera).';
  if (/^2\d{12}$/.test(ean) && parseScaleLabel(ean)) return 'Começa com 2: parece etiqueta de balança (muda a cada pesagem). Para produto pesado, use o Código (PLU) acima em vez do EAN.';
  return null;
}

export function ProductForm({ initial, cats, products = [], onClose, onSaved, onDeleted, note }: { initial: Partial<Product>; cats: Category[]; products?: Product[]; onClose: () => void; onSaved: (p?: Product) => void; onDeleted?: () => void; note?: string }) {
  const { toast, user } = useApp();
  const [scan, setScan] = useState(false);
  const [askDel, setAskDel] = useState(false);
  const canDelete = !!onDeleted && !!initial.id && isMgrRole(user?.role);
  const [p, setP] = useState<any>({ ncm: '', cfop: '', cst: '', ean: '', ...initial });
  const [initialStock, setInitialStock] = useState(0);
  const [err, setErr] = useState('');
  const set = (k: string, v: any) => setP((x: any) => ({ ...x, [k]: v }));
  const kg = p.unit === 'KG';
  const margin = p.price_cents ? Math.round(((p.price_cents - p.cost_cents) / p.price_cents) * 100) : 0;
  const save = async () => {
    setErr('');
    const body = { code: String(p.code ?? ''), ean: p.ean || null, name: p.name ?? '', category_id: Number(p.category_id), unit: p.unit as Unit,
      price_cents: p.price_cents, cost_cents: p.cost_cents, min_stock: p.min_stock ?? 0, active: !!p.active, allow_negative: !!p.allow_negative,
      shortcut_pos: p.shortcut_pos ? Number(p.shortcut_pos) : null, icon: p.icon ?? '', ncm: p.ncm || null, cfop: p.cfop || null, cst: p.cst || null,
      ...(p.id ? {} : { initial_stock: initialStock }) };
    try { const saved = p.id ? await put(`/api/products/${p.id}`, body) : await post('/api/products', body); toast('Produto salvo.'); onSaved(saved); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title={p.id ? `Editar · ${p.name}` : 'Novo produto'} onClose={onClose} size="wide"
      footer={<>{canDelete && <><button className="btn btn-danger" onClick={() => setAskDel(true)} data-testid="product-delete">🗑 Apagar produto</button><span className="spacer hide-phone" /></>}
        <button className="btn" onClick={onClose}>Voltar</button><button className="btn btn-primary" onClick={save}>Salvar produto</button></>}>
      {note && <div className="ok-box small">{note}</div>}
      <div className="grid3">
        <label className="field">Código (PLU da balança)<input className="input" value={p.code ?? ''} onChange={(e) => set('code', e.target.value)} autoFocus /></label>
        <div className="field"><label htmlFor="pf-ean">Código de barras (EAN)</label>
          <div className="field-scan"><input id="pf-ean" className="input" inputMode="numeric" placeholder="Leia ou digite" value={p.ean ?? ''} data-testid="ean"
            onChange={(e) => set('ean', e.target.value.replace(/[^0-9A-Za-z\-._/]/g, '').slice(0, 64))} />
            <button type="button" className="btn" onClick={() => setScan(true)} aria-label="Ler código de barras com a câmera" title="Ler com a câmera">📷</button></div>
          {eanWarning(p.ean ?? '', products, p.id) && <span className="warn-mini">{eanWarning(p.ean ?? '', products, p.id)}</span>}</div>
        <label className="field">Categoria<select className="input" value={p.category_id ?? ''} onChange={(e) => set('category_id', Number(e.target.value))}>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select></label>
      </div>
      <div className="grid3">
        <label className="field" style={{ gridColumn: 'span 2' }}>Nome<input className="input" value={p.name ?? ''} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="field">Unidade<select className="input" value={p.unit} onChange={(e) => set('unit', e.target.value)}>
          {UNITS.map((u) => <option key={u} value={u}>{UNIT_NAME[u]}</option>)}</select></label>
      </div>
      <div className="grid3">
        <label className="field">{kg ? 'Preço por kg' : `Preço por ${UNIT_LABEL[p.unit as Unit]}`}<MoneyInput value={p.price_cents ?? 0} onChange={(v) => set('price_cents', v)} /></label>
        <label className="field">Custo {kg ? 'por kg' : 'unitário'} <MoneyInput value={p.cost_cents ?? 0} onChange={(v) => set('cost_cents', v)} /></label>
        <div className="field" style={{ justifyContent: 'flex-end' }}><div className="stat" style={{ padding: '8px 12px' }}><div className="lbl">Margem estimada</div><div className="val" style={{ fontSize: 22 }}>{margin}%</div></div></div>
      </div>
      <div className="grid3">
        <label className="field">Estoque mínimo ({kg ? 'kg' : UNIT_LABEL[p.unit as Unit]})<QtyInput kg={kg} value={p.min_stock ?? 0} onChange={(v) => set('min_stock', v)} /></label>
        {!p.id ? <label className="field">Estoque inicial<QtyInput kg={kg} value={initialStock} onChange={setInitialStock} /></label>
          : <div className="field"><span>Estoque atual</span><div className="input num" style={{ display: 'flex', alignItems: 'center', background: 'var(--creme-2)' }}>{formatQty(p.stock_qty, p.unit)}</div></div>}
        <label className="field">Atalho da banca (1–24)<select className="input" value={p.shortcut_pos ?? ''} onChange={(e) => set('shortcut_pos', e.target.value ? Number(e.target.value) : null)}>
          <option value="">Sem atalho</option>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i + 1}>Posição {i + 1}</option>)}</select></label>
      </div>
      <div className="field"><span>Ícone do atalho</span>
        <div className="row wrap" style={{ gap: 4 }}>{ICONS.map((ic) => (
          <button key={ic} type="button" className="btn btn-sm" style={{ fontSize: 22, minWidth: 48, borderColor: p.icon === ic ? 'var(--folha)' : undefined, background: p.icon === ic ? 'var(--folha-clara)' : undefined }} onClick={() => set('icon', ic)}>{ic}</button>))}</div>
      </div>
      <div className="row wrap">
        <label className="check"><input type="checkbox" checked={!!p.active} onChange={(e) => set('active', e.target.checked)} /> Ativo (pode vender)</label>
        <label className="check"><input type="checkbox" checked={!!p.allow_negative} onChange={(e) => set('allow_negative', e.target.checked)} /> Pode vender sem estoque (negativo)</label>
      </div>
      <details><summary className="muted" style={{ cursor: 'pointer', fontWeight: 700, minHeight: 32 }}>Dados fiscais (só guardados, para NFC-e futura)</summary>
        <div className="grid3" style={{ marginTop: 8 }}>
          <label className="field">NCM<input className="input" value={p.ncm ?? ''} onChange={(e) => set('ncm', e.target.value)} /></label>
          <label className="field">CFOP<input className="input" value={p.cfop ?? ''} onChange={(e) => set('cfop', e.target.value)} /></label>
          <label className="field">CST / CSOSN<input className="input" value={p.cst ?? ''} onChange={(e) => set('cst', e.target.value)} /></label>
        </div></details>
      {err && <div className="err">{err}</div>}
      {scan && <Scanner title={`Código de barras${p.name ? ' · ' + p.name : ''}`} onClose={() => setScan(false)}
        onDetected={(raw) => { const c = normalizeScan(raw); scanOk(); set('ean', c); toast(`Código ${c} preenchido. Toque em Salvar produto.`); return { close: true }; }} />}
      {askDel && <DeleteProduct product={initial as Product} onClose={() => setAskDel(false)} onDeleted={() => { setAskDel(false); onDeleted?.(); }} />}
    </Modal>
  );
}

function ShortcutEditor({ products, onSaved }: { products: Product[]; onSaved: () => void }) {
  const { toast } = useApp();
  const [slots, setSlots] = useState<(number | null)[]>(() => Array(24).fill(null));
  const [sug, setSug] = useState<any[]>([]);
  useEffect(() => {
    const s: (number | null)[] = Array(24).fill(null);
    for (const p of products) if (p.shortcut_pos) s[p.shortcut_pos - 1] = p.id;
    setSlots(s);
  }, [products]);
  useEffect(() => { get('/api/shortcuts/suggest').then(setSug).catch(() => {}); }, []);
  const byId = new Map(products.map((p) => [p.id, p]));
  const save = async () => {
    try { await put('/api/shortcuts', { slots: slots.map((id, i) => ({ pos: i + 1, product_id: id })) }); toast('Atalhos salvos.'); onSaved(); }
    catch (e: any) { toast(e.message, 'erro'); }
  };
  const applySuggest = () => {
    const s: (number | null)[] = Array(24).fill(null);
    sug.slice(0, 24).forEach((x, i) => { s[i] = x.id; });
    setSlots(s);
  };
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="grow muted">Escolha os 24 itens que mais saem. A cor vem da categoria.</div>
        <button className="btn" disabled={!sug.length} onClick={applySuggest}>Sugerir pelos mais vendidos (30 dias)</button>
        <button className="btn btn-primary" onClick={save}>Salvar atalhos</button>
      </div>
      <div className="tiles" style={{ gridAutoRows: '128px' }}>
        {slots.map((id, i) => {
          const p = id ? byId.get(id) : null;
          return (
            <div key={i} className={`tile ${p ? '' : 'empty'}`} style={p ? { ['--c' as any]: p.category_color } : undefined}>
              <span className="pos">{i + 1}</span>
              {p && <><span className="em"><PIcon p={p} /></span><span className="nm" style={{ fontSize: 14 }}>{p.name}</span></>}
              <select className="input" style={{ minHeight: 34, fontSize: 13, padding: '0 6px', marginTop: 4 }} value={id ?? ''}
                onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setSlots((s) => s.map((x, j) => (j === i ? v : x === v && v ? null : x))); }}>
                <option value="">— livre —</option>{products.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Preço do dia: a lista inteira editável; salva todas as mudanças de uma vez (com auditoria de antes/depois). */
function PriceEditor({ products, cats, onSaved }: { products: Product[]; cats: Category[]; onSaved: () => void }) {
  const { toast, go } = useApp();
  const [draft, setDraft] = useState<Record<number, number>>({});
  const [q, setQ] = useState(''); const [cat, setCat] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const active = useMemo(() => products.filter((p) => p.active).sort((a, b) => (a.category_id - b.category_id) || norm(a.name).localeCompare(norm(b.name))), [products]);
  const shown = active.filter((p) => (!cat || p.category_id === cat) && matchProduct(p, q));
  const changed = active.filter((p) => draft[p.id] != null && draft[p.id] !== p.price_cents);
  const priceOf = (p: Product) => draft[p.id] ?? p.price_cents;
  const bump = (pct: number) => setDraft((d) => {
    const n = { ...d };
    for (const p of shown) { const v = Math.round((priceOf(p) * (100 + pct)) / 100 / 10) * 10 - (pct ? 1 : 0); n[p.id] = Math.max(0, v); }
    return n;
  });
  const save = async () => {
    setBusy(true);
    try {
      const r = await put('/api/prices', { items: changed.map((p) => ({ id: p.id, price_cents: draft[p.id] })) });
      toast(`${r.changed} preço(s) atualizado(s). Já valem na venda.`); setDraft({}); onSaved();
    } catch (e: any) { toast(e.message, 'erro'); } finally { setBusy(false); }
  };
  const catName = (id: number) => cats.find((c) => c.id === id)?.name ?? '';
  let lastCat = -1;
  return (
    <div className="card col">
      <div className="row wrap">
        <input className="input grow" style={{ minWidth: 180 }} placeholder="Buscar (ex.: tomate, banana)" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 200 }} value={cat} onChange={(e) => setCat(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Todas as categorias</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <div className="row" style={{ gap: 6 }}><span className="small muted">Na lista:</span>
          <button className="btn btn-sm" onClick={() => bump(-10)}>−10%</button><button className="btn btn-sm" onClick={() => bump(10)}>+10%</button></div>
      </div>
      <div className="row small muted">Toque no preço e digite o novo (ex.: 799 = R$ 7,99). O que mudou fica destacado; nada muda até você salvar.
        <span className="spacer" /><button className="btn btn-sm" onClick={() => go('promocoes')}>🔥 Promoções</button></div>
      <div className="prices">
        {shown.map((p) => {
          const v = priceOf(p); const ch = v !== p.price_cents;
          const margin = v > 0 ? Math.round(((v - p.cost_cents) / v) * 100) : 0;
          const head = p.category_id !== lastCat ? (lastCat = p.category_id, <div key={`c${p.category_id}`} className="price-cat">{catName(p.category_id)}</div>) : null;
          return [head, (
            <div key={p.id} className={`price-row ${ch ? 'changed' : ''}`}>
              <span className="em"><PIcon p={p} /></span>
              <span className="grow pn"><b>{p.name}</b><small className="muted">{UNIT_NAME[p.unit as Unit] ?? p.unit} · custo {formatBRL(p.cost_cents)} · margem <span className={margin < 15 ? 'neg' : ''}>{margin}%</span></small>
                {promoActive(p) && <small><span className="promo-badge">PROMO</span> valendo <b className="promo-price">{formatBRL(p.promo_price_cents!)}</b> (o preço normal abaixo volta quando acabar)</small>}</span>
              {ch && <span className="old num">{formatBRL(p.price_cents)}</span>}
              <MoneyInput className="price-in" value={v} onChange={(c) => setDraft((d) => ({ ...d, [p.id]: c }))} aria-label={`Preço de ${p.name}`} />
              {ch && <button className="btn btn-sm btn-ghost" title="Desfazer" onClick={() => setDraft((d) => { const n = { ...d }; delete n[p.id]; return n; })}>↺</button>}
            </div>)];
        })}
        {!shown.length && <div className="empty-mini">Nenhum produto com “{q}”.</div>}
      </div>
      <div className="save-bar">
        <span className="grow"><b>{changed.length}</b> preço(s) alterado(s)</span>
        {changed.length > 0 && <button className="btn" onClick={() => setDraft({})}>Desfazer tudo</button>}
        <button className="btn btn-primary btn-big" disabled={!changed.length || busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar preços do dia'}</button>
      </div>
    </div>
  );
}

interface Usage { sales: number; movements: number; lots: number; losses: number; has_history: boolean }
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Confirmação do "Apagar produto": confere o histórico antes e explica o que vai acontecer. */
export function DeleteProduct({ product: p, onClose, onDeleted }: { product: Product; onClose: () => void; onDeleted: () => void }) {
  const { toast } = useApp();
  const [u, setU] = useState<Usage | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { get<Usage>(`/api/products/${p.id}/usage`).then(setU).catch((e) => setErr(e.message)); }, [p.id]);
  const hist = u && [u.sales && plural(u.sales, 'venda', 'vendas'), u.movements && plural(u.movements, 'movimento de estoque', 'movimentos de estoque'),
    u.lots && plural(u.lots, 'lote', 'lotes'), u.losses && plural(u.losses, 'perda', 'perdas')].filter(Boolean).join(', ');
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await del<{ mode: 'hard' | 'soft' }>(`/api/products/${p.id}`);
      toast(r.mode === 'hard' ? `${p.name} apagado.` : `${p.name} apagado. O histórico continua nos relatórios.`);
      onDeleted();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const codes = (cap = false) => <>{cap ? 'O' : 'o'} código <b>{p.code}</b>{p.ean ? <> e o código de barras <b>{p.ean}</b></> : null}</>;
  return (
    <Modal title="Apagar produto?" onClose={busy ? undefined : onClose} size="mid" z={60}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Voltar</button>
        <button className="btn btn-danger solid" onClick={go} disabled={!u || busy} data-testid="confirm-delete">{busy ? 'Apagando…' : `🗑 Apagar ${p.name}`}</button></>}>
      <div className="del-confirm" data-testid="delete-dialog">
        <div className="del-name"><PIcon p={p} /> {p.name} <span className="muted small">cód. {p.code}</span></div>
        {!u && !err && <p className="muted">Conferindo o histórico do produto…</p>}
        {u && !u.has_history && <>
          <p>Este produto <b>nunca foi vendido, comprado nem teve estoque mexido</b>. Ele será <b>apagado de vez</b>{p.shortcut_pos ? <> e sai do atalho {p.shortcut_pos}</> : null}.</p>
          <p>Depois disso, {codes()} {p.ean ? 'ficam livres' : 'fica livre'} para outro produto.</p>
          <p className="muted small">Isto não dá para desfazer (mas dá para cadastrar de novo).</p>
        </>}
        {u && u.has_history && <>
          <p>Este produto <b>já tem histórico</b> ({hist}). Por isso ele não é apagado do passado: <b>as vendas e relatórios antigos continuam mostrando o nome</b>.</p>
          <p>Ele <b>some</b> da venda, da busca, da leitura de código de barras, dos atalhos, do Preço do dia e da lista de produtos.</p>
          <p>{codes(true)} {p.ean ? 'ficam livres' : 'fica livre'} para outro produto.</p>
          <p className="muted small">Mudou de ideia depois? Em Produtos › 🗑 Mostrar apagados › Restaurar.</p>
        </>}
        {err && <div className="err">{err}</div>}
      </div>
    </Modal>
  );
}

/** Produtos apagados que têm histórico: dá para restaurar. */
function DeletedList({ q, onRestored }: { q: string; onRestored: () => void }) {
  const { toast } = useApp();
  const [rows, setRows] = useState<any[] | null>(null);
  const load = () => get<any[]>('/api/products?deleted=1').then(setRows).catch((e) => { toast(e.message, 'erro'); setRows([]); });
  useEffect(() => { load(); }, []); // eslint-disable-line
  const restore = async (p: any) => {
    try {
      const r = await post<any>(`/api/products/${p.id}/restore`);
      toast(r?.warning ? `${p.name} restaurado. ${r.warning}` : `${p.name} restaurado (ficou ativo, sem atalho).`); load(); onRestored();
    } catch (e: any) { toast(e.message, 'erro'); }
  };
  const shown = (rows ?? []).filter((p) => !q.trim() || norm(p.name).includes(norm(q)));
  if (!rows) return <p className="muted">Carregando…</p>;
  if (!shown.length) return <div className="muted del-empty" data-testid="deleted-empty">Nenhum produto apagado{q ? ' com esse nome' : ''}. (Produto apagado sem histórico some de vez e não aparece aqui.)</div>;
  return (
    <table className="t" data-testid="deleted-list">
      <thead><tr><th>Cód. antigo</th><th>Produto</th><th>Categoria</th><th className="r">Preço</th><th>Apagado em</th><th /></tr></thead>
      <tbody>{shown.map((p) => (
        <tr key={p.id}>
          <td>{p.original_code ?? p.code}</td><td><b><PIcon p={p} /> {p.name}</b>{p.original_ean && <div className="small muted">EAN {p.original_ean}</div>}</td>
          <td>{p.category_name}</td><td className="r">{formatBRL(p.price_cents)}{p.unit === 'KG' ? '/kg' : ''}</td>
          <td>{p.deleted_at ? fmtDateTime(p.deleted_at) : '—'}</td>
          <td className="r"><button className="btn btn-sm" onClick={() => restore(p)}>↩ Restaurar</button></td>
        </tr>))}</tbody>
    </table>
  );
}
