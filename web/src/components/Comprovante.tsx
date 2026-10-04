// v3.3: comprovante opcional para o cliente — PDF (compartilhar no Android / baixar), WhatsApp (texto) ou imprimir.
import { useEffect, useRef, useState } from 'react';
import { isMedian } from '../pwa';
import { get } from '../api';
import { useApp } from '../ctx';
import { Modal } from './Modal';
import { saleReceiptPdf, shareOrDownload } from '../files';
import { formatBRL, maskPhone, phoneDigits, receiptWhatsText, validPhone, waLink } from '@folha/shared';

/** telefone do cliente da venda (cadastro do fiado) ou da encomenda */
export function useSalePhone(sale: any): string {
  const [ph, setPh] = useState<string>(sale?.order?.phone ?? '');
  useEffect(() => {
    if (sale?.order?.phone) { setPh(sale.order.phone); return; }
    if (!sale?.customer_id) return;
    get<any[]>('/api/customers').then((cs) => { const c = cs.find((x) => x.id === sale.customer_id); if (c?.phone) setPh(c.phone); }).catch(() => {});
  }, [sale?.customer_id, sale?.order?.phone]);
  return ph;
}

export function ComprovanteActions({ sale, onPrint, compact }: { sale: any; onPrint?: () => void; compact?: boolean }) {
  const { status, toast } = useApp();
  const store = status?.store;
  const prefill = useSalePhone(sale);
  const [wa, setWa] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (prefill && !phone) setPhone(maskPhone(prefill)); }, [prefill]); // eslint-disable-line
  const pdf = async () => {
    setBusy(true);
    try {
      const bytes = await saleReceiptPdf(store, sale);
      const r = await shareOrDownload(bytes, `comprovante-${sale.number}.pdf`, `Comprovante da venda nº ${sale.number} · ${formatBRL(sale.total_cents)}`);
      if (r === 'downloaded') toast(isMedian() ? 'PDF salvo no celular (veja o aviso de download). Abra o PDF e toque em Compartilhar → WhatsApp.' : 'PDF baixado. Mande pelo WhatsApp como anexo, se quiser.');
    } catch (e: any) { toast(e.message ?? String(e), 'erro'); } finally { setBusy(false); }
  };
  const text = receiptWhatsText(store?.name ?? '', sale);
  return (
    <div className={`comp-actions ${compact ? 'compact' : ''}`} data-testid="comp-actions">
      <button className="btn" onClick={pdf} disabled={busy} data-testid="comp-pdf">📄 {busy ? 'Gerando…' : 'PDF / Compartilhar'}</button>
      <button className={`btn ${wa ? 'on' : ''}`} onClick={() => setWa((v) => !v)} data-testid="comp-wa">📲 WhatsApp</button>
      {onPrint && <button className="btn" onClick={onPrint} data-testid="comp-print">🖨 Imprimir</button>}
      {wa && (
        <div className="comp-wa" data-testid="comp-wa-box">
          <label className="field">Telefone (WhatsApp) do cliente
            <input className="input" inputMode="tel" autoFocus placeholder="(11) 98765-4321" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} data-testid="comp-phone" /></label>
          <pre className="whats-text small" data-testid="comp-wa-text">{text}</pre>
          <div className="row wrap">
            <a className={`btn btn-primary ${validPhone(phone) ? '' : 'disabled'}`} data-testid="comp-wa-open" target="_blank" rel="noopener"
              href={validPhone(phone) ? waLink(phone, text) : undefined} aria-disabled={!validPhone(phone)}
              onClick={(e) => { if (!validPhone(phone)) { e.preventDefault(); toast('Digite o telefone com DDD.', 'erro'); } }}>Abrir no WhatsApp</a>
            <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(text); toast('Comprovante copiado.'); } catch { toast('Não deu para copiar.', 'erro'); } }}>📋 Copiar texto</button>
            {phoneDigits(phone) && !validPhone(phone) && <span className="small neg">Telefone incompleto</span>}
          </div>
          <div className="small muted">O app só abre a conversa com o texto pronto: quem envia é você, no WhatsApp.</div>
        </div>
      )}
    </div>
  );
}

/** depois de finalizar: "Sem comprovante" é o padrão (Enter) para não atrasar a fila */
export function SaleDoneModal({ sale, title, onClose, onPrint }: { sale: any; title?: string; onClose: () => void; onPrint: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  // a tela de venda devolve o foco para a busca logo depois de limpar a sacola: foca de novo o "Sem comprovante"
  useEffect(() => { const f = () => first.current?.focus(); f(); const a = setTimeout(f, 80); const b = setTimeout(f, 300); return () => { clearTimeout(a); clearTimeout(b); }; }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const t = e.target as HTMLElement;
      const inModal = !!t?.closest?.('.overlay');
      // Enter fecha (sem comprovante), a não ser que a pessoa esteja num campo/botão/link do próprio modal
      if (inModal && t !== first.current && ['INPUT', 'TEXTAREA', 'A', 'BUTTON', 'SELECT'].includes(t.tagName)) return;
      e.preventDefault(); onClose();
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });
  return (
    <Modal title={title ?? `✅ Venda nº ${sale.number} finalizada`} onClose={onClose} size="mid"
      footer={<><span className="small muted grow">O comprovante é opcional. Depois dá para mandar pela tela Vendas.</span>
        <button ref={first} className="btn btn-primary btn-big" onClick={onClose} data-testid="comp-none">Sem comprovante · próximo (Enter)</button></>}>
      <div className="done-head">
        <div className="stat verde"><div className="lbl">Total</div><div className="val">{formatBRL(sale.total_cents)}</div></div>
        {sale.change_cents > 0 && <div className="stat troco-stat"><div className="lbl">Troco</div><div className="val">{formatBRL(sale.change_cents)}</div></div>}
      </div>
      <h4 style={{ margin: '12px 0 6px' }}>Comprovante para o cliente?</h4>
      <ComprovanteActions sale={sale} onPrint={onPrint} />
    </Modal>
  );
}
