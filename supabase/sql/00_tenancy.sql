-- Caixa Certo — multi-loja (SaaS). Base do isolamento entre lojas e do bloqueio por falta de pagamento.
-- Regras:
--  * Toda tabela de negócio tem loja_id (default current_loja_id()) e RLS: só enxerga/escreve linhas da própria loja.
--  * As RPCs da loja rodam como o papel "app_definer" (SEM bypass de RLS): mesmo que uma função esqueça um filtro,
--    o banco não deixa uma loja ver ou mexer em dado de outra.
--  * Loja bloqueada/vencida: loja_liberada() = false → as políticas negam leitura e escrita dos dados de negócio.
--  * Super admin: tabela super_admins sem nenhuma política (ninguém lê pela API); funções admin_* conferem is_super_admin().
-- Dinheiro em centavos (integer).

create extension if not exists pgcrypto with schema extensions;

-- papel sem login, sem BYPASSRLS: dono das funções SECURITY DEFINER da loja
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_definer') then
    create role app_definer nologin noinherit nobypassrls;
  end if;
end $$;
grant app_definer to postgres;
grant usage on schema public to app_definer;

-- auth.uid()/auth.jwt() para as funções do app_definer (que não tem acesso ao schema auth)
create or replace function _uid() returns uuid language sql stable security definer set search_path = public as $$ select auth.uid() $$;
create or replace function _jwt() returns jsonb language sql stable security definer set search_path = public as $$ select auth.jwt() $$;

-- pgcrypto para as funções do app_definer (que não tem acesso ao schema extensions)
create or replace function _hex_token(n int) returns text language sql volatile security definer set search_path = public, extensions as $$ select encode(gen_random_bytes(n), 'hex') $$;
create or replace function _hash_pin(p text) returns text language sql volatile security definer set search_path = public, extensions as $$ select crypt(p, gen_salt('bf', 8)) $$;
create or replace function _pin_ok(p text, h text) returns boolean language sql stable security definer set search_path = public, extensions as $$ select h is not null and crypt(coalesce(p, ''), h) = h $$;

create or replace function _tz() returns text language sql immutable as $$ select 'America/Sao_Paulo'::text $$;
create or replace function _local_date(ts timestamptz) returns date language sql immutable as $$ select (ts at time zone 'America/Sao_Paulo')::date $$;
create or replace function _today() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create or replace function _err(p_msg text, p_code text default 'INVALIDO') returns void
language plpgsql as $$ begin raise exception using message = p_msg, hint = p_code, errcode = 'P0001'; end $$;

-- ---------- plataforma ----------
create table if not exists plataforma_config (
  id int primary key default 1 check (id = 1),
  carencia_dias int not null default 3 check (carencia_dias between 0 and 30),   -- dias de tolerância depois do vencimento (loja ativa)
  dias_teste int not null default 7 check (dias_teste between 1 and 60),         -- teste grátis no cadastro
  aviso_dias int not null default 5 check (aviso_dias between 0 and 30),         -- faixa "vence em X dias"
  atualizado_em timestamptz not null default now()
);
insert into plataforma_config(id) values (1) on conflict do nothing;

create table if not exists lojas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 2 and 80),
  documento text not null unique check (documento ~ '^[0-9]{11}$' or documento ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  tipo_documento text not null check (tipo_documento in ('CPF','CNPJ')),
  responsavel text not null default '',
  telefone text not null default '',                    -- WhatsApp (só dígitos, com DDD), opcional
  status text not null default 'teste' check (status in ('teste','ativa','bloqueada')),
  vencimento date not null,
  plano text not null default 'mensal',
  valor_mensal_cents int not null default 0 check (valor_mensal_cents >= 0),
  observacao text not null default '',
  motivo_bloqueio text,
  criado_em timestamptz not null default now(),
  ultimo_acesso timestamptz,
  -- pagamento automático no futuro (Mercado Pago/PIX): id do cliente/assinatura no gateway
  gateway text,
  gateway_cliente_id text
);

create table if not exists loja_usuarios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  loja_id uuid not null references lojas(id) on delete cascade,
  usuario text not null,
  nome text not null default '',
  papel text not null check (papel in ('dono','gerente','operador')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (loja_id, usuario)
);
create index if not exists idx_loja_usuarios_loja on loja_usuarios(loja_id);

create table if not exists super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  usuario text not null unique,
  criado_em timestamptz not null default now()
);

