import { useEffect, useRef, useState } from 'react';
import { get, post, IS_SB } from '../api';
import { downloadReceiptBin, downloadReceiptPdf } from '../files';
import { useApp } from '../ctx';
import { Modal } from '../components/Modal';
import { Receipt, RLine } from '../components/Receipt';
import { formatBRL } from '@folha/shared';
import { ComprovanteActions } from '../components/Comprovante';
import { DeleteSaleModal, isAdmin } from '../components/DeleteSale';
import { fmtDateTime } from '../api';

/** Cupom de venda (saleId) ou relatório de caixa (sessionId) */
export function ReceiptModal({ saleId, sessionId, onClose, title, autoPrint, onChanged }: { saleId?: number; sessionId?: number; onClose: () => void; title?: string; autoPrint?: boolean; onChanged?: () => void }) {
  const { toast, user } = useApp();
  const [del, setDel] = useState(false);
  const [rev, setRev] = useState(0);
  const [lines, setLines] = useState<RLine[] | null>(null);
  const [sale, setSale] = useState<any>(null);
  const base = saleId ? `/api/sales/${saleId}/receipt` : `/api/cash/sessions/${sessionId}/report`;
  useEffect(() => {
    get(base).then((d) => setLines(d.lines)).catch((e) => toast(e.message, 'erro'));
    if (saleId) get(`/api/sales/${saleId}`).then(setSale).catch(() => {});
  }, [base, saleId, toast, rev]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Enter' && saleId && !del) { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });
  const printed = useRef(false);
  useEffect(() => { if (autoPrint && lines && !printed.current) { printed.current = true; setTimeout(() => window.print(), 300); } }, [autoPrint, lines]);
  const printer = async () => {
    const r = await post(saleId ? `/api/sales/${saleId}/print` : `/api/cash/sessions/${sessionId}/print`).catch((e) => ({ ok: false, error: e.message }));
    toast(r.ok ? 'Enviado para a impressora.' : r.error, r.ok ? 'ok' : 'erro');
  };
  return (
    <Modal title={title ?? (sale ? `Venda nº ${sale.number}` : 'Cupom')} onClose={onClose} size="mid"
      footer={<>
        <button className="btn" onClick={() => window.print()}>🖨 Imprimir (80 mm)</button>
        {!IS_SB && <button className="btn" onClick={printer}>Térmica ESC/POS</button>}
        {!saleId && <button className="btn" onClick={() => downloadReceiptPdf(saleId, sessionId).catch((e) => toast(e.message, 'erro'))}>PDF</button>}
        <button className="btn" onClick={() => downloadReceiptBin(saleId, sessionId).catch((e) => toast(e.message, 'erro'))}
          title={IS_SB ? 'Arquivo ESC/POS para mandar à térmica por um app/computador (o navegador não acessa a porta 9100)' : 'Arquivo ESC/POS'}>.bin</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onClose}>{saleId ? 'Próximo freguês (Enter)' : 'Fechar'}</button>
      </>}>
      <div className="row receipt-row" style={{ alignItems: 'flex-start', gap: 18 }}>
        <div className="print-area grow">{lines ? <Receipt lines={lines} /> : <div className="muted">Carregando…</div>}</div>
        {sale && (
          <div className="col no-print receipt-side" style={{ width: 230 }}>
            <div className="stat verde"><div className="lbl">Total</div><div className="val">{formatBRL(sale.total_cents)}</div></div>
            {sale.change_cents > 0 && <div className="stat" style={{ background: 'var(--lima)' }}><div className="lbl" style={{ color: 'var(--folha-3)' }}>Troco</div><div className="val">{formatBRL(sale.change_cents)}</div></div>}
            <div className="small muted">Simulação fiscal: {sale.fiscal?.status ?? '—'} (sem SEFAZ)</div>
            {sale.status === 'EXCLUIDA' ? (
              <div className="deleted-box small" data-testid="sale-deleted-info">🗑 Venda apagada{sale.deleted_at ? ` em ${fmtDateTime(sale.deleted_at)}` : ''}{sale.deleted_by_name ? ` por ${sale.deleted_by_name}` : ''}.
                {sale.delete_reason ? <> Motivo: {sale.delete_reason}.</> : null} Não entra em nenhum total.</div>
            ) : <>
              <b className="small">Mandar para o cliente</b>
              <ComprovanteActions sale={sale} compact />
            </>}
            {isAdmin(user) && sale.status !== 'EXCLUIDA' && <button className="btn btn-sm btn-ghost btn-danger" style={{ marginTop: 8 }} onClick={() => setDel(true)} data-testid="receipt-delete"
              title="Só administrador: tira a venda do sistema (qualquer dia)">🗑 Apagar venda</button>}
          </div>
        )}
      </div>
      {del && sale && <DeleteSaleModal sale={sale} onClose={() => setDel(false)} onDeleted={() => { setDel(false); setRev((n) => n + 1); onChanged?.(); }} />}
    </Modal>
  );
}
