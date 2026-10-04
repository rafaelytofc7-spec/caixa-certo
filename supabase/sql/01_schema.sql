-- Caixa Certo — tabelas de negócio (uma "banca" por loja). Dinheiro em centavos; quantidade em milésimos (KG = gramas).
-- Toda tabela: loja_id (default = loja de quem está logado) + índice. Chaves estrangeiras entre tabelas de negócio são
-- compostas (loja_id, id): o banco não aceita ligar uma venda a um produto/cliente/caixa de OUTRA loja.

create table if not exists store_settings (
  loja_id uuid primary key default current_loja_id() references lojas(id) on delete cascade,
  name text not null default 'Minha loja',
  legal_name text not null default '',
  cnpj text not null default '',
  address text not null default '',
  phone text not null default '',
  receipt_footer text not null default 'Obrigado, volte sempre!',
  discount_limit_pct int not null default 1000,
  allow_negative_stock boolean not null default false,
  expiry_alert_days int not null default 2,
  printer_host text not null default '',
  printer_port int not null default 9100,
  scale_label_mode text not null default 'peso' check (scale_label_mode in ('peso','preco')),
  scale_code_digits int not null default 5,
  last_sale_number int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  name text not null,
  username text,
  auth_uid uuid unique references auth.users(id) on delete set null,
  role text not null check (role in ('admin','gerente','operador')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (loja_id, id),
  unique (loja_id, username)
);
create table if not exists user_pins (
  user_id int primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  pin_hash text not null,
  foreign key (loja_id, user_id) references users(loja_id, id) on delete cascade
);
create index if not exists idx_user_pins_loja on user_pins(loja_id);
create table if not exists op_sessions (
  token text primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  user_id int not null,
  auth_uid uuid not null,
  terminal text,
  created_at timestamptz not null default now(),
  foreign key (loja_id, user_id) references users(loja_id, id) on delete cascade
);
create index if not exists idx_op_sessions_loja on op_sessions(loja_id);

create table if not exists categories (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  name text not null,
  slug text not null,
  color text not null,
  icon text not null default '',
  unique (loja_id, id),
  unique (loja_id, slug)
);

create table if not exists products (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  code text not null,
  ean text,
  name text not null,
  category_id int not null,
  unit text not null default 'KG' check (unit in ('KG','UN','BANDEJA','MACO','DUZIA','PCT')),
  price_cents int not null check (price_cents >= 0),
  cost_cents int not null default 0 check (cost_cents >= 0),
  stock_qty int not null default 0,
  min_stock int not null default 0,
  active boolean not null default true,
  allow_negative boolean not null default false,
  shortcut_pos int check (shortcut_pos is null or shortcut_pos between 1 and 24),
  icon text not null default '',
  ncm text, cfop text, cst text,
  deleted_at timestamptz,   -- apagado com histórico fica escondido
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (loja_id, id),
  unique (loja_id, code),
  unique (loja_id, ean),
  unique (loja_id, shortcut_pos),
  foreign key (loja_id, category_id) references categories(loja_id, id)
);
create index if not exists idx_products_name on products(loja_id, name);

create table if not exists lots (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  product_id int not null,
  lot_code text,
  expiry_date date,
  qty_initial int not null,
  qty_left int not null,
  created_at timestamptz not null default now(),
  unique (loja_id, id),
  foreign key (loja_id, product_id) references products(loja_id, id)
);
create index if not exists idx_lots_product on lots(loja_id, product_id);

create table if not exists suppliers (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  name text not null,
  phone text not null default '',
  doc text not null default '',
  note text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (loja_id, id)
);

create table if not exists purchases (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  supplier_id int,
  user_id int not null,
  total_cents int not null default 0,
  items_count int not null default 0,
  note text,
  created_at timestamptz not null default now(),
  unique (loja_id, id),
  foreign key (loja_id, supplier_id) references suppliers(loja_id, id),
  foreign key (loja_id, user_id) references users(loja_id, id)
);

create table if not exists stock_movements (
  id bigserial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  product_id int not null,
  type text not null check (type in ('ENTRADA','VENDA','CANCELAMENTO','AJUSTE','PERDA','INICIAL','EXCLUSAO')),
  qty int not null,
  balance_after int not null,
  unit_cost_cents int not null default 0,
  ref_type text, ref_id bigint,
  lot_id int,
  note text,
  user_id int,
  supplier_id int,
  created_at timestamptz not null default now(),
  foreign key (loja_id, product_id) references products(loja_id, id),
  foreign key (loja_id, lot_id) references lots(loja_id, id),
  foreign key (loja_id, user_id) references users(loja_id, id),
  foreign key (loja_id, supplier_id) references suppliers(loja_id, id)
);
create index if not exists idx_stock_mov_product on stock_movements(loja_id, product_id, id);

create table if not exists losses (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  product_id int not null,
  qty int not null check (qty > 0),
  reason text not null check (reason in ('amadureceu','estragou','queda','consumo_interno')),
  cost_cents int not null default 0,
  note text,
  user_id int not null,
  authorized_by int,
  created_at timestamptz not null default now(),
  foreign key (loja_id, product_id) references products(loja_id, id),
  foreign key (loja_id, user_id) references users(loja_id, id),
  foreign key (loja_id, authorized_by) references users(loja_id, id)
);
create index if not exists idx_losses_loja on losses(loja_id, created_at);

create table if not exists customers (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  name text not null,
  phone text not null default '',
  doc text not null default '',
  credit_limit_cents int not null default 0,
  balance_cents int not null default 0,
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (loja_id, id)
);

create table if not exists cash_sessions (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  terminal text not null,
  status text not null default 'ABERTO' check (status in ('ABERTO','FECHADO')),
  opened_by int not null,
  opened_at timestamptz not null default now(),
  opening_float_cents int not null default 0,
  closed_by int,
  closed_at timestamptz,
  note text,
  unique (loja_id, id),
  foreign key (loja_id, opened_by) references users(loja_id, id),
  foreign key (loja_id, closed_by) references users(loja_id, id)
);
create unique index if not exists ux_cash_one_open on cash_sessions(loja_id, terminal) where status = 'ABERTO';

create table if not exists cash_session_counts (
  session_id int not null,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  method text not null,
  expected_cents int not null,
  counted_cents int not null,
  primary key (session_id, method),
  foreign key (loja_id, session_id) references cash_sessions(loja_id, id)
);
create index if not exists idx_cash_counts_loja on cash_session_counts(loja_id);

create table if not exists cash_movements (
  id bigserial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  session_id int not null,
  type text not null check (type in ('ABERTURA','VENDA','SANGRIA','SUPRIMENTO','ESTORNO','RECEBIMENTO_FIADO')),
  method text not null check (method in ('dinheiro','pix','debito','credito','voucher','fiado')),
  amount_cents int not null,
  ref_type text, ref_id bigint,
  note text,
  user_id int not null,
  authorized_by int,
  created_at timestamptz not null default now(),
  foreign key (loja_id, session_id) references cash_sessions(loja_id, id),
  foreign key (loja_id, user_id) references users(loja_id, id),
  foreign key (loja_id, authorized_by) references users(loja_id, id)
);
create index if not exists idx_cash_mov_session on cash_movements(loja_id, session_id);

create table if not exists sales (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  number int not null,
  client_uuid uuid,                -- idempotência (fila offline)
  offline boolean not null default false,
  imported boolean not null default false,
  session_id int,
  terminal text not null,
  user_id int not null,
  customer_id int,
  status text not null default 'FINALIZADA' check (status in ('FINALIZADA','CANCELADA','EXCLUIDA')),
  gross_cents int not null,
  item_discount_cents int not null default 0,
  total_discount_cents int not null default 0,
  total_cents int not null,
  paid_cents int not null,
  change_cents int not null default 0,
  cost_cents int not null default 0,
  discount_authorized_by int,
  created_at timestamptz not null default now(),
  canceled_at timestamptz, canceled_by int, cancel_authorized_by int, cancel_reason text,
  deleted_at timestamptz, deleted_by int, delete_reason text, deleted_prev_status text,
  unique (loja_id, id),
  unique (loja_id, number),
  unique (loja_id, client_uuid),
  constraint sales_session_or_imported check (session_id is not null or imported),
  foreign key (loja_id, session_id) references cash_sessions(loja_id, id),
  foreign key (loja_id, user_id) references users(loja_id, id),
  foreign key (loja_id, customer_id) references customers(loja_id, id),
  foreign key (loja_id, discount_authorized_by) references users(loja_id, id),
  foreign key (loja_id, canceled_by) references users(loja_id, id),
  foreign key (loja_id, cancel_authorized_by) references users(loja_id, id),
  foreign key (loja_id, deleted_by) references users(loja_id, id)
);
create index if not exists idx_sales_created on sales(loja_id, created_at);

create table if not exists promotions (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  product_id int not null,
  promo_price_cents int not null check (promo_price_cents > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  ended_at timestamptz,
  note text,
  created_by int,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (loja_id, id),
  foreign key (loja_id, product_id) references products(loja_id, id) on delete cascade,
  foreign key (loja_id, created_by) references users(loja_id, id)
);
create index if not exists idx_promotions_product on promotions(loja_id, product_id, ends_at);

create table if not exists sale_items (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  sale_id int not null,
  product_id int,                  -- null = item livre de encomenda
  name text not null,
  unit text not null,
  qty int not null,
  unit_price_cents int not null,
  gross_cents int not null,
  discount_cents int not null default 0,
  total_cents int not null,
  unit_cost_cents int not null default 0,
  promotion_id int,
  regular_price_cents int,
  foreign key (loja_id, sale_id) references sales(loja_id, id),
  foreign key (loja_id, product_id) references products(loja_id, id),
  foreign key (loja_id, promotion_id) references promotions(loja_id, id)
);
create index if not exists idx_sale_items_sale on sale_items(loja_id, sale_id);

create table if not exists sale_payments (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  sale_id int not null,
  method text not null check (method in ('dinheiro','pix','debito','credito','voucher','fiado','nao_informado')),
  amount_cents int not null,
  net_cents int not null,
  foreign key (loja_id, sale_id) references sales(loja_id, id)
);
create index if not exists idx_sale_payments_sale on sale_payments(loja_id, sale_id);

create table if not exists held_sales (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  terminal text not null,
  user_id int not null,
  label text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (loja_id, user_id) references users(loja_id, id)
);
create index if not exists idx_held_loja on held_sales(loja_id);

create table if not exists customer_ledger (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  customer_id int not null,
  type text not null check (type in ('COMPRA','LANCAMENTO','RECEBIMENTO','ESTORNO')),
  amount_cents int not null,
  balance_after int not null,
  method text,
  sale_id int,
  session_id int,
  note text,
  user_id int not null,
  created_at timestamptz not null default now(),
  foreign key (loja_id, customer_id) references customers(loja_id, id),
  foreign key (loja_id, sale_id) references sales(loja_id, id),
  foreign key (loja_id, session_id) references cash_sessions(loja_id, id),
  foreign key (loja_id, user_id) references users(loja_id, id)
);
create index if not exists idx_ledger_customer on customer_ledger(loja_id, customer_id, id);

create table if not exists fiscal_documents (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  sale_id int not null,
  provider text not null,
  status text not null,
  access_key text,
  payload jsonb,
  created_at timestamptz not null default now(),
  foreign key (loja_id, sale_id) references sales(loja_id, id)
);
create index if not exists idx_fiscal_loja on fiscal_documents(loja_id, sale_id);

create table if not exists audit_log (
  id bigserial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  user_id int,
  action text not null,
  entity text,
  entity_id bigint,
  details jsonb,
  created_at timestamptz not null default now(),
  foreign key (loja_id, user_id) references users(loja_id, id)
);
create index if not exists idx_audit_created on audit_log(loja_id, created_at);

-- encomendas (cliente pede, avisa pelo WhatsApp quando chega, conclui virando venda de verdade)
create table if not exists orders (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  customer_id int,
  customer_name text not null,
  phone text not null default '',              -- só dígitos, com DDD (ex.: 11987654321)
  paid boolean not null default false,
  paid_method text check (paid_method in ('dinheiro','pix','debito','credito','voucher','fiado')),
  delivery text not null default 'a_combinar' check (delivery in ('buscar','entrega','a_combinar')),
  address text not null default '',
  note text not null default '',
  status text not null default 'AGUARDANDO' check (status in ('AGUARDANDO','AVISADA','PRONTA','CONCLUIDA','CANCELADA')),
  notified_at timestamptz, notified_count int not null default 0, notified_by int,
  ready_at timestamptz,
  concluded_at timestamptz, concluded_by int,
  canceled_at timestamptz, canceled_by int, cancel_reason text,
  sale_id int,
  imported boolean not null default false,
  legacy_id text,
  created_by int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (loja_id, id),
  unique (loja_id, legacy_id),
  foreign key (loja_id, customer_id) references customers(loja_id, id),
  foreign key (loja_id, notified_by) references users(loja_id, id),
  foreign key (loja_id, concluded_by) references users(loja_id, id),
  foreign key (loja_id, canceled_by) references users(loja_id, id),
  foreign key (loja_id, sale_id) references sales(loja_id, id),
  foreign key (loja_id, created_by) references users(loja_id, id)
);
create index if not exists idx_orders_status on orders(loja_id, status, created_at);
create table if not exists order_items (
  id serial primary key,
  loja_id uuid not null default current_loja_id() references lojas(id) on delete cascade,
  order_id int not null,
  product_id int,                               -- null = item livre
  name text not null,
  unit text not null default 'UN',
  qty int,
  line_cents int,
  pos int not null default 0,
  foreign key (loja_id, order_id) references orders(loja_id, id) on delete cascade,
  foreign key (loja_id, product_id) references products(loja_id, id)
);
create index if not exists idx_order_items_order on order_items(loja_id, order_id);

-- loja_usuarios acompanha users (papel/nome/ativo) — o login (auth) é ligado pelo auth_uid
create or replace function _tg_users_sync() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.auth_uid is not null then
    update loja_usuarios set nome = new.name, ativo = new.active,
      papel = case new.role when 'admin' then 'dono' else new.role end
     where user_id = new.auth_uid and loja_id = new.loja_id;
  end if;
  return new;
end $$;
drop trigger if exists tg_users_sync on users;
create trigger tg_users_sync after update of name, role, active on users for each row execute function _tg_users_sync();
