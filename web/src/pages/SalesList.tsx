import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post, todayISO, isoDaysAgo, fmtDate } from '../api';
import { norm } from '../text';
import { useApp } from '../ctx';
import { Modal } from '../components/Modal';
import { ReceiptModal } from './ReceiptModal';
import { DeleteSaleModal, isAdmin } from '../components/DeleteSale';
import { formatBRL, PAYMENT_LABEL, PaymentMethod } from '@folha/shared';

export function SalesList() {
  const { toast, withManager, refreshStatus, user } = useApp();
  const admin = isAdmin(user);
  const [showDel, setShowDel] = useState(false);
  const [del, setDel] = useState<any>(null);
  const askDelete = (id: number) => get(`/api/sales/${id}`).then(setDel).catch((e) => toast(e.message, 'erro'));
  const [from, setFrom] = useState(todayISO()); const [to, setTo] = useState(todayISO());
  const [q, setQ] = useState(''); const [st, setSt] = useState<'todas' | 'FINALIZADA' | 'CANCELADA' | 'EXCLUIDA'>('todas');
  const [rows, setRows] = useState<any[]>([]);
  const [view, setView] = useState<number | null>(null);
  const [cancel, setCancel] = useState<any>(null);
  // só a resposta do pedido mais recente vale (trocar “De” e “Até” rápido não pode mostrar o período antigo)
  const seq = useRef(0);
  const load = () => {
    const my = ++seq.current;
    return get(`/api/sales?from=${from}&to=${to}`).then((r) => { if (my === seq.current) setRows(r); }).catch((e) => { if (my === seq.current) toast(e.message, 'erro'); });
  };
  useEffect(() => { load(); }, [from, to]); // eslint-disable-line
  const shown = useMemo(() => {
    const t = norm(q).replace(/^n[ºo°]?\s*/, '');
    const visible = rows.filter((r) => r.status !== 'EXCLUIDA' || (admin && showDel));
    return visible.filter((r) => (st === 'todas' || r.status === st) && (!t || String(r.number) === t ||
      norm(`${r.customer_name ?? ''} ${r.user_name ?? ''} ${(r.methods ?? '').split('+').map((m: string) => PAYMENT_LABEL[m as PaymentMethod]).join(' ')} ${r.terminal ?? ''}`).includes(t)));
  }, [rows, q, st, admin, showDel]);
  const nDel = rows.filter((r) => r.status === 'EXCLUIDA').length;
  const ok = shown.filter((r) => r.status === 'FINALIZADA');
  const day = from === to ? from : '';
  const presets: [string, string, string][] = [['Hoje', todayISO(), todayISO()], ['Ontem', isoDaysAgo(1), isoDaysAgo(1)], ['7 dias', isoDaysAgo(6), todayISO()], ['30 dias', isoDaysAgo(29), todayISO()]];
  return (
    <div className="page">
      <div className="page-title"><h1>🧾 Vendas</h1>
        <div className="tabs">{presets.map(([l, a, b]) => <button key={l} className={from === a && to === b ? 'on' : ''} onClick={() => { setFrom(a); setTo(b); }}>{l}</button>)}</div>
        <span className="spacer" />
        <span className="tag ok big-tag">{ok.length} vendas · {formatBRL(ok.reduce((a, r) => a + r.total_cents, 0))}</span>
      </div>
      <div className="card">
        <div className="row wrap" style={{ marginBottom: 10 }}>
          <input className="input grow" style={{ minWidth: 200 }} placeholder="Buscar nº da venda, cliente, operador, PIX…" value={q} onChange={(e) => setQ(e.target.value)} />
          <input type="date" className="input" style={{ width: 165 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" /><span>até</span>
          <input type="date" className="input" style={{ width: 165 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até" />
          <select className="input" style={{ width: 150 }} value={st} onChange={(e) => setSt(e.target.value as any)}>
            <option value="todas">Todas</option><option value="FINALIZADA">Finalizadas</option><option value="CANCELADA">Canceladas</option>{admin && showDel && <option value="EXCLUIDA">Excluídas</option>}</select>
          {admin && <label className="row small" style={{ gap: 6 }} title="Vendas apagadas pelo administrador (não entram em nenhum total)">
            <input type="checkbox" checked={showDel} onChange={(e) => { setShowDel(e.target.checked); if (!e.target.checked && st === 'EXCLUIDA') setSt('todas'); }} data-testid="show-deleted" />
            Mostrar excluídas{nDel ? ` (${nDel})` : ''}</label>}
        </div>
        <div className="table-wrap"><table className="t"><thead><tr><th>Nº</th><th>{day ? 'Hora' : 'Data'}</th><th>Operador</th><th>Cliente</th><th>Pagamento</th><th className="r">Itens</th><th className="r">Total</th><th>Situação</th><th /></tr></thead>
          <tbody>{shown.map((s) => (
            <tr key={s.id} className={s.status === 'EXCLUIDA' ? 'deleted' : s.status !== 'FINALIZADA' ? 'canceled' : ''} data-status={s.status}><td><b>{s.number}</b></td><td>{day ? s.created_at.slice(11, 16) : `${fmtDate(s.created_at)} ${s.created_at.slice(11, 16)}`}</td><td>{s.imported ? <span className="muted">Sistema antigo</span> : s.user_name}</td><td>{s.customer_name ?? '—'}</td>
              <td>{(s.methods ?? '').split('+').map((m: string) => PAYMENT_LABEL[m as PaymentMethod] ?? m).join(' + ')}</td><td className="r">{s.imported ? '—' : s.items_count}</td>
              <td className="r"><b>{formatBRL(s.total_cents)}</b></td>
              <td>{s.status === 'EXCLUIDA' ? <span className="tag del" title={`Apagada${s.deleted_by_name ? ` por ${s.deleted_by_name}` : ''}: ${s.delete_reason ?? ''}`}>Excluída</span>
                : s.status !== 'FINALIZADA' ? <span className="tag bad">Cancelada</span> : s.imported ? <span className="tag" title="Venda importada do sistema antigo: só o total, sem itens">Importada</span> : <span className="tag ok">Finalizada</span>}</td>
              <td className="r"><div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                <button className="btn btn-sm" onClick={() => setView(s.id)} title="Ver, imprimir, PDF ou WhatsApp">🧾 Comprovante</button>
                {s.status === 'FINALIZADA' && !s.imported && s.created_at.slice(0, 10) === todayISO() && <button className="btn btn-sm btn-danger" onClick={() => setCancel(s)} title="Devolução do freguês hoje (gerente)">Cancelar</button>}
                {admin && s.status !== 'EXCLUIDA' && <button className="btn btn-sm btn-ghost btn-danger" onClick={() => askDelete(s.id)} title="Só administrador: tira a venda do sistema (qualquer dia)" data-testid="sale-delete">🗑 Apagar</button>}
              </div></td></tr>))}</tbody></table></div>
        {!shown.length && <div className="empty-mini">{rows.length ? `Nenhuma venda com “${q}”.` : 'Nenhuma venda no período.'}</div>}
      </div>
      {view && <ReceiptModal saleId={view} onClose={() => setView(null)} onChanged={load} />}
      {del && <DeleteSaleModal sale={del} onClose={() => setDel(null)} onDeleted={() => { setDel(null); load(); }} />}
      {cancel && <CancelModal sale={cancel} onClose={() => setCancel(null)} onConfirm={async (reason) => {
        try {
          const r = await withManager((pin) => post(`/api/sales/${cancel.id}/cancel`, { reason, manager_pin: pin }), 'Cancelamento precisa do gerente');
          if (r) { toast(`Venda nº ${r.number} cancelada. Estoque e caixa estornados.`); setCancel(null); load(); refreshStatus(); }
        } catch (e: any) { toast(e.message, 'erro'); }
      }} />}
    </div>
  );
}

function CancelModal({ sale, onClose, onConfirm }: { sale: any; onClose: () => void; onConfirm: (r: string) => void }) {
  const [r, setR] = useState('');
  return (
    <Modal title={`Cancelar venda nº ${sale.number}?`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Voltar</button><button className="btn btn-danger solid" onClick={() => onConfirm(r)}>Cancelar venda</button></>}>
      <div>Total <b>{formatBRL(sale.total_cents)}</b>. O estoque volta, o dinheiro sai do caixa e o fiado é estornado. Precisa do PIN do gerente.</div>
      <div className="small muted">Cancelar = devolução do freguês hoje. A venda continua na lista como “Cancelada”. (Para tirar uma venda lançada errada de qualquer dia, o administrador usa “🗑 Apagar”.)</div>
      <label className="field">Motivo<input className="input" autoFocus value={r} onChange={(e) => setR(e.target.value)} placeholder="Ex.: freguês desistiu, passou errado" /></label>
    </Modal>
  );
}
