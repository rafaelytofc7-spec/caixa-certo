import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post } from '../api';
import { useApp } from '../ctx';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/Inputs';
import { CalcResult, Discount, formatBRL, PAYMENT_LABEL, PAYMENT_METHODS, PaymentMethod } from '@folha/shared';
import type { Line } from './Sale';

const ICON: Record<PaymentMethod, string> = { dinheiro: '💵', pix: '⚡', debito: '💳', credito: '💳', voucher: '🎫', fiado: '📒' };

export function PaymentModal({ lines, totalDiscount, calc, onClose, onDone }: {
  lines: Line[]; totalDiscount: Discount | null; calc: CalcResult; onClose: () => void; onDone: (sale: any) => void;
}) {
  const { withManager, toast } = useApp();
  const total = calc.total_cents;
  const [pays, setPays] = useState<{ method: PaymentMethod; amount_cents: number }[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('dinheiro');
  const paid = pays.reduce((a, p) => a + p.amount_cents, 0);
  const remaining = Math.max(0, total - paid);
  const [amount, setAmount] = useState(total);
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => { get('/api/customers').then((c) => setCustomers(c.filter((x: any) => x.active))).catch(() => {}); }, []);
  useEffect(() => { setAmount(remaining); setTimeout(() => amountRef.current?.select(), 0); }, [remaining, method]);
  const customer = customers.find((c) => c.id === customerId);
  const nonCash = pays.filter((p) => p.method !== 'dinheiro').reduce((a, p) => a + p.amount_cents, 0);
  const change = Math.max(0, paid - total);
  const fiadoNow = pays.filter((p) => p.method === 'fiado').reduce((a, p) => a + p.amount_cents, 0);
  const available = customer ? customer.credit_limit_cents - customer.balance_cents : 0;

  const addPay = (m: PaymentMethod = method, v: number = amount) => {
    setErr('');
    if (v <= 0) return;
    if (m !== 'dinheiro' && nonCash + v > total) { setErr('Troco só em dinheiro: PIX, cartão, voucher e fiado não passam do total.'); return; }
    if (m === 'fiado') {
      if (!customer) { setErr('Escolha o cliente do fiado.'); return; }
      if (fiadoNow + v > available) { setErr(`Limite do fiado: disponível ${formatBRL(Math.max(0, available))}.`); return; }
    }
    setPays((ps) => {
      const i = ps.findIndex((p) => p.method === m);
      if (i >= 0) return ps.map((p, j) => (j === i ? { ...p, amount_cents: p.amount_cents + v } : p));
      return [...ps, { method: m, amount_cents: v }];
    });
  };

  const ready = paid >= total && total > 0;
  const finish = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr('');
    try {
      const body = {
        items: lines.map((l) => ({ product_id: l.product.id, qty: l.qty, discount: l.discount, ...(l.product.promo_active && l.product.promo_id ? { promotion_id: l.product.promo_id } : {}) })),
        total_discount: totalDiscount, payments: pays, customer_id: customerId,
      };
      const sale = await withManager((pin) => post('/api/sales', { ...body, manager_pin: pin }), 'Desconto acima do limite');
      if (sale?.offline) { toast(`Sem internet: venda guardada no aparelho e enviada quando a conexão voltar${change ? ` · troco ${formatBRL(change)}` : ''}`); onDone(sale); }
      else if (sale) { toast(`Venda nº ${sale.number} finalizada${sale.change_cents ? ` · troco ${formatBRL(sale.change_cents)}` : ''}`); onDone(sale); }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (document.querySelectorAll('.overlay').length > 1) return;
      if (e.key === 'F10' || e.key === 'F12') { e.preventDefault(); finish(); }
      const idx = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'].indexOf(e.key);
      if (idx >= 0 && !e.altKey) { e.preventDefault(); setMethod(PAYMENT_METHODS[idx]); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  const bills = useMemo(() => {
    const r = remaining || total; const out = new Set<number>();
    for (const b of [500, 1000, 2000, 5000, 10000, 20000]) if (b >= r) out.add(b);
    out.add(Math.ceil(r / 1000) * 1000);
    return [...out].sort((a, b) => a - b).slice(0, 4);
  }, [remaining, total]);

  return (
    <Modal title="Receber" onClose={onClose} size="wide"
      footer={<><button className="btn" onClick={onClose}>Voltar à sacola (Esc)</button><span className="spacer" />
        <button className="btn btn-primary btn-big" disabled={!ready || busy} onClick={finish} style={{ minWidth: 280 }}>
          {busy ? 'Gravando…' : 'Finalizar venda'} <span className="key">F10</span></button></>}>
      <div className="pay-grid">
        <div className="col">
          <div className="pay-total">
            <div className="small" style={{ fontWeight: 700, letterSpacing: '.1em', color: 'var(--lima)' }}>TOTAL A RECEBER</div>
            <div className="v">{formatBRL(total)}</div>
            {calc.discount_cents > 0 && <div className="small" style={{ color: '#D5E8DB' }}>já com −{formatBRL(calc.discount_cents)} de desconto</div>}
          </div>
          <div className="methods">
            {PAYMENT_METHODS.map((m, i) => (
              <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>
                <span className="ic">{ICON[m]}</span>{PAYMENT_LABEL[m]}<span className="small muted">F{i + 1}</span>
              </button>
            ))}
          </div>
          <label className="field">Valor em {PAYMENT_LABEL[method]}
            <div className="row">
              <MoneyInput ref={amountRef} big value={amount} onChange={setAmount} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (amount > 0 && remaining > 0) addPay(); else finish(); } }} />
              <button className="btn btn-lima btn-big" onClick={() => addPay()} disabled={amount <= 0}>Lançar</button>
            </div>
          </label>
          {method === 'dinheiro' && (
            <div className="bills">
              <button className="btn" onClick={() => addPay('dinheiro', remaining)} disabled={!remaining}>Exato</button>
              {bills.map((b) => <button key={b} className="btn num" onClick={() => addPay('dinheiro', b)}>{formatBRL(b).replace(',00', '')}</button>)}
            </div>
          )}
        </div>
        <div className="col">
          <label className="field">Cliente {method === 'fiado' ? '(obrigatório no fiado)' : '(opcional)'}
            <select className="input" value={customerId ?? ''} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— sem cliente —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · deve {formatBRL(c.balance_cents)} · limite {formatBRL(c.credit_limit_cents)}</option>)}
            </select>
          </label>
          {customer && <div className="small muted">Fiado disponível: <b className="num">{formatBRL(Math.max(0, available - fiadoNow))}</b></div>}
          <div className="card pay-lines" style={{ padding: '6px 14px' }}>
            {pays.length === 0 && <div className="muted" style={{ padding: '10px 0' }}>Nenhum pagamento lançado. Pode misturar: parte no PIX, parte no dinheiro…</div>}
            {pays.map((p, i) => (
              <div key={p.method} className="pl">
                <span>{ICON[p.method]}</span>{PAYMENT_LABEL[p.method]}
                <span className="v">{formatBRL(p.amount_cents)}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => setPays((ps) => ps.filter((_, j) => j !== i))} aria-label="Remover">✕</button>
              </div>
            ))}
            <div className="pl" style={{ borderBottom: 0 }}><b>Pago</b><b className="v">{formatBRL(paid)}</b><span style={{ width: 40 }} /></div>
          </div>
          {remaining > 0
            ? <div className="restante falta"><span>Falta</span><span className="v">{formatBRL(remaining)}</span></div>
            : change > 0
              ? <div className="restante troco"><span>TROCO (dinheiro)</span><span className="v">{formatBRL(change)}</span></div>
              : <div className="restante ok"><span>Conta fechada</span><span className="v">✓</span></div>}
          {err && <div className="err">{err}</div>}
        </div>
      </div>
    </Modal>
  );
}
