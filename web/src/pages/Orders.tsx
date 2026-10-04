// v3.3: Encomendas — cadastro, "Chegou" (abre o WhatsApp com a mensagem pronta), Pronta, Concluir (vira venda + comprovante).
import { useEffect, useMemo, useState } from 'react';
import { get, post, put } from '../api';
import { useApp } from '../ctx';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/Inputs';
import { ProductSearch } from '../components/ProductPicker';
import { SaleDoneModal } from '../components/Comprovante';
import { ReceiptModal } from './ReceiptModal';
import { norm } from '../text';
import { PIcon } from '../productPhotos';
import {
  DELIVERY_LABEL, formatBRL, formatKg, kgEntryHint, lineValue, maskPhone, ORDER_STATUS_LABEL, orderArrivedText, orderItemsText, parseKgEntry,
  parseUnitEntry, PAYMENT_LABEL, PaymentMethod, phoneDigits, Product, qtyToEntry, UNIT_LABEL, Unit, validPhone, waLink, withPromo,
} from '@folha/shared';

interface OItem { id?: number; product_id: number | null; name: string; unit: string; qty: number | null; line_cents: number | null; icon?: string; price_cents?: number }
interface Order {
  id: number; customer_id: number | null; customer_name: string; phone: string; paid: boolean; paid_method: string | null; delivery: string; address: string; note: string;
  status: string; notified_at: string | null; notified_count: number; ready_at: string | null; concluded_at: string | null; canceled_at: string | null; cancel_reason: string | null;
  sale_id: number | null; sale_number: number | null; imported: boolean; created_at: string; created_by_name: string | null; items: OItem[]; total_cents: number | null;
}
const PENDING = ['AGUARDANDO', 'AVISADA', 'PRONTA'];
const TABS: [string, string, string[]][] = [
  ['pendentes', 'Pendentes', PENDING], ['AGUARDANDO', 'Aguardando', ['AGUARDANDO']], ['AVISADA', 'Chegou · avisado', ['AVISADA']],
  ['PRONTA', 'Prontas', ['PRONTA']], ['CONCLUIDA', 'Concluídas', ['CONCLUIDA']], ['CANCELADA', 'Canceladas', ['CANCELADA']],
];
const dm = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}` : '');
const PAY_NOW: PaymentMethod[] = ['dinheiro', 'pix', 'debito', 'credito', 'fiado'];
const PAY_BEFORE: PaymentMethod[] = ['dinheiro', 'pix', 'debito', 'credito'];
const ICON: Record<string, string> = { dinheiro: '💵', pix: '⚡', debito: '💳', credito: '💳', fiado: '📒', voucher: '🎫' };

export function Orders() {
  const { toast, status, refreshStatus } = useApp();
  const [rows, setRows] = useState<Order[] | null>(null);
  const [tab, setTab] = useState('pendentes');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Order | 'new' | null>(null);
  const [notify, setNotify] = useState<Order | null>(null);
  const [conclude, setConclude] = useState<Order | null>(null);
  const [cancel, setCancel] = useState<Order | null>(null);
  const [done, setDone] = useState<any>(null);
  const [printId, setPrintId] = useState<number | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const load = () => get<Order[]>('/api/orders').then((r) => { setRows(r); setErr(''); refreshStatus(); })
    .catch((e) => { setRows([]); setErr(e.status === 404 ? 'Encomendas precisam do modo online (Supabase).' : e.message); });
  useEffect(() => { load(); }, []); // eslint-disable-line
  const count = (st: string[]) => (rows ?? []).filter((o) => st.includes(o.status)).length;
  const shown = useMemo(() => {
    const st = TABS.find((t) => t[0] === tab)![2]; const t = norm(q.trim()); const d = q.replace(/\D/g, '');
    return (rows ?? []).filter((o) => st.includes(o.status) && (!t || norm(o.customer_name).includes(t) || norm(orderItemsText(o.items)).includes(t) || (d.length >= 3 && o.phone.includes(d))))
      .sort((a, b) => (PENDING.includes(a.status) ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
  }, [rows, tab, q]);
  const act = async (o: Order, what: 'ready') => {
    try { await post(`/api/orders/${o.id}/${what}`); toast(`${o.customer_name}: pronta para entregar.`); load(); } catch (e: any) { toast(e.message, 'erro'); }
  };

  return (
    <div className="page">
      <div className="page-title"><h1>📦 Encomendas</h1><span className="spacer" />
        <button className="btn btn-primary" onClick={() => setEdit('new')} data-testid="order-new">+ Nova encomenda</button></div>
      <div className="card">
        <div className="row wrap" style={{ gap: 8 }}>
          <div className="tabs orders-tabs">{TABS.map(([k, l, st]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} ({count(st)})</button>)}</div>
          <input className="input grow" style={{ minWidth: 200 }} placeholder="Buscar por cliente, telefone ou produto" value={q} onChange={(e) => setQ(e.target.value)} data-testid="order-search" />
        </div>
        {err && <div className="err">{err}</div>}
        {rows === null ? <p className="muted">Carregando…</p> : !shown.length ? <div className="promo-empty muted">Nenhuma encomenda {TABS.find((t) => t[0] === tab)![1].toLowerCase()}.</div> : (
          <div className="orders" data-testid="orders">
            {shown.map((o) => (
              <div key={o.id} className={`order-card st-${o.status.toLowerCase()}`} data-testid="order-card">
                <div className="row oc-head">
                  <b className="grow">{o.customer_name}</b>
                  <span className={`tag ost-${o.status.toLowerCase()}`}>{ORDER_STATUS_LABEL[o.status]}</span>
                </div>
                <div className="small muted">nº {o.id} · {dm(o.created_at)}{o.phone ? <> · <a href={`https://wa.me/55${o.phone}`} target="_blank" rel="noopener">{maskPhone(o.phone)}</a></> : null}</div>
                <ul className="oc-items">{o.items.map((it, i) => <li key={i}><span>{it.product_id ? <PIcon p={it} fallback="•" /> : (it.icon ?? '•')} {it.qty ? `${it.unit === 'KG' ? `${formatKg(it.qty)} kg` : `${it.qty / 1000} ${UNIT_LABEL[it.unit as Unit] ?? it.unit}`} · ` : ''}{it.name}</span>
                  <span className="num">{it.line_cents != null ? formatBRL(it.line_cents) : '—'}</span></li>)}</ul>
                <div className="row wrap oc-tags">
                  <b className="num">{o.total_cents != null ? formatBRL(o.total_cents) : 'valor a definir'}</b>
                  {o.paid ? <span className="tag ok">Pago{o.paid_method ? ` · ${PAYMENT_LABEL[o.paid_method as PaymentMethod]}` : ''}</span>
                    : o.status === 'CONCLUIDA' && o.imported ? <span className="tag bad" data-testid="unpaid-flag">Não pago</span>
                    : o.status === 'CONCLUIDA' ? <span className="tag">Fiado</span> : <span className="tag warn">A pagar</span>}
                  <span className="tag">{o.delivery === 'entrega' ? '🛵 ' : o.delivery === 'buscar' ? '🚶 ' : ''}{DELIVERY_LABEL[o.delivery]}</span>
                  {o.imported && <span className="tag">Sistema antigo</span>}
                </div>
                {o.delivery === 'entrega' && o.address && <div className="small">📍 {o.address}</div>}
                {o.note && <div className="small muted">📝 {o.note}</div>}
                {o.notified_at && <div className="small muted">📣 avisado em {dm(o.notified_at)}{o.notified_count > 1 ? ` (${o.notified_count}x)` : ''}</div>}
                {o.status === 'CONCLUIDA' && <div className="small muted">✅ concluída {dm(o.concluded_at)}{o.sale_number ? ` · venda nº ${o.sale_number}` : ''}</div>}
                {o.status === 'CANCELADA' && <div className="small muted">✕ cancelada {dm(o.canceled_at)}{o.cancel_reason ? ` · ${o.cancel_reason}` : ''}</div>}
                <div className="row wrap oc-actions">
                  {PENDING.includes(o.status) && <button className={`btn ${o.status === 'AGUARDANDO' ? 'btn-primary' : ''}`} onClick={() => setNotify(o)} data-testid="order-arrived">
                    {o.status === 'AGUARDANDO' ? '📣 Chegou · avisar' : '📲 Avisar de novo'}</button>}
                  {o.status === 'AVISADA' && <button className="btn" onClick={() => act(o, 'ready')} data-testid="order-ready">📦 Pronta</button>}
                  {o.status !== 'AGUARDANDO' && PENDING.includes(o.status) && <button className="btn btn-primary" onClick={() => setConclude(o)} data-testid="order-conclude">✅ Concluir</button>}
                  {o.status === 'AGUARDANDO' && <button className="btn" onClick={() => setConclude(o)} data-testid="order-conclude">✅ Concluir</button>}
                  {PENDING.includes(o.status) && <button className="btn btn-ghost" onClick={() => setEdit(o)}>Editar</button>}
                  {PENDING.includes(o.status) && <button className="btn btn-ghost btn-danger" onClick={() => setCancel(o)}>Cancelar</button>}
                  {o.status === 'CONCLUIDA' && o.sale_id && <button className="btn btn-sm" onClick={() => setView(o.sale_id)}>🧾 Comprovante</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {edit && <OrderForm order={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={(o, isNew) => { setEdit(null); load(); if (isNew) toast(`Encomenda de ${o.customer_name} salva.`); }} />}
      {notify && <NotifyModal order={notify} store={status?.store?.name ?? ''} onClose={() => setNotify(null)} onSent={() => { setNotify(null); load(); }} />}
      {conclude && <ConcludeModal order={conclude} onClose={() => setConclude(null)} onDone={(r) => { setConclude(null); load(); setDone(r.sale); }} />}
      {cancel && <CancelModal order={cancel} onClose={() => setCancel(null)} onDone={() => { setCancel(null); load(); }} />}
      {done && <SaleDoneModal sale={done} title={`📦 Encomenda concluída · venda nº ${done.number}`} onClose={() => setDone(null)} onPrint={() => { setPrintId(done.id); setDone(null); }} />}
      {printId && <ReceiptModal saleId={printId} autoPrint onClose={() => setPrintId(null)} />}
      {view && <ReceiptModal saleId={view} onClose={() => setView(null)} />}
    </div>
  );
}

