-- Caixa Certo — esquema inicial
-- Dinheiro em centavos (INTEGER). Quantidade em milésimos (INTEGER): KG = gramas.

CREATE TABLE store_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'Banca Demo',
  legal_name TEXT NOT NULL DEFAULT '',
  cnpj TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  receipt_footer TEXT NOT NULL DEFAULT 'Obrigado, volte sempre!',
  discount_limit_pct INTEGER NOT NULL DEFAULT 1000,      -- x100 (1000 = 10%)
  allow_negative_stock INTEGER NOT NULL DEFAULT 0,
  expiry_alert_days INTEGER NOT NULL DEFAULT 2,
  printer_host TEXT NOT NULL DEFAULT '',
  printer_port INTEGER NOT NULL DEFAULT 9100,
  scale_label_mode TEXT NOT NULL DEFAULT 'peso' CHECK (scale_label_mode IN ('peso','preco')),
  scale_code_digits INTEGER NOT NULL DEFAULT 5,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','gerente','operador')),
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE auth_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT ''
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  ean TEXT UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  unit TEXT NOT NULL DEFAULT 'KG' CHECK (unit IN ('KG','UN','BANDEJA','MACO','DUZIA','PCT')),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),  -- por kg (KG) ou por unidade
  cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0,                    -- milésimos (gramas p/ KG)
  min_stock INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  allow_negative INTEGER NOT NULL DEFAULT 0,
  shortcut_pos INTEGER UNIQUE CHECK (shortcut_pos IS NULL OR (shortcut_pos BETWEEN 1 AND 24)),
  icon TEXT NOT NULL DEFAULT '',
  ncm TEXT, cfop TEXT, cst TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_products_name ON products(name);

CREATE TABLE lots (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  lot_code TEXT,
  expiry_date TEXT,              -- YYYY-MM-DD
  qty_initial INTEGER NOT NULL,
  qty_left INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_lots_product ON lots(product_id);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('ENTRADA','VENDA','CANCELAMENTO','AJUSTE','PERDA','INICIAL')),
  qty INTEGER NOT NULL,             -- com sinal
  balance_after INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  ref_type TEXT, ref_id INTEGER,
  lot_id INTEGER REFERENCES lots(id),
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_stock_mov_product ON stock_movements(product_id, id);

CREATE TABLE losses (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  reason TEXT NOT NULL CHECK (reason IN ('amadureceu','estragou','queda','consumo_interno')),
  cost_cents INTEGER NOT NULL DEFAULT 0,     -- custo total estimado da perda
  note TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  authorized_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  doc TEXT NOT NULL DEFAULT '',
  credit_limit_cents INTEGER NOT NULL DEFAULT 0,
  balance_cents INTEGER NOT NULL DEFAULT 0,      -- quanto deve
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE cash_sessions (
  id INTEGER PRIMARY KEY,
  terminal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO','FECHADO')),
  opened_by INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  opening_float_cents INTEGER NOT NULL DEFAULT 0,
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT,
  note TEXT
);
-- Uma sessão aberta por terminal
CREATE UNIQUE INDEX ux_cash_one_open ON cash_sessions(terminal) WHERE status = 'ABERTO';

CREATE TABLE cash_session_counts (
  session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  method TEXT NOT NULL,
  expected_cents INTEGER NOT NULL,
  counted_cents INTEGER NOT NULL,
  PRIMARY KEY (session_id, method)
);

CREATE TABLE cash_movements (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  type TEXT NOT NULL CHECK (type IN ('ABERTURA','VENDA','SANGRIA','SUPRIMENTO','ESTORNO','RECEBIMENTO_FIADO')),
  method TEXT NOT NULL CHECK (method IN ('dinheiro','pix','debito','credito','voucher','fiado')),
  amount_cents INTEGER NOT NULL,      -- com sinal (entrada +, saída -)
  ref_type TEXT, ref_id INTEGER,
  note TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  authorized_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_cash_mov_session ON cash_movements(session_id);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  terminal TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  customer_id INTEGER REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'FINALIZADA' CHECK (status IN ('FINALIZADA','CANCELADA')),
  gross_cents INTEGER NOT NULL,
  item_discount_cents INTEGER NOT NULL DEFAULT 0,
  total_discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  paid_cents INTEGER NOT NULL,
  change_cents INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  discount_authorized_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  canceled_at TEXT, canceled_by INTEGER REFERENCES users(id),
  cancel_authorized_by INTEGER REFERENCES users(id), cancel_reason TEXT
);
CREATE INDEX idx_sales_created ON sales(created_at);

CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  gross_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);

CREATE TABLE sale_payments (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL CHECK (method IN ('dinheiro','pix','debito','credito','voucher','fiado')),
  amount_cents INTEGER NOT NULL,   -- valor entregue (dinheiro pode ter troco)
  net_cents INTEGER NOT NULL       -- valor que fica no caixa (dinheiro - troco)
);

CREATE TABLE held_sales (
  id INTEGER PRIMARY KEY,
  terminal TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE customer_ledger (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  type TEXT NOT NULL CHECK (type IN ('COMPRA','LANCAMENTO','RECEBIMENTO','ESTORNO')),
  amount_cents INTEGER NOT NULL,       -- + aumenta dívida, - diminui
  balance_after INTEGER NOT NULL,
  method TEXT,
  sale_id INTEGER REFERENCES sales(id),
  session_id INTEGER REFERENCES cash_sessions(id),
  note TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_ledger_customer ON customer_ledger(customer_id, id);

CREATE TABLE fiscal_documents (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  access_key TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
