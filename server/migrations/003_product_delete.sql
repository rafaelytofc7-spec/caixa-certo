-- v3.1: apagar produto. Com histórico: some das telas (deleted_at), sem histórico: DELETE de verdade.
ALTER TABLE products ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_products_deleted ON products(deleted_at);