// ---------- quantidade digitada (kg ou un) com teclado decimal do Android ----------
function SmartQty({ unit, value, onChange }: { unit: string; value: number | null; onChange: (q: number) => void }) {
  const kg = unit === 'KG';
  const [txt, setTxt] = useState(() => (value ? qtyToEntry(value, kg) : ''));
  useEffect(() => { setTxt(value ? qtyToEntry(value, kg) : ''); }, [kg]); // eslint-disable-line
  return (
    <span className="sqty">
      <input className="input num" inputMode="decimal" value={txt} placeholder={kg ? 'ex.: 1,5' : '1'} aria-label="Quantidade" onFocus={(e) => e.target.select()}
        onChange={(e) => { const t = e.target.value.replace(/[^\d,.]/g, ''); setTxt(t); onChange(kg ? parseKgEntry(t) : parseUnitEntry(t)); }}
        onBlur={() => value && setTxt(qtyToEntry(value, kg))} />
      <span className="small muted">{kg ? (txt && !/[.,]/.test(txt) ? kgEntryHint(txt) : 'kg') : UNIT_LABEL[unit as Unit] ?? 'un'}</span>
    </span>
  );
}

function OrderForm({ order, onClose, onSaved }: { order: Order | null; onClose: () => void; onSaved: (o: Order, isNew: boolean) => void }) {
  const { toast } = useApp();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [name, setName] = useState(order?.customer_name ?? '');
  const [customerId, setCustomerId] = useState<number | null>(order?.customer_id ?? null);
  const [phone, setPhone] = useState(order ? maskPhone(order.phone) : '');
  const [items, setItems] = useState<(OItem & { manual?: boolean })[]>(() => (order?.items ?? []).map((i) => ({ ...i, manual: true })));
  const [paid, setPaid] = useState(order?.paid ?? false);
  const [method, setMethod] = useState<string>(order?.paid_method ?? 'pix');
  const [delivery, setDelivery] = useState(order?.delivery ?? 'a_combinar');
  const [address, setAddress] = useState(order?.address ?? '');
  const [note, setNote] = useState(order?.note ?? '');
  const [free, setFree] = useState(''); const [freeUnit, setFreeUnit] = useState<'UN' | 'KG'>('UN');
  const [sug, setSug] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    get<Product[]>('/api/products?active=1').then((p) => setProducts(p.map((x) => withPromo(x)))).catch(() => {});
    get<any[]>('/api/customers').then((c) => setCustomers(c.filter((x) => x.active))).catch(() => {});
  }, []);
  const matches = useMemo(() => { const t = norm(name.trim()); return t.length < 2 ? [] : customers.filter((c) => norm(c.name).includes(t)).slice(0, 5); }, [customers, name]);
  const addProduct = (p: Product) => setItems((l) => [...l, { product_id: p.id, name: p.name, unit: p.unit, icon: p.icon, price_cents: p.price_cents, qty: p.unit === 'KG' ? 1000 : 1000, line_cents: p.price_cents }]);
  const addFree = () => { if (!free.trim()) return; setItems((l) => [...l, { product_id: null, name: free.trim(), unit: freeUnit, qty: 1000, line_cents: null, manual: true }]); setFree(''); };
  const upd = (i: number, p: Partial<OItem & { manual?: boolean }>) => setItems((l) => l.map((x, j) => {
    if (j !== i) return x;
    const n = { ...x, ...p };
    if (p.qty != null && !n.manual && n.price_cents) n.line_cents = lineValue(p.qty, n.price_cents);
    return n;
  }));
  const allValued = items.length > 0 && items.every((i) => i.line_cents != null);
  const total = items.reduce((a, i) => a + (i.line_cents ?? 0), 0);
  const save = async () => {
    setErr('');
    if (!name.trim()) return setErr('Informe o nome do cliente.');
    if (!validPhone(phone)) return setErr('Telefone com DDD, ex.: (11) 98765-4321.');
    if (!items.length) return setErr('Coloque pelo menos um item.');
    if (items.some((i) => !i.qty)) return setErr('Falta a quantidade de algum item.');
    if (paid && !allValued) return setErr('Encomenda paga: preencha o valor de todos os itens.');
    setBusy(true);
    try {
      const body = { customer_id: customerId, customer_name: name.trim(), phone: phoneDigits(phone), paid, paid_method: paid ? method : null, delivery, address, note,
        items: items.map((i) => ({ product_id: i.product_id, name: i.name, unit: i.unit, qty: i.qty, line_cents: i.line_cents })) };
      const o = order ? await put(`/api/orders/${order.id}`, body) : await post('/api/orders', body);
      onSaved(o, !order);
    } catch (e: any) { setErr(e.message); toast(e.message, 'erro'); } finally { setBusy(false); }
  };
  return (
    <Modal title={order ? `Editar encomenda nº ${order.id}` : '📦 Nova encomenda'} onClose={onClose} size="wide"
      footer={<><span className="grow"><b className="num" data-testid="order-total">{allValued ? formatBRL(total) : total ? `${formatBRL(total)} + a definir` : 'valor a definir'}</b></span>
        <button className="btn" onClick={onClose}>Voltar</button>
        <button className="btn btn-primary" disabled={busy} onClick={save} data-testid="order-save">{busy ? 'Salvando…' : 'Salvar encomenda'}</button></>}>
      <div className="grid2 order-form">
        <div className="col">
          <label className="field">Nome do cliente
            <span className="ac">
              <input className="input" value={name} autoFocus placeholder="ex.: Maria" onFocus={() => setSug(true)} onBlur={() => setTimeout(() => setSug(false), 150)}
                onChange={(e) => { setName(e.target.value); setCustomerId(null); setSug(true); }} data-testid="order-name" />
              {sug && matches.length > 0 && <div className="ac-list">{matches.map((c) => (
                <button key={c.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setName(c.name); setCustomerId(c.id); if (c.phone) setPhone(maskPhone(c.phone)); setSug(false); }}>
                  <b>{c.name}</b> <span className="small muted">{c.phone ? maskPhone(c.phone) : 'sem telefone'} · cliente do fiado</span></button>))}</div>}
            </span>
            {customerId && <span className="small ok-txt">✓ ligado ao cadastro de cliente (dá para pagar no fiado)</span>}
          </label>
          <label className="field">Telefone (WhatsApp)
            <input className="input" inputMode="tel" value={phone} placeholder="(11) 98765-4321" onChange={(e) => setPhone(maskPhone(e.target.value))} data-testid="order-phone" />
            {phoneDigits(phone).length > 0 && !validPhone(phone) && <span className="small neg">DDD + número</span>}</label>
          <div className="field"><span>Pago?</span>
            <div className="tabs"><button className={!paid ? 'on' : ''} onClick={() => setPaid(false)}>Não, paga quando chegar</button>
              <button className={paid ? 'on' : ''} onClick={() => setPaid(true)} data-testid="order-paid-yes">Sim, já pagou</button></div>
            {paid && <div className="tabs pay-pick">{PAY_BEFORE.map((m) => <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{ICON[m]} {PAYMENT_LABEL[m]}</button>)}</div>}
            {paid && <span className="small muted">O valor entra no caixa quando a encomenda for concluída (a venda é feita na entrega).</span>}
          </div>
          <div className="field"><span>Buscar ou entrega?</span>
            <div className="tabs">{(['buscar', 'entrega', 'a_combinar'] as const).map((d) => <button key={d} className={delivery === d ? 'on' : ''} onClick={() => setDelivery(d)}>{DELIVERY_LABEL[d]}</button>)}</div>
            {delivery === 'entrega' && <input className="input" placeholder="Endereço da entrega" value={address} onChange={(e) => setAddress(e.target.value)} data-testid="order-address" />}
          </div>
          <label className="field">Observação<textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: queijo bem curado, chega quinta" /></label>
        </div>
        <div className="col">
          <b>Itens</b>
          <ProductSearch products={products} onPick={addProduct} placeholder="Produto do cadastro (nome, código ou 📷)" />
          <div className="row" style={{ gap: 6 }}>
            <input className="input grow" placeholder="Ou item livre (ex.: queijo da serra)" value={free} onChange={(e) => setFree(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFree(); } }} data-testid="order-free" />
            <select className="input" style={{ width: 80 }} value={freeUnit} onChange={(e) => setFreeUnit(e.target.value as 'UN' | 'KG')}><option value="UN">un</option><option value="KG">kg</option></select>
            <button className="btn" onClick={addFree} disabled={!free.trim()} data-testid="order-free-add">+ Item</button>
          </div>
          <div className="oitems" data-testid="order-items">
            {!items.length && <div className="muted small">Nenhum item ainda.</div>}
            {items.map((it, i) => (
              <div key={i} className="oitem">
                <span className="grow nm">{it.product_id ? <PIcon p={it} fallback="📝" /> : (it.icon ?? '📝')} <b>{it.name}</b>{it.price_cents ? <span className="small muted"> · {formatBRL(it.price_cents)}/{it.unit === 'KG' ? 'kg' : UNIT_LABEL[it.unit as Unit]}</span> : <span className="small muted"> · item livre</span>}</span>
                <SmartQty unit={it.unit} value={it.qty} onChange={(q) => upd(i, { qty: q })} />
                <MoneyInput className="oval" value={it.line_cents ?? 0} onChange={(c) => upd(i, { line_cents: c || null, manual: true })} aria-label={`Valor de ${it.name}`} />
                <button className="btn btn-sm btn-ghost" onClick={() => setItems((l) => l.filter((_, j) => j !== i))} aria-label="Tirar">✕</button>
              </div>))}
          </div>
          <div className="small muted">Valor calculado com o preço de hoje; dá para mudar. Deixe R$ 0,00 se ainda não sabe (combina na entrega).</div>
        </div>
      </div>
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}

