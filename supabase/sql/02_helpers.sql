-- Funções internas (não expostas: execute revogado no 99_grants.sql)

-- conta da loja = login (Supabase Auth) de um usuário ativo de uma loja liberada
create or replace function is_store_account() returns boolean
language sql stable security definer set search_path = public as $$
  select _uid() is not null and current_loja_id() is not null and loja_liberada()
$$;

-- exige login de loja e loja liberada (não bloqueada, dentro do vencimento)
create or replace function _require_store() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if _uid() is null or current_loja_id() is null then perform _err('Entre com usuário e senha.', 'SEM_LOGIN'); end if;
  if not loja_liberada() then
    perform _err('Acesso bloqueado: a assinatura desta loja está vencida ou suspensa. Fale com o suporte.', 'LOJA_BLOQUEADA');
  end if;
end $$;

create or replace function _brl(c bigint) returns text language sql immutable as $$
  select (case when c < 0 then '-' else '' end) || 'R$ ' ||
    translate(to_char(abs(c) / 100.0, 'FM999,999,990.00'), ',.', '.,')
$$;
create or replace function _pct(x int) returns text language sql immutable as $$
  select translate(to_char(x / 100.0, 'FM9990.00'), '.', ',') || '%'
$$;
create or replace function _unit_label(u text) returns text language sql immutable as $$
  select case u when 'KG' then 'kg' when 'UN' then 'un' when 'BANDEJA' then 'bdj' when 'MACO' then 'maço' when 'DUZIA' then 'dz' when 'PCT' then 'pct' else lower(u) end
$$;
create or replace function _qty(q bigint, u text) returns text language sql immutable as $$
  select case when u = 'KG' then translate(to_char(q / 1000.0, 'FM999,999,990.000'), ',.', '.,') || ' kg'
    else trim(trailing '.' from trim(trailing '0' from to_char(q / 1000.0, 'FM999999990.000'))) || ' ' || _unit_label(u) end
$$;

create or replace function _disc(p_base int, d jsonb) returns int language plpgsql immutable as $$
declare v numeric; val numeric;
begin
  if d is null or jsonb_typeof(d) <> 'object' then return 0; end if;
  val := coalesce((d->>'value')::numeric, 0);
  if val <= 0 then return 0; end if;
  if d->>'type' = 'pct' then v := round(p_base * val / 10000.0); else v := round(val); end if;
  return greatest(0, least(p_base, v))::int;
end $$;

create or replace function _audit(p_user int, p_action text, p_entity text, p_entity_id bigint, p_details jsonb default null) returns void
language sql as $$ insert into audit_log(user_id, action, entity, entity_id, details) values (p_user, p_action, p_entity, p_entity_id, p_details) $$;

-- Operador logado por PIN (token da sessão de PIN + conta da loja do Supabase Auth)
create or replace function _op(p_token text) returns users
language plpgsql stable security definer set search_path = public, extensions as $$
declare u users;
begin
  perform _require_store();
  select u2.* into u from op_sessions s join users u2 on u2.id = s.user_id
   where s.token = p_token and s.auth_uid = _uid() and u2.active and s.created_at > now() - interval '30 days';
  if u.id is null then perform _err('Entre com seu PIN.', 'SEM_PIN'); end if;
  return u;
end $$;

create or replace function _require_role(u users, p_roles text[]) returns void language plpgsql as $$
begin
  if not (u.role = any(p_roles)) then perform _err('Seu usuário não tem permissão para isso.', 'PROIBIDO'); end if;
end $$;

-- Gerente autoriza: se o próprio usuário é gerente/admin, passa; senão confere PIN de gerente/admin ativo.
create or replace function _authorize_manager(u users, p_pin text, p_what text) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare m record;
begin
  if u.role in ('gerente','admin') then return u.id; end if;
  if p_pin is null or p_pin = '' then perform _err(p_what || ': precisa de autorização do gerente.', 'PRECISA_GERENTE'); end if;
  for m in select us.id, pp.pin_hash from users us join user_pins pp on pp.user_id = us.id
           where us.active and us.role in ('gerente','admin') loop
    if _pin_ok(p_pin, m.pin_hash) then return m.id; end if;
  end loop;
  perform _err('PIN de gerente inválido.', 'PRECISA_GERENTE');
  return null;
end $$;

