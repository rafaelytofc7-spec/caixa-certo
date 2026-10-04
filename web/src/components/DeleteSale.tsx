// v3.4: APAGAR VENDA (só administrador). Diferente de "Cancelar" (devolução no mesmo dia, gerente).
import { useState } from 'react';
import { post, fmtDate } from '../api';
import { useApp } from '../ctx';
import { Modal } from './Modal';
import { formatBRL, PAYMENT_LABEL, PaymentMethod } from '@folha/shared';

export const isAdmin = (u: { role?: string } | null | undefined) => u?.role === 'admin';

/** o que vai acontecer, em português, a partir da venda (sale_get) */
export function deleteEffects(sale: any): string[] {
  const L: string[] = [];
  if (sale.status === 'CANCELADA') return ['Esta venda já foi cancelada (estoque e caixa já estornados): ela só sai da lista.'];
  if (sale.imported) return ['Venda importada do sistema antigo: só sai dos totais (não tem estoque nem caixa neste app).'];
  const items = (sale.items ?? []).filter((i: any) => i.product_id);
  if (items.length) L.push(`O estoque volta (${items.length} ${items.length === 1 ? 'item' : 'itens'}), com o registro “Estorno por exclusão”.`);
  const pays = (sale.payments ?? []).filter((p: any) => p.method !== 'nao_informado' && p.net_cents);
  const money = pays.map((p: any) => `${PAYMENT_LABEL[p.method as PaymentMethod] ?? p.method} ${formatBRL(p.net_cents)}`).join(' + ');
  if (pays.length) L.push(sale.session_status === 'ABERTO'
    ? `Caixa ${sale.terminal} ainda aberto: sai ${money} do esperado do caixa.`
    : `Caixa ${sale.terminal} já fechado: a conferência daquele dia não muda; fica a linha “Estorno por exclusão” no histórico do caixa.`);
  const fiado = pays.filter((p: any) => p.method === 'fiado').reduce((a: number, p: any) => a + p.net_cents, 0);
  if (fiado && sale.customer_name) L.push(`O fiado de ${sale.customer_name} diminui ${formatBRL(fiado)}.`);
  if (sale.order) L.push(`A encomenda de ${sale.order.customer_name} volta para “Pronta” e “a pagar” (dá para concluir de novo ou cancelar).`);
  return L;
}

export function DeleteSaleModal({ sale, onClose, onDeleted }: { sale: any; onClose: () => void; onDeleted: (r: any) => void }) {
  const { toast, refreshStatus } = useApp();
  const [reason, setReason] = useState('');
  const [num, setNum] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const okNum = num.trim() === String(sale.number);
  const okReason = reason.trim().length >= 3;
  const run = async () => {
    setErr('');
    if (!okReason) return setErr('Escreva o motivo.');
    if (!okNum) return setErr(`Digite ${sale.number} para confirmar.`);
    setBusy(true);
    try {
      const r = await post(`/api/sales/${sale.id}/delete`, { reason: reason.trim(), confirm_number: Number(num) });
      toast(`Venda nº ${sale.number} apagada.`); refreshStatus(); onDeleted(r);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const when = `${fmtDate(sale.created_at)} ${String(sale.created_at).slice(11, 16)}`;
  return (
    <Modal title={`🗑 Apagar venda nº ${sale.number}?`} onClose={onClose} size="mid"
      footer={<><button className="btn" onClick={onClose}>Voltar</button><span className="spacer" />
        <button className="btn btn-danger solid btn-big" disabled={busy || !okNum || !okReason} onClick={run} data-testid="del-confirm">
          {busy ? 'Apagando…' : `🗑 Apagar venda nº ${sale.number}`}</button></>}>
      <div className="del-head" data-testid="del-head">
        <div><span className="lbl">Venda</span><b>nº {sale.number}</b></div>
        <div><span className="lbl">Data</span><b>{when}</b></div>
        <div><span className="lbl">Total</span><b className="num">{formatBRL(sale.total_cents)}</b></div>
      </div>
      <div className="del-diff small">
        <b>Apagar ≠ Cancelar.</b> <u>Cancelar</u> é a devolução do freguês no mesmo dia (gerente). <u>Apagar</u> é para venda lançada errada, de teste ou
        duplicada, de qualquer dia: some dos relatórios, do Hoje, do livro caixa e do total das vendas. Fica guardada só para o administrador
        (“Mostrar excluídas”) e no registro de auditoria.
      </div>
      <ul className="del-effects" data-testid="del-effects">{deleteEffects(sale).map((t, i) => <li key={i}>{t}</li>)}</ul>
      <label className="field">Motivo (obrigatório)
        <input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: lançada em dobro, venda de teste" data-testid="del-reason" /></label>
      <label className="field">Para confirmar, digite o número da venda: <b>{sale.number}</b>
        <input className="input num" inputMode="numeric" value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ''))} placeholder={String(sale.number)} data-testid="del-number" />
        {num && !okNum && <span className="small neg">Número diferente</span>}</label>
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}