function NotifyModal({ order, store, onClose, onSent }: { order: Order; store: string; onClose: () => void; onSent: () => void }) {
  const { toast } = useApp();
  const [text, setText] = useState(() => orderArrivedText(store, order));
  const mark = async () => {
    try { await post(`/api/orders/${order.id}/notify`); toast(`${order.customer_name}: marcada como avisada.`); onSent(); }
    catch (e: any) { toast(e.message, 'erro'); }
  };
  return (
    <Modal title={`📣 Avisar ${order.customer_name}`} onClose={onClose} size="mid"
      footer={<><button className="btn" onClick={onClose}>Voltar</button><span className="spacer" />
        <button className="btn" onClick={mark} data-testid="notify-mark">Só marcar avisado</button>
        <a className="btn btn-primary" href={waLink(order.phone, text)} target="_blank" rel="noopener" onClick={() => { mark(); }} data-testid="notify-open">📲 Abrir WhatsApp e marcar avisado</a></>}>
      <div className="small muted">Para {maskPhone(order.phone)} · o app só abre a conversa com o texto pronto: quem envia é você, no WhatsApp.</div>
      <textarea className="input whats-edit" rows={6} value={text} onChange={(e) => setText(e.target.value)} data-testid="notify-text" />
      <div className="whats-bubble" data-testid="notify-preview">{text}</div>
    </Modal>
  );
}

function ConcludeModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (r: { order: any; sale: any }) => void }) {
  const { status, toast, go } = useApp();
  const [items, setItems] = useState(order.items.map((i) => ({ ...i })));
  const [method, setMethod] = useState<PaymentMethod | null>(order.paid ? (order.paid_method as PaymentMethod) : null);
  const total = items.reduce((a, i) => a + (i.line_cents ?? 0), 0);
  const [cash, setCash] = useState(0);
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(order.customer_id);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { if (method === 'fiado' && !customers.length) get<any[]>('/api/customers').then((c) => setCustomers(c.filter((x) => x.active))).catch(() => {}); }, [method]); // eslint-disable-line
  useEffect(() => { setCash(total); }, [total]);
  const open = !!status?.session?.session;
  const missing = items.some((i) => !i.qty || i.line_cents == null);
  const change = method === 'dinheiro' ? Math.max(0, cash - total) : 0;
  const finish = async () => {
    setErr('');
    if (!order.paid && !method) return setErr('Escolha a forma de pagamento.');
    if (missing || total <= 0) return setErr('Preencha quantidade e valor de cada item.');
    if (method === 'dinheiro' && !order.paid && cash < total) return setErr('Dinheiro recebido menor que o total.');
    if (method === 'fiado' && !customerId) return setErr('Fiado: escolha o cliente cadastrado.');
    setBusy(true);
    try {
      const r = await post(`/api/orders/${order.id}/conclude`, {
        payments: order.paid ? [] : [{ method, amount_cents: method === 'dinheiro' ? cash : total }], customer_id: customerId,
        items: order.paid ? undefined : items.map((i) => ({ id: i.id, qty: i.qty, line_cents: i.line_cents })),
      });
      toast(`Encomenda concluída · venda nº ${r.sale.number}${r.sale.change_cents ? ` · troco ${formatBRL(r.sale.change_cents)}` : ''}`);
      onDone(r);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`✅ Concluir encomenda · ${order.customer_name}`} onClose={onClose} size="mid"
      footer={<><button className="btn" onClick={onClose}>Voltar</button><span className="spacer" />
        <button className="btn btn-primary btn-big" disabled={busy || !open || (!order.paid && !method)} onClick={finish} data-testid="conclude-confirm">
          {busy ? 'Gravando…' : order.paid ? 'Entregar e gerar comprovante' : method === 'fiado' ? 'Lançar no fiado e gerar comprovante' : '✓ Pagamento recebido · gerar comprovante'}</button></>}>
      {!open && <div className="err">Caixa fechado. Abra o caixa para concluir (a venda entra no caixa). <button className="btn btn-sm" onClick={() => go('caixa')}>Ir para o Caixa</button></div>}
      <table className="t conc-items"><tbody>{items.map((it, i) => (
        <tr key={it.id ?? i}><td>{it.product_id ? <PIcon p={it} fallback="📝" /> : (it.icon ?? '📝')} {it.name}</td>
          <td style={{ width: 150 }}>{order.paid ? (it.qty ? (it.unit === 'KG' ? `${formatKg(it.qty)} kg` : `${it.qty / 1000} ${UNIT_LABEL[it.unit as Unit] ?? ''}`) : '—')
            : <SmartQty unit={it.unit} value={it.qty} onChange={(q) => setItems((l) => l.map((x, j) => (j === i ? { ...x, qty: q, line_cents: x.price_cents && x.product_id ? lineValue(q, x.price_cents) : x.line_cents } : x)))} />}</td>
          <td className="r" style={{ width: 130 }}>{order.paid ? formatBRL(it.line_cents ?? 0)
            : <MoneyInput value={it.line_cents ?? 0} onChange={(c) => setItems((l) => l.map((x, j) => (j === i ? { ...x, line_cents: c } : x)))} aria-label={`Valor de ${it.name}`} />}</td></tr>))}
        <tr><td><b>Total</b></td><td /><td className="r"><b className="num" data-testid="conclude-total">{formatBRL(total)}</b></td></tr></tbody></table>
      {order.paid ? (
        <div className="ok-box" data-testid="conclude-paid">Já pago{order.paid_method ? ` no ${PAYMENT_LABEL[order.paid_method as PaymentMethod]}` : ''}: {formatBRL(total)}. Ao concluir vira a venda (estoque e caixa) e sai o comprovante.</div>
      ) : (
        <div className="col" data-testid="conclude-pay">
          <b>Como o cliente vai pagar?</b>
          <div className="methods conc-methods">{PAY_NOW.map((m) => <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)} data-testid={`pay-${m}`}><span className="ic">{ICON[m]}</span>{PAYMENT_LABEL[m]}</button>)}</div>
          {method === 'dinheiro' && <label className="field">Dinheiro recebido<MoneyInput big value={cash} onChange={setCash} />
            {change > 0 && <span className="restante troco"><span>TROCO</span><span className="v">{formatBRL(change)}</span></span>}</label>}
          {method === 'fiado' && <label className="field">Cliente do fiado
            <select className="input" value={customerId ?? ''} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— escolha —</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name} · deve {formatBRL(c.balance_cents)} · limite {formatBRL(c.credit_limit_cents)}</option>)}</select></label>}
          {method && method !== 'fiado' && <div className="small muted">Confirme só depois que o pagamento entrou (Pix na conta, maquininha aprovada, dinheiro na mão).</div>}
        </div>
      )}
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}

function CancelModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const { toast, withManager } = useApp();
  const [reason, setReason] = useState('');
  const run = async () => {
    try {
      const r = await withManager((pin) => post(`/api/orders/${order.id}/cancel`, { reason, manager_pin: pin }), 'Cancelar encomenda');
      if (r) { toast(`Encomenda de ${order.customer_name} cancelada.`); onDone(); }
    } catch (e: any) { toast(e.message, 'erro'); }
  };
  return (
    <Modal title="Cancelar encomenda?" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Voltar</button><button className="btn btn-danger solid" onClick={run} data-testid="order-cancel-confirm">Cancelar encomenda</button></>}>
      <div>{order.customer_name}: {orderItemsText(order.items)}. Nada foi vendido ainda; o estoque e o caixa não mudam.</div>
      <label className="field">Motivo (opcional)<input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex.: cliente desistiu" /></label>
      <div className="small muted">Operador precisa do PIN do gerente.</div>
    </Modal>
  );
}