create or replace function _consume_lots(p_product int, p_qty int) returns void language plpgsql as $$
declare l record; v_left int := p_qty; v_take int;
begin
  for l in select id, qty_left from lots where product_id = p_product and qty_left > 0
           order by (expiry_date is null), expiry_date, id for update loop
    exit when v_left <= 0;
    v_take := least(l.qty_left, v_left);
    update lots set qty_left = qty_left - v_take where id = l.id;
    v_left := v_left - v_take;
  end loop;
end $$;

-- Baixa/entrada de estoque com kardex. Chamar dentro de uma função (transação).
create or replace function _apply_stock(p_product int, p_delta int, p_type text, p_user int, p_unit_cost int default null,
  p_ref_type text default null, p_ref_id bigint default null, p_lot int default null, p_note text default null,
  p_check_negative boolean default null) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare p products; v_next int; v_allow boolean;
begin
  if p_delta is null or p_delta = 0 then perform _err('Quantidade inválida.'); end if;
  update products set stock_qty = stock_qty + p_delta, updated_at = now() where id = p_product returning * into p;
  if p.id is null then perform _err('Produto não encontrado.', 'NAO_ENCONTRADO'); end if;
  v_next := p.stock_qty;
  if coalesce(p_check_negative, p_delta < 0) and p_delta < 0 and v_next < 0 then
    select allow_negative_stock into v_allow from store_settings where loja_id = current_loja_id();
    if not coalesce(v_allow, false) and not p.allow_negative then
      perform _err('Estoque insuficiente de ' || p.name || ': tem ' || _qty(greatest(0, v_next - p_delta), p.unit) ||
        '. Libere estoque negativo nas configurações se a banca precisar.', 'ESTOQUE_INSUFICIENTE');
    end if;
  end if;
  if p_delta < 0 then perform _consume_lots(p.id, -p_delta); end if;
  insert into stock_movements(product_id, type, qty, balance_after, unit_cost_cents, ref_type, ref_id, lot_id, note, user_id)
  values (p.id, p_type, p_delta, v_next, coalesce(p_unit_cost, p.cost_cents), p_ref_type, p_ref_id, p_lot, p_note, p_user);
  return v_next;
end $$;

create or replace function _open_session(p_terminal text) returns cash_sessions
language sql stable security definer set search_path = public as $$
  select * from cash_sessions where terminal = p_terminal and status = 'ABERTO' limit 1
$$;
create or replace function _require_session(p_terminal text) returns cash_sessions
language plpgsql security definer set search_path = public as $$
declare s cash_sessions;
begin
  s := _open_session(p_terminal);
  if s.id is null then perform _err('Caixa fechado. Abra o caixa para vender.', 'CAIXA_FECHADO'); end if;
  return s;
end $$;

create or replace function _cash_move(p_session int, p_type text, p_method text, p_amount int, p_user int,
  p_ref_type text default null, p_ref_id bigint default null, p_note text default null, p_auth int default null) returns bigint
language sql security definer set search_path = public as $$
  insert into cash_movements(session_id, type, method, amount_cents, ref_type, ref_id, note, user_id, authorized_by)
  values (p_session, p_type, p_method, p_amount, p_ref_type, p_ref_id, p_note, p_user, p_auth) returning id
$$;

create or replace function _ledger(p_customer int, p_type text, p_amount int, p_user int, p_sale int default null,
  p_session int default null, p_method text default null, p_note text default null, p_check_limit boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare c customers; v_next int;
begin
  select * into c from customers where id = p_customer for update;
  if c.id is null then perform _err('Cliente não encontrado.', 'NAO_ENCONTRADO'); end if;
  v_next := c.balance_cents + p_amount;
  if p_check_limit and p_amount > 0 then
    if not c.active then perform _err('Cliente inativo não pode comprar fiado.'); end if;
    if v_next > c.credit_limit_cents then
      perform _err('Limite do fiado estourado para ' || c.name || ': deve ' || _brl(c.balance_cents) || ', limite ' ||
        _brl(c.credit_limit_cents) || ', disponível ' || _brl(greatest(0, c.credit_limit_cents - c.balance_cents)) || '.', 'LIMITE_FIADO');
    end if;
  end if;
  update customers set balance_cents = v_next where id = c.id;
  insert into customer_ledger(customer_id, type, amount_cents, balance_after, method, sale_id, session_id, note, user_id)
  values (c.id, p_type, p_amount, v_next, p_method, p_sale, p_session, p_note, p_user);
  return v_next;
end $$;

create or replace function _settings_json() returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(s) - 'last_sale_number' - 'loja_id' from store_settings s where loja_id = current_loja_id()
$$;
