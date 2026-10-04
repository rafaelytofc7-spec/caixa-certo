import type { DB } from '../db';
import { bad, notFound } from '../errors';
import { audit } from '../audit';
import { authorizeManager, AuthUser } from '../auth';
import { requireOpenSession, addCashMovement } from './cash';
import { PaymentMethod, formatBRL } from '@folha/shared';

export function listCustomers(db: DB, q?: string) {
  const like = `%${(q ?? '').trim()}%`;
  return db.prepare(`SELECT * FROM customers WHERE (name LIKE ? OR phone LIKE ? OR doc LIKE ?) ORDER BY active DESC, name`).all(like, like, like);
}

export function getCustomer(db: DB, id: number) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
  if (!c) throw notFound('Cliente não encontrado.');
  return c;
}

export function saveCustomer(db: DB, user: AuthUser, id: number | null, d: {
  name: string; phone?: string; doc?: string; credit_limit_cents: number; active?: boolean; note?: string;
}) {
  if (!d.name?.trim()) throw bad('Nome do cliente é obrigatório.');
  if (!Number.isInteger(d.credit_limit_cents) || d.credit_limit_cents < 0) throw bad('Limite inválido.');
  if (id) {
    getCustomer(db, id);
    db.prepare('UPDATE customers SET name=?, phone=?, doc=?, credit_limit_cents=?, active=?, note=? WHERE id=?')
      .run(d.name.trim(), d.phone ?? '', d.doc ?? '', d.credit_limit_cents, d.active === false ? 0 : 1, d.note ?? '', id);
    audit(db, user.id, 'CLIENTE_ALTERADO', 'customer', id, d);
    return getCustomer(db, id);
  }
  const nid = Number(db.prepare('INSERT INTO customers(name, phone, doc, credit_limit_cents, active, note) VALUES (?,?,?,?,?,?)')
    .run(d.name.trim(), d.phone ?? '', d.doc ?? '', d.credit_limit_cents, d.active === false ? 0 : 1, d.note ?? '').lastInsertRowid);
  audit(db, user.id, 'CLIENTE_CRIADO', 'customer', nid, d);
  return getCustomer(db, nid);
}

/** Lançamento no fiado (dentro de transação). amount>0 aumenta dívida; <0 diminui. */
export function ledgerEntry(db: DB, e: {
  customerId: number; type: 'COMPRA' | 'LANCAMENTO' | 'RECEBIMENTO' | 'ESTORNO'; amount: number; userId: number;
  saleId?: number | null; sessionId?: number | null; method?: string | null; note?: string | null; checkLimit?: boolean;
}) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(e.customerId) as any;
  if (!c) throw notFound('Cliente não encontrado.');
  const next = c.balance_cents + e.amount;
  if (e.checkLimit && e.amount > 0) {
    if (!c.active) throw bad('Cliente inativo não pode comprar fiado.');
    if (next > c.credit_limit_cents)
      throw bad(`Limite do fiado estourado para ${c.name}: deve ${formatBRL(c.balance_cents)}, limite ${formatBRL(c.credit_limit_cents)}, ` +
        `disponível ${formatBRL(Math.max(0, c.credit_limit_cents - c.balance_cents))}.`, 'LIMITE_FIADO');
  }
  db.prepare('UPDATE customers SET balance_cents = ? WHERE id = ?').run(next, c.id);
  db.prepare(`INSERT INTO customer_ledger(customer_id, type, amount_cents, balance_after, method, sale_id, session_id, note, user_id)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(c.id, e.type, e.amount, next, e.method ?? null, e.saleId ?? null, e.sessionId ?? null, e.note ?? null, e.userId);
  return next;
}

export function chargeCustomer(db: DB, user: AuthUser, customerId: number, amount: number, note: string | null, managerPin?: string | null) {
  if (!Number.isInteger(amount) || amount <= 0) throw bad('Valor deve ser maior que zero.');
  const by = authorizeManager(db, user, managerPin, 'Lançamento manual no fiado');
  return db.transaction(() => {
    const bal = ledgerEntry(db, { customerId, type: 'LANCAMENTO', amount, userId: user.id, note, checkLimit: true });
    audit(db, user.id, 'FIADO_LANCAMENTO', 'customer', customerId, { amount, note, authorized_by: by });
    return { balance_cents: bal };
  })();
}

export function receiveCustomer(db: DB, user: AuthUser, terminal: string, customerId: number, amount: number, method: PaymentMethod, note?: string | null) {
  if (!Number.isInteger(amount) || amount <= 0) throw bad('Valor deve ser maior que zero.');
  if (method === 'fiado') throw bad('Recebimento de fiado não pode ser em fiado.');
  return db.transaction(() => {
    const c = getCustomer(db, customerId);
    if (amount > c.balance_cents) throw bad(`Valor maior que a dívida (${formatBRL(c.balance_cents)}).`);
    const s = requireOpenSession(db, terminal);
    const bal = ledgerEntry(db, { customerId, type: 'RECEBIMENTO', amount: -amount, userId: user.id, sessionId: s.id, method, note });
    const mv = addCashMovement(db, { sessionId: s.id, type: 'RECEBIMENTO_FIADO', method, amount, userId: user.id,
      refType: 'customer', refId: customerId, note: `Recebimento fiado — ${c.name}` });
    audit(db, user.id, 'FIADO_RECEBIMENTO', 'customer', customerId, { amount, method, movement: mv });
    return { balance_cents: bal };
  })();
}

export function customerStatement(db: DB, customerId: number) {
  const c = getCustomer(db, customerId);
  const entries = db.prepare(`SELECT l.*, u.name AS user_name, s.number AS sale_number FROM customer_ledger l
    JOIN users u ON u.id = l.user_id LEFT JOIN sales s ON s.id = l.sale_id WHERE l.customer_id = ? ORDER BY l.id DESC`).all(customerId);
  return { customer: c, entries };
}
