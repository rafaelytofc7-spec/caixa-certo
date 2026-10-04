import type { DB } from './db';
import type { StoreSettings } from '@folha/shared';

export function getSettings(db: DB): StoreSettings {
  const r = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as any;
  return {
    name: r.name, legal_name: r.legal_name, cnpj: r.cnpj, address: r.address, phone: r.phone,
    receipt_footer: r.receipt_footer, discount_limit_pct: r.discount_limit_pct,
    allow_negative_stock: !!r.allow_negative_stock, expiry_alert_days: r.expiry_alert_days,
    printer_host: r.printer_host, printer_port: r.printer_port,
    scale_label_mode: r.scale_label_mode, scale_code_digits: r.scale_code_digits,
  };
}

export function updateSettings(db: DB, s: Partial<StoreSettings>) {
  const cur = getSettings(db);
  const n = { ...cur, ...s };
  db.prepare(`UPDATE store_settings SET name=?, legal_name=?, cnpj=?, address=?, phone=?, receipt_footer=?,
    discount_limit_pct=?, allow_negative_stock=?, expiry_alert_days=?, printer_host=?, printer_port=?,
    scale_label_mode=?, scale_code_digits=?, updated_at=datetime('now','localtime') WHERE id=1`).run(
    n.name, n.legal_name, n.cnpj, n.address, n.phone, n.receipt_footer, n.discount_limit_pct,
    n.allow_negative_stock ? 1 : 0, n.expiry_alert_days, n.printer_host, n.printer_port,
    n.scale_label_mode, n.scale_code_digits);
  return getSettings(db);
}
