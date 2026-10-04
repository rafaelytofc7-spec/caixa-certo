import type { DB } from '../db';
import { bad, notFound } from '../errors';
import { audit } from '../audit';
import type { AuthUser } from '../auth';
import { applyStock } from './stock';

export const listSuppliers = (db: DB) => db.prepare('SELECT * FROM suppliers ORDER BY active DESC, name').all();

export function saveSupplier(db: DB, user: AuthUser, id: number | null, b: { name: string; phone?: string; doc?: string; note?: string; active?: boolean }) {
  const name = b.name.trim();
  if (!name) throw bad('Nome do fornecedor é obrigatório.');
  let sid = id;
  if (id == null) {
    sid = Number(db.prepare('INSERT INTO suppliers(name, phone, doc, note, active) VALUES (?,?,?,?,?)')
      .run(name, b.phone ?? '', b.doc ?? '', b.note ?? '', b.active === false ? 0 : 1).lastInsertRowid);
  } else {
    const r = db.prepare('UPDATE suppliers SET name=?, phone=COALESCE(?, phone), doc=COALESCE(?, doc), note=COALESCE(?, note), active=COALESCE(?, active) WHERE id=?')
      .run(name, b.phone ?? null, b.doc ?? null, b.note ?? null, b.active == null ? null : b.active ? 1 : 0, id);
    if (!r.changes) throw notFound('Fornecedor não encontrado.');
  }
  audit(db, user.id, id == null ? 'FORNECEDOR_CRIADO' : 'FORNECEDOR_ALTERADO', 'supplier', sid!, b);
  return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(sid);
}

export interface PurchaseItem { product_id: number; qty: number; unit_cost_cents?: number | null; lot_code?: string | null; expiry_date?: string | null }
export function purchaseEntry(db: DB, user: AuthUser, b: { supplier_id?: number | null; note?: string | null; items: PurchaseItem[] }) {
  if (!b.items?.length) throw bad('Inclua pelo menos um item na compra.');
  return db.transaction(() => {
    let supName: string | null = null;
    if (b.supplier_id != null) {
      const s = db.prepare('SELECT name FROM suppliers WHERE id = ? AND active = 1').get(b.supplier_id) as any;
      if (!s) throw notFound('Fornecedor não encontrado ou inativo.');
      supName = s.name;
    }
    const pid = Number(db.prepare('INSERT INTO purchases(supplier_id, user_id, note) VALUES (?,?,?)').run(b.supplier_id ?? null, user.id, b.note || null).lastInsertRowid);
    let total = 0;
    for (const it of b.items) {
      const p = db.prepare('SELECT id, name, cost_cents FROM products WHERE id = ?').get(it.product_id) as any;
      if (!p) throw notFound('Produto não encontrado.');
      if (!Number.isInteger(it.qty) || it.qty <= 0) throw bad(`Quantidade inválida em ${p.name}.`);
      let lotId: number | null = null;
      if (it.lot_code || it.expiry_date) {
        lotId = Number(db.prepare('INSERT INTO lots(product_id, lot_code, expiry_date, qty_initial, qty_left) VALUES (?,?,?,?,?)')
          .run(p.id, it.lot_code || null, it.expiry_date || null, it.qty, it.qty).lastInsertRowid);
      }
      const cost = it.unit_cost_cents ?? p.cost_cents;
      if (it.unit_cost_cents != null) db.prepare('UPDATE products SET cost_cents = ? WHERE id = ?').run(it.unit_cost_cents, p.id);
      applyStock(db, { productId: p.id, delta: it.qty, type: 'ENTRADA', userId: user.id, unitCost: cost, lotId, refType: 'compra', refId: pid,
        note: `Compra nº ${pid}${supName ? ' — ' + supName : ''}` });
      db.prepare('UPDATE stock_movements SET supplier_id = ? WHERE id = (SELECT MAX(id) FROM stock_movements WHERE product_id = ?)').run(b.supplier_id ?? null, p.id);
      total += Math.round((cost * it.qty) / 1000);
    }
    db.prepare('UPDATE purchases SET total_cents = ?, items_count = ? WHERE id = ?').run(total, b.items.length, pid);
    audit(db, user.id, 'COMPRA_ENTRADA', 'purchase', pid, { supplier: supName, items: b.items.length, total });
    return { id: pid, total_cents: total, items_count: b.items.length };
  })();
}

export const listPurchases = (db: DB, from: string, to: string) => db.prepare(`SELECT pu.*, date(pu.created_at) AS local_date, s.name AS supplier_name, u.name AS user_name
  FROM purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id JOIN users u ON u.id = pu.user_id
  WHERE date(pu.created_at) BETWEEN ? AND ? ORDER BY pu.id DESC`).all(from, to);

export const purchaseItems = (db: DB, id: number) => db.prepare(`SELECT m.product_id, p.name, p.unit, m.qty, m.unit_cost_cents FROM stock_movements m
  JOIN products p ON p.id = m.product_id WHERE m.ref_type = 'compra' AND m.ref_id = ? ORDER BY m.id`).all(id);

export function pricesUpdate(db: DB, user: AuthUser, items: Array<{ id: number; price_cents: number }>) {
  return db.transaction(() => {
    const log: any[] = [];
    for (const it of items) {
      if (!Number.isInteger(it.price_cents) || it.price_cents < 0) throw bad('Preço inválido.');
      const p = db.prepare('SELECT name, price_cents FROM products WHERE id = ?').get(it.id) as any;
      if (!p) throw notFound('Produto não encontrado.');
      if (p.price_cents !== it.price_cents) {
        db.prepare("UPDATE products SET price_cents = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(it.price_cents, it.id);
        log.push({ produto: p.name, de: p.price_cents, para: it.price_cents });
      }
    }
    if (log.length) audit(db, user.id, 'PRECOS_DO_DIA', 'products', null as any, { alterados: log.length, itens: log });
    return { changed: log.length };
  })();
}
