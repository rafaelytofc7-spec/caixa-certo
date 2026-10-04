import type { DB } from '../db';
import { bad, notFound } from '../errors';
import { getSettings } from '../settings';
import { audit } from '../audit';
import { authorizeManager, AuthUser } from '../auth';
import { LossReason, LOSS_LABEL, formatQty, Unit } from '@folha/shared';

export type StockType = 'ENTRADA' | 'VENDA' | 'CANCELAMENTO' | 'AJUSTE' | 'PERDA' | 'INICIAL';

export interface StockMove {
  productId: number; delta: number; type: StockType; userId: number | null;
  unitCost?: number; refType?: string; refId?: number; lotId?: number | null; note?: string;
  /** checa estoque negativo (padrão true para saídas) */
  checkNegative?: boolean;
}

/** Deve ser chamado DENTRO de uma transação. */
export function applyStock(db: DB, m: StockMove): number {
  const p = db.prepare('SELECT id, name, unit, stock_qty, allow_negative, cost_cents FROM products WHERE id = ?').get(m.productId) as any;
  if (!p) throw notFound('Produto não encontrado.');
  if (!Number.isInteger(m.delta) || m.delta === 0) throw bad('Quantidade inválida.');
  const next = p.stock_qty + m.delta;
  const check = m.checkNegative ?? m.delta < 0;
  if (check && m.delta < 0 && next < 0) {
    const s = getSettings(db);
    if (!s.allow_negative_stock && !p.allow_negative) {
      throw bad(`Estoque insuficiente de ${p.name}: tem ${formatQty(Math.max(0, p.stock_qty), p.unit as Unit)}. ` +
        'Libere estoque negativo nas configurações se a banca precisar.', 'ESTOQUE_INSUFICIENTE');
    }
  }
  db.prepare("UPDATE products SET stock_qty = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(next, p.id);
  if (m.delta < 0) consumeLots(db, p.id, -m.delta);
  db.prepare(`INSERT INTO stock_movements(product_id, type, qty, balance_after, unit_cost_cents, ref_type, ref_id, lot_id, note, user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(p.id, m.type, m.delta, next, m.unitCost ?? p.cost_cents, m.refType ?? null,
    m.refId ?? null, m.lotId ?? null, m.note ?? null, m.userId);
  return next;
}

/** Baixa nos lotes (primeiro o que vence antes). Informativo: não bloqueia. */
function consumeLots(db: DB, productId: number, qty: number) {
  const lots = db.prepare(`SELECT id, qty_left FROM lots WHERE product_id = ? AND qty_left > 0
    ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date, id`).all(productId) as any[];
  let left = qty;
  const upd = db.prepare('UPDATE lots SET qty_left = ? WHERE id = ?');
  for (const l of lots) {
    if (left <= 0) break;
    const take = Math.min(l.qty_left, left);
    upd.run(l.qty_left - take, l.id);
    left -= take;
  }
}

export function stockEntry(db: DB, user: AuthUser, input: {
  product_id: number; qty: number; unit_cost_cents?: number; lot_code?: string | null; expiry_date?: string | null;
  note?: string | null; update_cost?: boolean;
}) {
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw bad('Quantidade da entrada deve ser maior que zero.');
  return db.transaction(() => {
    const p = db.prepare('SELECT id, cost_cents FROM products WHERE id = ?').get(input.product_id) as any;
    if (!p) throw notFound('Produto não encontrado.');
    let lotId: number | null = null;
    if (input.lot_code || input.expiry_date) {
      lotId = Number(db.prepare('INSERT INTO lots(product_id, lot_code, expiry_date, qty_initial, qty_left) VALUES (?,?,?,?,?)')
        .run(p.id, input.lot_code || null, input.expiry_date || null, input.qty, input.qty).lastInsertRowid);
    }
    const cost = input.unit_cost_cents ?? p.cost_cents;
    if (input.unit_cost_cents != null && input.update_cost !== false)
      db.prepare('UPDATE products SET cost_cents = ? WHERE id = ?').run(input.unit_cost_cents, p.id);
    const bal = applyStock(db, { productId: p.id, delta: input.qty, type: 'ENTRADA', userId: user.id, unitCost: cost,
      lotId, note: input.note || 'Entrada de compra', refType: lotId ? 'lote' : undefined, refId: lotId ?? undefined });
    audit(db, user.id, 'ESTOQUE_ENTRADA', 'product', p.id, { qty: input.qty, cost, lotId, expiry: input.expiry_date });
    return { balance: bal, lot_id: lotId };
  })();
}

export function stockAdjust(db: DB, user: AuthUser, input: { product_id: number; counted_qty: number; note?: string | null; manager_pin?: string | null }) {
  if (!Number.isInteger(input.counted_qty)) throw bad('Quantidade contada inválida.');
  const authBy = authorizeManager(db, user, input.manager_pin, 'Ajuste de estoque');
  return db.transaction(() => {
    const p = db.prepare('SELECT id, stock_qty FROM products WHERE id = ?').get(input.product_id) as any;
    if (!p) throw notFound('Produto não encontrado.');
    const delta = input.counted_qty - p.stock_qty;
    if (delta === 0) return { balance: p.stock_qty, delta: 0 };
    const bal = applyStock(db, { productId: p.id, delta, type: 'AJUSTE', userId: user.id, checkNegative: false,
      note: input.note || 'Ajuste de contagem' });
    audit(db, user.id, 'ESTOQUE_AJUSTE', 'product', p.id, { from: p.stock_qty, to: input.counted_qty, authorized_by: authBy });
    return { balance: bal, delta };
  })();
}

export function registerLoss(db: DB, user: AuthUser, input: {
  product_id: number; qty: number; reason: LossReason; note?: string | null; manager_pin?: string | null;
}) {
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw bad('Quantidade da perda deve ser maior que zero.');
  if (!LOSS_LABEL[input.reason]) throw bad('Motivo de perda inválido.');
  const authBy = authorizeManager(db, user, input.manager_pin, 'Perda/quebra');
  return db.transaction(() => {
    const p = db.prepare('SELECT id, name, cost_cents FROM products WHERE id = ?').get(input.product_id) as any;
    if (!p) throw notFound('Produto não encontrado.');
    const cost = Math.round((p.cost_cents * input.qty) / 1000);
    const lossId = Number(db.prepare(`INSERT INTO losses(product_id, qty, reason, cost_cents, note, user_id, authorized_by)
      VALUES (?,?,?,?,?,?,?)`).run(p.id, input.qty, input.reason, cost, input.note || null, user.id, authBy).lastInsertRowid);
    const bal = applyStock(db, { productId: p.id, delta: -input.qty, type: 'PERDA', userId: user.id, refType: 'perda', refId: lossId,
      note: `Perda: ${LOSS_LABEL[input.reason]}${input.note ? ' — ' + input.note : ''}` });
    audit(db, user.id, 'PERDA', 'loss', lossId, { product: p.name, qty: input.qty, reason: input.reason, cost, authorized_by: authBy });
    return { id: lossId, balance: bal, cost_cents: cost };
  })();
}

export function kardex(db: DB, productId: number, limit = 200) {
  return db.prepare(`SELECT m.*, u.name AS user_name FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.product_id = ? ORDER BY m.id DESC LIMIT ?`).all(productId, limit);
}

export function expiringLots(db: DB, days?: number) {
  const d = days ?? getSettings(db).expiry_alert_days;
  return db.prepare(`SELECT l.*, p.name AS product_name, p.unit, p.icon,
      CAST(julianday(l.expiry_date) - julianday(date('now','localtime')) AS INTEGER) AS days_left
    FROM lots l JOIN products p ON p.id = l.product_id
    WHERE l.qty_left > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date <= date('now','localtime', ?) AND p.deleted_at IS NULL
    ORDER BY l.expiry_date`).all(`+${d} days`);
}

export function lowStock(db: DB) {
  return db.prepare(`SELECT id, name, unit, stock_qty, min_stock, icon FROM products
    WHERE active = 1 AND stock_qty <= min_stock ORDER BY name`).all();
}

export function listLosses(db: DB, from: string, to: string) {
  return db.prepare(`SELECT l.*, p.name AS product_name, p.unit, u.name AS user_name, a.name AS authorized_name
    FROM losses l JOIN products p ON p.id = l.product_id JOIN users u ON u.id = l.user_id
    LEFT JOIN users a ON a.id = l.authorized_by
    WHERE date(l.created_at) BETWEEN ? AND ? ORDER BY l.id DESC`).all(from, to);
}
