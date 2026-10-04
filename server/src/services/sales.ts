import type { DB } from '../db';
import { bad, conflict, notFound } from '../errors';
import { audit } from '../audit';
import { authorizeManager, AuthUser } from '../auth';
import { getSettings } from '../settings';
import { applyStock } from './stock';
import { requireOpenSession, addCashMovement, getOpenSession } from './cash';
import { ledgerEntry } from './customers';
import { emitFiscal } from './fiscal';
import { calcSale, calcChange, CartItemInput, Discount, PaymentInput, pctToText, PAYMENT_LABEL } from '@folha/shared';

export interface SaleInput {
  items: CartItemInput[];
  total_discount?: Discount | null;
  payments: PaymentInput[];
  customer_id?: number | null;
  manager_pin?: string | null;
}

export function createSale(db: DB, user: AuthUser, terminal: string, input: SaleInput) {
  if (!input.items?.length) throw bad('Carrinho vazio.');
  if (!input.payments?.length) throw bad('Informe o pagamento.');
  const settings = getSettings(db);
  const getP = db.prepare('SELECT * FROM products WHERE id = ?');
  const prods = input.items.map((it) => {
    const p = getP.get(it.product_id) as any;
    if (!p) throw notFound(`Produto ${it.product_id} não encontrado.`);
    if (!p.active) throw bad(`${p.name} está inativo e não pode ser vendido.`, 'PRODUTO_INATIVO');
    if (!Number.isInteger(it.qty) || it.qty <= 0) throw bad(`Quantidade inválida para ${p.name}.`);
    if (p.unit !== 'KG' && it.qty % 1000 !== 0) throw bad(`${p.name} é vendido por unidade inteira.`);
    return p;
  });
  const calc = calcSale(input.items.map((it, i) => ({ qty: it.qty, discount: it.discount, price_cents: prods[i].price_cents })), input.total_discount);
  if (calc.total_cents <= 0) throw bad('Total da venda precisa ser maior que zero.');

  let discountBy: number | null = null;
  if (calc.discount_cents > 0 && calc.discount_pct_x100 > settings.discount_limit_pct) {
    discountBy = authorizeManager(db, user, input.manager_pin,
      `Desconto de ${pctToText(calc.discount_pct_x100)} acima do limite de ${pctToText(settings.discount_limit_pct)}`);
  }

  const pay = calcChange(calc.total_cents, input.payments);
  if (!pay.ok) throw bad(pay.error, 'PAGAMENTO');
  const fiadoTotal = input.payments.filter((p) => p.method === 'fiado').reduce((a, p) => a + p.amount_cents, 0);
  if (fiadoTotal > 0 && !input.customer_id) throw bad('Fiado precisa de cliente.', 'FIADO_SEM_CLIENTE');

  const run = db.transaction(() => {
    const session = requireOpenSession(db, terminal);
    const number = ((db.prepare('SELECT MAX(number) AS n FROM sales').get() as any).n ?? 0) + 1;
    const cost = input.items.reduce((a, it, i) => a + Math.round((prods[i].cost_cents * it.qty) / 1000), 0);
    const saleId = Number(db.prepare(`INSERT INTO sales(number, session_id, terminal, user_id, customer_id, gross_cents, item_discount_cents,
        total_discount_cents, total_cents, paid_cents, change_cents, cost_cents, discount_authorized_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(number, session.id, terminal, user.id, input.customer_id ?? null, calc.gross_cents,
      calc.item_discount_cents, calc.total_discount_cents, calc.total_cents, pay.paid_cents, pay.change_cents, cost, discountBy).lastInsertRowid);

    const insItem = db.prepare(`INSERT INTO sale_items(sale_id, product_id, name, unit, qty, unit_price_cents, gross_cents, discount_cents, total_cents, unit_cost_cents)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    input.items.forEach((it, i) => {
      const p = prods[i]; const l = calc.lines[i];
      insItem.run(saleId, p.id, p.name, p.unit, it.qty, p.price_cents, l.gross_cents, l.discount_cents, l.total_cents, p.cost_cents);
      applyStock(db, { productId: p.id, delta: -it.qty, type: 'VENDA', userId: user.id, refType: 'venda', refId: saleId, note: `Venda nº ${number}` });
    });

    // Pagamentos: troco sai do dinheiro
    let changeLeft = pay.change_cents;
    const insPay = db.prepare('INSERT INTO sale_payments(sale_id, method, amount_cents, net_cents) VALUES (?,?,?,?)');
    for (const p of input.payments) {
      let net = p.amount_cents;
      if (p.method === 'dinheiro' && changeLeft > 0) { const c = Math.min(changeLeft, net); net -= c; changeLeft -= c; }
      insPay.run(saleId, p.method, p.amount_cents, net);
      if (net !== 0) addCashMovement(db, { sessionId: session.id, type: 'VENDA', method: p.method, amount: net, userId: user.id,
        refType: 'venda', refId: saleId, note: `Venda nº ${number}` });
    }
    if (fiadoTotal > 0) {
      ledgerEntry(db, { customerId: input.customer_id!, type: 'COMPRA', amount: fiadoTotal, userId: user.id, saleId, sessionId: session.id,
        method: 'fiado', note: `Venda nº ${number}`, checkLimit: true });
    }
    audit(db, user.id, 'VENDA', 'sale', saleId, {
      number, total: calc.total_cents, payments: input.payments.map((p) => `${PAYMENT_LABEL[p.method]} ${p.amount_cents}`),
      discount: calc.discount_cents, discount_authorized_by: discountBy,
    });
    return saleId;
  });
  const saleId = run();
  const sale = getSale(db, saleId);
  emitFiscal(db, sale);
  return getSale(db, saleId);
}

export function getSale(db: DB, id: number) {
  const s = db.prepare(`SELECT s.*, u.name AS user_name, c.name AS customer_name, cu.name AS canceled_by_name
    FROM sales s JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users cu ON cu.id = s.canceled_by WHERE s.id = ?`).get(id) as any;
  if (!s) throw notFound('Venda não encontrada.');
  s.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(id);
  s.payments = db.prepare('SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY id').all(id);
  s.fiscal = db.prepare('SELECT provider, status, access_key FROM fiscal_documents WHERE sale_id = ? ORDER BY id DESC LIMIT 1').get(id) ?? null;
  return s;
}

export function listSales(db: DB, from: string, to: string, terminal?: string) {
  return db.prepare(`SELECT s.id, s.number, s.status, s.total_cents, s.created_at, s.terminal, u.name AS user_name, c.name AS customer_name,
      (SELECT GROUP_CONCAT(method, '+') FROM sale_payments WHERE sale_id = s.id) AS methods,
      (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) AS items_count
    FROM sales s JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
    WHERE date(s.created_at) BETWEEN ? AND ? ${terminal ? 'AND s.terminal = ?' : ''} ORDER BY s.id DESC`)
    .all(...(terminal ? [from, to, terminal] : [from, to]));
}

/** Cancelamento do dia: estorna estoque, caixa e fiado. Precisa de gerente. */
export function cancelSale(db: DB, user: AuthUser, terminal: string, saleId: number, reason: string, managerPin?: string | null) {
  const authBy = authorizeManager(db, user, managerPin, 'Cancelamento de venda');
  return db.transaction(() => {
    const s = db.prepare(`SELECT *, date(created_at) = date('now','localtime') AS is_today FROM sales WHERE id = ?`).get(saleId) as any;
    if (!s) throw notFound('Venda não encontrada.');
    if (s.status !== 'FINALIZADA') throw conflict('Venda já cancelada.');
    if (!s.is_today) throw bad('Só dá para cancelar venda do dia.', 'FORA_DO_DIA');
    const orig = db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(s.session_id) as any;
    const session = orig.status === 'ABERTO' ? orig : getOpenSession(db, terminal);
    if (!session) throw conflict('Abra o caixa para estornar esta venda.', 'CAIXA_FECHADO');

    db.prepare(`UPDATE sales SET status='CANCELADA', canceled_at=datetime('now','localtime'), canceled_by=?, cancel_authorized_by=?, cancel_reason=? WHERE id=?`)
      .run(user.id, authBy, reason || null, s.id);
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(s.id) as any[];
    for (const it of items) applyStock(db, { productId: it.product_id, delta: it.qty, type: 'CANCELAMENTO', userId: user.id,
      refType: 'venda', refId: s.id, note: `Cancelamento venda nº ${s.number}`, checkNegative: false });
    const pays = db.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').all(s.id) as any[];
    for (const p of pays) {
      if (p.net_cents !== 0) addCashMovement(db, { sessionId: session.id, type: 'ESTORNO', method: p.method, amount: -p.net_cents,
        userId: user.id, authorizedBy: authBy, refType: 'venda', refId: s.id, note: `Estorno venda nº ${s.number}` });
      if (p.method === 'fiado' && s.customer_id) ledgerEntry(db, { customerId: s.customer_id, type: 'ESTORNO', amount: -p.net_cents,
        userId: user.id, saleId: s.id, sessionId: session.id, method: 'fiado', note: `Cancelamento venda nº ${s.number}` });
    }
    audit(db, user.id, 'VENDA_CANCELADA', 'sale', s.id, { number: s.number, total: s.total_cents, reason, authorized_by: authBy });
    return getSale(db, s.id);
  })();
}

// ---- vendas pausadas ----
export function holdSale(db: DB, user: AuthUser, terminal: string, label: string, payload: unknown) {
  const id = Number(db.prepare('INSERT INTO held_sales(terminal, user_id, label, payload) VALUES (?,?,?,?)')
    .run(terminal, user.id, label || 'Venda pausada', JSON.stringify(payload)).lastInsertRowid);
  audit(db, user.id, 'VENDA_PAUSADA', 'held_sale', id, { label });
  return { id };
}
export function listHeld(db: DB, terminal: string) {
  return (db.prepare(`SELECT h.*, u.name AS user_name FROM held_sales h JOIN users u ON u.id = h.user_id WHERE terminal = ? ORDER BY id`)
    .all(terminal) as any[]).map((h) => ({ ...h, payload: JSON.parse(h.payload) }));
}
export function resumeHeld(db: DB, user: AuthUser, id: number) {
  const h = db.prepare('SELECT * FROM held_sales WHERE id = ?').get(id) as any;
  if (!h) throw notFound('Venda pausada não encontrada.');
  db.prepare('DELETE FROM held_sales WHERE id = ?').run(id);
  audit(db, user.id, 'VENDA_RETOMADA', 'held_sale', id, { label: h.label });
  return { ...h, payload: JSON.parse(h.payload) };
}