create table if not exists pagamentos (
  id bigserial primary key,
  loja_id uuid not null references lojas(id) on delete cascade,
  valor_cents int not null check (valor_cents >= 0),
  pago_em date not null,
  metodo text not null default 'pix',
  vencimento_anterior date,
  vencimento_novo date not null,
  observacao text not null default '',
  -- 'manual' = marcado no painel; no futuro 'mercadopago' etc. com gateway_ref único (webhook idempotente)
  gateway text not null default 'manual',
  gateway_ref text unique,
  registrado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_pagamentos_loja on pagamentos(loja_id, id);

create table if not exists loja_eventos (
  id bigserial primary key,
  loja_id uuid not null references lojas(id) on delete cascade,
  tipo text not null,           -- CRIADA, BLOQUEADA, DESBLOQUEADA, PAGAMENTO, EDITADA
  motivo text,
  detalhes jsonb,
  por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_loja_eventos_loja on loja_eventos(loja_id, id);

-- super admin nunca é membro de loja (e vice-versa)
create or replace function _tg_sep_admin_loja() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'loja_usuarios' and exists (select 1 from super_admins where user_id = new.user_id) then
    raise exception 'Super admin não pode ser usuário de loja.';
  end if;
  if tg_table_name = 'super_admins' and exists (select 1 from loja_usuarios where user_id = new.user_id) then
    raise exception 'Usuário de loja não pode ser super admin.';
  end if;
  return new;
end $$;
drop trigger if exists tg_sep_admin on loja_usuarios;
create trigger tg_sep_admin before insert or update of user_id on loja_usuarios for each row execute function _tg_sep_admin_loja();
drop trigger if exists tg_sep_admin on super_admins;
create trigger tg_sep_admin before insert or update of user_id on super_admins for each row execute function _tg_sep_admin_loja();

-- ---------- funções de contexto (usadas nas políticas RLS) ----------
-- loja do usuário logado (null = não é usuário ativo de nenhuma loja)
create or replace function current_loja_id() returns uuid
language sql stable security definer set search_path = public as $$
  select lu.loja_id from loja_usuarios lu where lu.user_id = auth.uid() and lu.ativo limit 1
$$;

create or replace function _loja_liberada(p_loja uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select l.status <> 'bloqueada'
       and _today() <= l.vencimento + case when l.status = 'ativa' then c.carencia_dias else 0 end
      from lojas l cross join plataforma_config c where l.id = p_loja and c.id = 1), false)
$$;

-- a loja do usuário logado pode usar o sistema? (não bloqueada e dentro do vencimento + carência)
create or replace function loja_liberada() returns boolean
language sql stable security definer set search_path = public as $$ select _loja_liberada(current_loja_id()) $$;

create or replace function is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from super_admins where user_id = auth.uid())
$$;

-- ---------- CPF / CNPJ ----------
-- devolve 'CPF' | 'CNPJ' se o documento (já normalizado) tem dígitos verificadores certos; senão null.
-- CNPJ aceita o formato alfanumérico (a partir de 2026): letras valem ascii - 48.
create or replace function _doc_tipo(p text) returns text language plpgsql immutable as $$
declare d text := upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')); s int; r int; i int; v int[];
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2]; w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if d ~ '^[0-9]{11}$' then
    if d ~ '^(.)\1{10}$' then return null; end if;
    s := 0; for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    if r <> substr(d, 10, 1)::int then return null; end if;
    s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    if r <> substr(d, 11, 1)::int then return null; end if;
    return 'CPF';
  elsif d ~ '^[0-9A-Z]{12}[0-9]{2}$' then
    if d ~ '^(.)\1{13}$' then return null; end if;
    v := array(select ascii(substr(d, k, 1)) - 48 from generate_series(1, 14) k);
    s := 0; for i in 1..12 loop s := s + v[i] * w1[i]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    if r <> v[13] then return null; end if;
    s := 0; for i in 1..13 loop s := s + v[i] * w2[i]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    if r <> v[14] then return null; end if;
    return 'CNPJ';
  end if;
  return null;
end $$;
create or replace function _doc_norm(p text) returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g'))
$$;
create or replace function _doc_fmt(d text) returns text language sql immutable as $$
  select case when length(d) = 11 then substr(d,1,3)||'.'||substr(d,4,3)||'.'||substr(d,7,3)||'-'||substr(d,10,2)
              when length(d) = 14 then substr(d,1,2)||'.'||substr(d,3,3)||'.'||substr(d,6,3)||'/'||substr(d,9,4)||'-'||substr(d,13,2)
              else d end
$$;
