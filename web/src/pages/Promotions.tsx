import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../api';
import { useApp } from '../ctx';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/Inputs';
import { norm } from '../text';
import { formatBRL, Product, UNIT_LABEL, Unit, promoWhatsText, parseLocalTs } from '@folha/shared';
import { PIcon } from '../productPhotos';

type Status = 'ATIVA' | 'AGENDADA' | 'ENCERRADA' | 'EXPIRADA';
interface Promo {
  id: number; product_id: number; product_name: string; product_icon: string; product_unit: Unit; product_code: string; product_deleted: boolean;
  promo_price_cents: number; regular_price_cents: number; starts_at: string; ends_at: string; ended_at: string | null; ends_until: string;
  status: Status; items_sold: number; total_sold_cents: number; note: string | null; created_by_name: string | null;
}
const ST_LABEL: Record<Status, string> = { ATIVA: 'Ativa', AGENDADA: 'Agendada', ENCERRADA: 'Encerrada antes', EXPIRADA: 'Acabou' };
const un = (u: string) => (u === 'KG' ? 'kg' : UNIT_LABEL[u as Unit] ?? 'un');
const pct = (promo: number, reg: number) => (reg > 0 ? Math.round((1 - promo / reg) * 100) : 0);
/** valor para <input type="datetime-local"> no horário do aparelho */
const toLocalInput = (ms: number) => { const d = new Date(ms); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const shortDt = (s: string) => { const d = new Date(parseLocalTs(s)); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const endOfDay = (ms: number, plusDays = 0) => { const d = new Date(ms); d.setDate(d.getDate() + plusDays); d.setHours(23, 59, 0, 0); return d.getTime(); };

export function Promotions() {
  const { toast, status } = useApp();
  const [rows, setRows] = useState<Promo[] | null>(null);
  const [tab, setTab] = useState<'ativas' | 'agendadas' | 'antigas'>('ativas');
  const [creating, setCreating] = useState(false);
  const [whats, setWhats] = useState(false);
  const [ending, setEnding] = useState<Promo | null>(null);
  const [err, setErr] = useState('');
  const load = () => get<Promo[]>('/api/promotions').then((r) => { setRows(r); setErr(''); })
    .catch((e) => { setRows([]); setErr(e.status === 404 ? 'Promoções precisam do modo online (Supabase).' : e.message); });
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []); // eslint-disable-line
  const by = (s: Status[]) => (rows ?? []).filter((r) => s.includes(r.status));
  const ativas = by(['ATIVA']); const agendadas = by(['AGENDADA']); const antigas = by(['ENCERRADA', 'EXPIRADA']);
  const shown = tab === 'ativas' ? ativas : tab === 'agendadas' ? agendadas : antigas;

  return (
    <div className="card promos" data-testid="promos">
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <div className="tabs">
          <button className={tab === 'ativas' ? 'on' : ''} onClick={() => setTab('ativas')}>🔥 Ativas ({ativas.length})</button>
          <button className={tab === 'agendadas' ? 'on' : ''} onClick={() => setTab('agendadas')}>🗓 Agendadas ({agendadas.length})</button>
          <button className={tab === 'antigas' ? 'on' : ''} onClick={() => setTab('antigas')}>Encerradas ({antigas.length})</button>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setWhats(true)} disabled={!ativas.length} data-testid="promo-whats">📲 Enviar promoções</button>
        <button className="btn btn-primary" onClick={() => setCreating(true)} data-testid="promo-new">+ Nova promoção</button>
      </div>
      {err && <div className="err">{err}</div>}
      {!rows ? <p className="muted">Carregando…</p> : !shown.length ? (
        <div className="muted promo-empty">{tab === 'ativas' ? 'Nenhuma promoção valendo agora. Toque em “+ Nova promoção” para escolher os produtos.' : tab === 'agendadas' ? 'Nenhuma promoção agendada.' : 'Nenhuma promoção encerrada ainda.'}</div>
      ) : (
        <div className="table-wrap"><table className="t promo-table">
          <thead><tr><th>Produto</th><th className="r">Normal</th><th className="r">Promo</th><th className="r hide-phone">Desc.</th><th>Período</th><th className="r hide-phone">Vendido</th><th>Situação</th><th /></tr></thead>
          <tbody>{shown.map((p) => (
            <tr key={p.id}>
              <td><b><PIcon p={{ name: p.product_name, icon: p.product_icon }} /> {p.product_name}</b>{p.product_deleted && <div className="small muted">produto apagado</div>}</td>
              <td className="r"><s className="old-price">{formatBRL(p.regular_price_cents)}</s></td>
              <td className="r"><b className="promo-price">{formatBRL(p.promo_price_cents)}</b><span className="small muted">/{un(p.product_unit)}</span></td>
              <td className="r hide-phone">−{pct(p.promo_price_cents, p.regular_price_cents)}%</td>
              <td className="small nowrap">{shortDt(p.starts_at)}<br />até {shortDt(p.ends_until)}</td>
              <td className="r hide-phone">{p.items_sold ? <>{p.items_sold} · {formatBRL(p.total_sold_cents)}</> : '—'}</td>
              <td><span className={`tag ${p.status === 'ATIVA' ? 'promo-tag' : p.status === 'AGENDADA' ? 'ok' : ''}`}>{ST_LABEL[p.status]}</span></td>
              <td className="r">{(p.status === 'ATIVA' || p.status === 'AGENDADA') &&
                <button className="btn btn-sm btn-danger" onClick={() => setEnding(p)}>{p.status === 'ATIVA' ? 'Encerrar agora' : 'Cancelar'}</button>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>O preço promocional vale sozinho do início ao fim (venda, leitor de código, atalhos e Preço do dia) e volta ao normal quando acaba. Só gerente/admin cria ou encerra.</p>
      {creating && <NewPromo onClose={() => setCreating(false)} onSaved={(n) => { setCreating(false); toast(`${n} promoção(ões) criada(s).`); load(); }} />}
      {whats && <WhatsModal store={status?.store?.name ?? ''} promos={ativas} onClose={() => setWhats(false)} />}
      {ending && (
        <Modal title={ending.status === 'ATIVA' ? 'Encerrar promoção agora?' : 'Cancelar promoção agendada?'} size="sm" onClose={() => setEnding(null)}
          footer={<><button className="btn" onClick={() => setEnding(null)}>Voltar</button>
            <button className="btn btn-danger solid" data-testid="promo-end-confirm" onClick={async () => {
              try { await post(`/api/promotions/${ending.id}/end`); toast(`Promoção de ${ending.product_name} encerrada. Preço voltou para ${formatBRL(ending.regular_price_cents)}.`); setEnding(null); load(); }
              catch (e: any) { toast(e.message, 'erro'); }
            }}>{ending.status === 'ATIVA' ? 'Encerrar agora' : 'Cancelar promoção'}</button></>}>
          <p><b>{ending.product_icon} {ending.product_name}</b>: {formatBRL(ending.promo_price_cents)} → volta para <b>{formatBRL(ending.regular_price_cents)}</b>/{un(ending.product_unit)} {ending.status === 'ATIVA' ? 'agora' : '(nem chega a começar)'}.</p>
        </Modal>)}
    </div>
  );
}

function NewPromo({ onClose, onSaved }: { onClose: () => void; onSaved: (n: number) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Record<number, number>>({}); // product_id → preço promo
  const [start, setStart] = useState(() => toLocalInput(Date.now()));
  const [end, setEnd] = useState(() => toLocalInput(endOfDay(Date.now())));
  const [off, setOff] = useState(10);
  const [note, setNote] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { get<Product[]>('/api/products?active=1').then(setProducts).catch((e) => setErr(e.message)); }, []);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const list = useMemo(() => products.filter((p) => !q.trim() || norm(p.name).includes(norm(q)) || p.code === q.trim()), [products, q]);
  const withOff = (p: Product, o = off) => Math.max(1, Math.round((p.price_cents * (100 - o)) / 100 / 10) * 10 - 1); // ex.: 5,99 −10% → 5,39
  const toggle = (p: Product) => setSel((s) => { const n = { ...s }; if (n[p.id] != null) delete n[p.id]; else n[p.id] = withOff(p); return n; });
  const ids = Object.keys(sel).map(Number);
  const startMs = new Date(start).getTime(); const endMs = new Date(end).getTime();
  const bad = ids.filter((id) => { const p = byId.get(id); return !p || !(sel[id] > 0) || sel[id] >= p.price_cents; });
  const quick = (label: string, ms: number) => <button type="button" className="btn btn-sm" onClick={() => setEnd(toLocalInput(ms))}>{label}</button>;
  const sunday = () => { const d = new Date(); return endOfDay(d.getTime(), (7 - d.getDay()) % 7); };
  const save = async () => {
    setErr('');
    if (!ids.length) return setErr('Escolha pelo menos um produto.');
    if (bad.length) return setErr(`Preço de promoção precisa ser menor que o normal: ${bad.map((id) => byId.get(id)?.name).join(', ')}.`);
    if (!(endMs > startMs)) return setErr('O fim precisa ser depois do início.');
    if (!(endMs > Date.now())) return setErr('Escolha um fim no futuro.');
    setBusy(true);
    try {
      const r = await post<any[]>('/api/promotions', { items: ids.map((id) => ({ product_id: id, promo_price_cents: sel[id] })),
        starts_at: new Date(startMs).toISOString(), ends_at: new Date(endMs).toISOString(), note: note || null });
      onSaved(r?.length ?? ids.length);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title="🔥 Nova promoção" onClose={onClose} size="wide"
      footer={<><span className="small muted grow">{ids.length} produto(s)</span><button className="btn" onClick={onClose}>Voltar</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !ids.length} data-testid="promo-save">{busy ? 'Salvando…' : `Criar promoção (${ids.length})`}</button></>}>
      <div className="grid3">
        <label className="field">Começa<input type="datetime-local" className="input" value={start} onChange={(e) => setStart(e.target.value)} data-testid="promo-start" /></label>
        <label className="field">Acaba<input type="datetime-local" className="input" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="promo-end" /></label>
        <label className="field">Observação (opcional)<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: feira de sábado" /></label>
      </div>
      <div className="row wrap" style={{ gap: 6, margin: '6px 0 10px' }}>
        <span className="small muted">Acaba:</span>{quick('Hoje 23:59', endOfDay(Date.now()))}{quick('Amanhã 23:59', endOfDay(Date.now(), 1))}{quick('Domingo 23:59', sunday())}{quick('7 dias', endOfDay(Date.now(), 6))}
      </div>
      <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
        <input className="input grow" placeholder="Buscar produto" value={q} onChange={(e) => setQ(e.target.value)} data-testid="promo-search" />
        <label className="row" style={{ gap: 6 }}><span className="small">Desconto</span>
          <input className="input num" style={{ width: 70 }} inputMode="numeric" value={off} onChange={(e) => setOff(Math.max(1, Math.min(90, Number(e.target.value.replace(/\D/g, '')) || 0)))} />%</label>
        <button className="btn" disabled={!ids.length} onClick={() => setSel((s) => Object.fromEntries(Object.keys(s).map((id) => [id, withOff(byId.get(Number(id))!)])))}>Aplicar −{off}% nos escolhidos</button>
      </div>
      <div className="promo-pick">
        {list.map((p) => {
          const on = sel[p.id] != null; const cur = p.promo_id ? `já tem promoção ${parseLocalTs(p.promo_starts_at) > Date.now() ? 'agendada' : 'valendo'}` : '';
          return (
            <div key={p.id} className={`promo-row ${on ? 'on' : ''}`}>
              <label className="check grow"><input type="checkbox" checked={on} onChange={() => toggle(p)} aria-label={`Promoção ${p.name}`} />
                <span><PIcon p={p} /> <b>{p.name}</b> <span className="small muted">{formatBRL(p.price_cents)}/{un(p.unit)}</span>{cur && <span className="small warn-mini"> · {cur}</span>}</span></label>
              {on && <><MoneyInput className="price-in" value={sel[p.id]} onChange={(v) => setSel((s) => ({ ...s, [p.id]: v }))} aria-label={`Preço promocional de ${p.name}`} />
                <span className={`small ${sel[p.id] >= p.price_cents ? 'neg' : 'muted'}`}>−{pct(sel[p.id], p.price_cents)}%</span></>}
            </div>);
        })}
      </div>
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}

function WhatsModal({ store, promos, onClose }: { store: string; promos: Promo[]; onClose: () => void }) {
  const { toast } = useApp();
  const text = promoWhatsText(store, promos.map((p) => ({ icon: p.product_icon, name: p.product_name, unit: p.product_unit, regular_price_cents: p.regular_price_cents, promo_price_cents: p.promo_price_cents, ends_until: p.ends_until })));
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast('Lista copiada. Cole no WhatsApp.');
  };
  return (
    <Modal title="📲 Enviar promoções" onClose={onClose} size="mid"
      footer={<><button className="btn" onClick={onClose}>Voltar</button>
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Abrir no WhatsApp</a>
        <button className="btn btn-primary" onClick={copy} data-testid="promo-copy">📋 Copiar texto</button></>}>
      <p className="small muted">Texto pronto com as {promos.length} promoção(ões) valendo agora (no WhatsApp, ~texto~ fica riscado e *texto* em negrito):</p>
      <pre className="whats-text" data-testid="promo-text">{text}</pre>
    </Modal>
  );
}
