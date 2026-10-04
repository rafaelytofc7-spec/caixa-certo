import { useEffect, useState } from 'react';
import { get, post, put, fmtDateTime } from '../api';
import { useApp } from '../ctx';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/Inputs';
import { formatBRL, PAYMENT_LABEL, PAYMENT_METHODS, PaymentMethod } from '@folha/shared';

const TYPE: Record<string, string> = { COMPRA: 'Compra', LANCAMENTO: 'Lançamento', RECEBIMENTO: 'Pagamento', ESTORNO: 'Estorno' };

export function Customers() {
  const { toast, user, refreshStatus } = useApp();
  const [list, setList] = useState<any[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [st, setSt] = useState<any>(null);
  const [modal, setModal] = useState<null | 'receber' | 'lancar' | 'editar' | 'novo'>(null);
  const [q, setQ] = useState('');
  const load = () => get(`/api/customers?q=${encodeURIComponent(q)}`).then((l) => { setList(l); if (!sel && l[0]) setSel(l[0].id); }).catch((e) => toast(e.message, 'erro'));
  useEffect(() => { load(); }, [q]); // eslint-disable-line
  const loadSt = () => sel && get(`/api/customers/${sel}/statement`).then(setSt);
  useEffect(() => { loadSt(); }, [sel]); // eslint-disable-line
  const after = () => { setModal(null); load(); loadSt(); refreshStatus(); };
  const c = st?.customer;
  const isMgr = user?.role !== 'operador';
  return (
    <div className="page">
      <div className="page-title"><h1>📒 Fiado</h1><span className="muted">Caderninho da banca, com limite</span><span className="spacer" />
        {isMgr && <button className="btn btn-primary" onClick={() => setModal('novo')}>+ Novo cliente</button>}</div>
      <div className="grid2" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
        <div className="card">
          <input className="input" placeholder="Buscar cliente" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
          <table className="t"><thead><tr><th>Cliente</th><th className="r">Deve</th><th className="r">Limite</th></tr></thead>
            <tbody>{list.map((x) => (
              <tr key={x.id} className="click" onClick={() => setSel(x.id)} style={sel === x.id ? { background: 'var(--lima-clara)' } : undefined}>
                <td><b>{x.name}</b>{!x.active && <span className="tag bad" style={{ marginLeft: 6 }}>inativo</span>}<div className="small muted">{x.phone}</div></td>
                <td className={`r ${x.balance_cents > 0 ? 'neg' : ''}`}><b>{formatBRL(x.balance_cents)}</b></td><td className="r">{formatBRL(x.credit_limit_cents)}</td></tr>))}</tbody></table>
        </div>
        {c && (
          <div className="card col">
            <div className="row"><h2 className="grow">{c.name}</h2>
              {isMgr && <button className="btn" onClick={() => setModal('editar')}>Editar</button>}
              {isMgr && <button className="btn" onClick={() => setModal('lancar')}>Lançar no fiado</button>}
              <button className="btn btn-primary" disabled={c.balance_cents <= 0} onClick={() => setModal('receber')}>Receber</button></div>
            <div className="grid3">
              <div className="stat tomate"><div className="lbl">Deve</div><div className="val">{formatBRL(c.balance_cents)}</div></div>
              <div className="stat"><div className="lbl">Limite</div><div className="val">{formatBRL(c.credit_limit_cents)}</div></div>
              <div className="stat verde"><div className="lbl">Disponível</div><div className="val">{formatBRL(Math.max(0, c.credit_limit_cents - c.balance_cents))}</div></div>
            </div>
            {c.note && <div className="small muted">📝 {c.note}</div>}
            <h3>Extrato</h3>
            <table className="t"><thead><tr><th>Data</th><th>Movimento</th><th>Por</th><th className="r">Valor</th><th className="r">Saldo</th></tr></thead>
              <tbody>{st.entries.map((e: any) => (
                <tr key={e.id}><td>{fmtDateTime(e.created_at)}</td>
                  <td>{TYPE[e.type]}{e.sale_number ? ` · venda nº ${e.sale_number}` : ''}{e.method && e.type === 'RECEBIMENTO' ? ` · ${PAYMENT_LABEL[e.method as PaymentMethod]}` : ''}{e.note && !e.sale_number ? <div className="small muted">{e.note}</div> : null}</td>
                  <td>{e.user_name}</td><td className={`r ${e.amount_cents > 0 ? 'neg' : 'pos'}`}>{e.amount_cents > 0 ? '+' : ''}{formatBRL(e.amount_cents)}</td><td className="r"><b>{formatBRL(e.balance_after)}</b></td></tr>))}</tbody></table>
            {!st.entries.length && <div className="muted">Sem movimento ainda.</div>}
          </div>
        )}
      </div>
      {modal === 'receber' && c && <Receive c={c} onClose={() => setModal(null)} onDone={after} />}
      {modal === 'lancar' && c && <Charge c={c} onClose={() => setModal(null)} onDone={after} />}
      {(modal === 'editar' || modal === 'novo') && <CustomerForm c={modal === 'editar' ? c : null} onClose={() => setModal(null)} onDone={(id) => { setSel(id); after(); }} />}
    </div>
  );
}

function Receive({ c, onClose, onDone }: { c: any; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [v, setV] = useState(c.balance_cents); const [m, setM] = useState<PaymentMethod>('dinheiro'); const [err, setErr] = useState('');
  const save = async () => {
    try { const r = await post(`/api/customers/${c.id}/receive`, { amount_cents: v, method: m }); toast(`Recebido. ${c.name} agora deve ${formatBRL(r.balance_cents)}.`); onDone(); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title={`Receber de ${c.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Voltar</button><button className="btn btn-primary" disabled={v <= 0} onClick={save}>Confirmar recebimento</button></>}>
      <div className="muted">Deve {formatBRL(c.balance_cents)}. O valor entra no caixa aberto.</div>
      <label className="field">Valor<MoneyInput big value={v} onChange={setV} autoFocus /></label>
      <div className="tabs">{PAYMENT_METHODS.filter((x) => x !== 'fiado').map((x) => <button key={x} className={m === x ? 'on' : ''} onClick={() => setM(x)}>{PAYMENT_LABEL[x]}</button>)}</div>
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}

function Charge({ c, onClose, onDone }: { c: any; onClose: () => void; onDone: () => void }) {
  const { toast, withManager } = useApp();
  const [v, setV] = useState(0); const [note, setNote] = useState(''); const [err, setErr] = useState('');
  const save = async () => {
    try { const r = await withManager((pin) => post(`/api/customers/${c.id}/charge`, { amount_cents: v, note, manager_pin: pin })); if (r) { toast('Lançado no fiado.'); onDone(); } }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title={`Lançar no fiado · ${c.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Voltar</button><button className="btn btn-primary" disabled={v <= 0} onClick={save}>Lançar</button></>}>
      <div className="muted small">Para dívida antiga do caderno. Compras do dia entram sozinhas quando o pagamento é “Fiado”.</div>
      <label className="field">Valor<MoneyInput big value={v} onChange={setV} autoFocus /></label>
      <label className="field">Descrição<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Saldo do caderno de setembro" /></label>
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}

function CustomerForm({ c, onClose, onDone }: { c: any | null; onClose: () => void; onDone: (id: number) => void }) {
  const [f, setF] = useState<any>(c ?? { name: '', phone: '', doc: '', credit_limit_cents: 20000, active: true, note: '' });
  const [err, setErr] = useState('');
  const save = async () => {
    const body = { name: f.name, phone: f.phone, doc: f.doc, credit_limit_cents: f.credit_limit_cents, active: !!f.active, note: f.note };
    try { const r = c ? await put(`/api/customers/${c.id}`, body) : await post('/api/customers', body); onDone(r.id); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title={c ? 'Editar cliente' : 'Novo cliente do fiado'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Voltar</button><button className="btn btn-primary" onClick={save}>Salvar</button></>}>
      <label className="field">Nome<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
      <div className="grid2">
        <label className="field">Telefone<input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="field">CPF (opcional)<input className="input" value={f.doc} onChange={(e) => setF({ ...f, doc: e.target.value })} /></label>
      </div>
      <label className="field">Limite do fiado<MoneyInput value={f.credit_limit_cents} onChange={(v) => setF({ ...f, credit_limit_cents: v })} /></label>
      <label className="field">Anotação<input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativo (pode comprar fiado)</label>
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}
