-- ===================== API (RPC) =====================
-- Todas: SECURITY DEFINER, exigem conta da loja (auth) e, quando mudam algo, o token do PIN do operador.

-- ---------- PIN ----------
create or replace function pin_login(p_user_id int, p_pin text, p_terminal text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; h text; v_token text;
begin
  perform _require_store();
  select * into u from users where id = p_user_id and active;
  select pin_hash into h from user_pins where user_id = p_user_id;
  if u.id is null or h is null or not _pin_ok(p_pin, h) then
    perform _audit(u.id, 'LOGIN_FALHOU', 'user', p_user_id, jsonb_build_object('terminal', p_terminal));
    -- não aborta a transação para manter o log: retorna erro como json
    return jsonb_build_object('error', 'PIN errado. Tente de novo.', 'code', 'PIN_ERRADO');
  end if;
  v_token := _hex_token(24);
  insert into op_sessions(token, user_id, auth_uid, terminal) values (v_token, u.id, _uid(), p_terminal);
  delete from op_sessions where created_at < now() - interval '30 days';
  perform _audit(u.id, 'LOGIN', 'user', u.id, jsonb_build_object('terminal', p_terminal));
  return jsonb_build_object('token', v_token, 'user', jsonb_build_object('id', u.id, 'name', u.name, 'role', u.role));
end $$;

create or replace function pin_logout(p_token text) returns void
language sql security definer set search_path = public as $$ delete from op_sessions where token = p_token and auth_uid = _uid() $$;

create or replace function op_me(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare u users;
begin u := _op(p_token); return jsonb_build_object('id', u.id, 'name', u.name, 'role', u.role); end $$;

-- ---------- caixa ----------
create or replace function session_summary(p_session_id int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s jsonb; v_status text; v_float int; bm jsonb; v_has_counts boolean;
  v_sales record; v_canc record; v_exp_total int; v_cnt_total int;
begin
  perform _require_store();
  select to_jsonb(cs) || jsonb_build_object('opened_by_name', uo.name, 'closed_by_name', uc.name), cs.status, cs.opening_float_cents
    into s, v_status, v_float
    from cash_sessions cs join users uo on uo.id = cs.opened_by left join users uc on uc.id = cs.closed_by where cs.id = p_session_id;
  if s is null then perform _err('Sessão de caixa não encontrada.', 'NAO_ENCONTRADO'); end if;
  v_has_counts := exists (select 1 from cash_session_counts where session_id = p_session_id);
  select jsonb_agg(jsonb_build_object('method', m.method,
           'expected_cents', coalesce(c.expected_cents, e.total, 0),
           'counted_cents', c.counted_cents,
           'diff_cents', case when c.session_id is null then null else c.counted_cents - c.expected_cents end) order by m.ord),
         sum(coalesce(c.expected_cents, e.total, 0)), sum(c.counted_cents)
    into bm, v_exp_total, v_cnt_total
    from (values ('dinheiro',1),('pix',2),('debito',3),('credito',4),('voucher',5),('fiado',6)) m(method, ord)
    left join (select method, sum(amount_cents)::int total from cash_movements where session_id = p_session_id group by method) e on e.method = m.method
    left join cash_session_counts c on c.session_id = p_session_id and c.method = m.method;
  select count(*)::int n, coalesce(sum(total_cents),0)::int total into v_sales from sales where session_id = p_session_id and status = 'FINALIZADA';
  select count(*)::int n, coalesce(sum(total_cents),0)::int total into v_canc from sales where session_id = p_session_id and status = 'CANCELADA';
  return jsonb_build_object(
    'session', s, 'by_method', bm,
    'sales_count', v_sales.n, 'sales_total_cents', v_sales.total, 'canceled_count', v_canc.n, 'canceled_total_cents', v_canc.total,
    'ticket_medio_cents', case when v_sales.n > 0 then round(v_sales.total::numeric / v_sales.n)::int else 0 end,
    'sangria_cents', (select coalesce(abs(sum(amount_cents)),0) from cash_movements where session_id = p_session_id and type = 'SANGRIA'),
    'suprimento_cents', (select coalesce(sum(amount_cents),0) from cash_movements where session_id = p_session_id and type = 'SUPRIMENTO'),
    'recebimento_fiado_cents', (select coalesce(sum(amount_cents),0) from cash_movements where session_id = p_session_id and type = 'RECEBIMENTO_FIADO'),
    'estorno_cents', (select coalesce(abs(sum(amount_cents)),0) from cash_movements where session_id = p_session_id and type = 'ESTORNO'),
    'opening_float_cents', v_float,
    'expected_total_cents', v_exp_total,
    'counted_total_cents', case when v_has_counts then v_cnt_total else null end,
    'movements', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('user_name', u.name) order by m.id)
       from cash_movements m join users u on u.id = m.user_id
      where m.session_id = p_session_id and m.type in ('ABERTURA','SANGRIA','SUPRIMENTO','RECEBIMENTO_FIADO','ESTORNO')), '[]'::jsonb));
end $$;

create or replace function cash_open(p_token text, p_terminal text, p_float int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; v_id int;
begin
  u := _op(p_token);
  if p_float is null or p_float < 0 then perform _err('Fundo de troco inválido.'); end if;
  if (_open_session(p_terminal)).id is not null then perform _err('Já existe um caixa aberto neste terminal.', 'CAIXA_JA_ABERTO'); end if;
  insert into cash_sessions(terminal, opened_by, opening_float_cents) values (p_terminal, u.id, p_float) returning id into v_id;
  perform _cash_move(v_id, 'ABERTURA', 'dinheiro', p_float, u.id, null, null, 'Fundo de troco');
  perform _audit(u.id, 'CAIXA_ABERTURA', 'cash_session', v_id, jsonb_build_object('terminal', p_terminal, 'float', p_float));
  return session_summary(v_id);
exception when unique_violation then
  perform _err('Já existe um caixa aberto neste terminal.', 'CAIXA_JA_ABERTO');
end $$;

create or replace function cash_move(p_token text, p_terminal text, p_kind text, p_amount int, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; s cash_sessions; v_cash int; v_id bigint;
begin
  u := _op(p_token);
  if p_kind not in ('SANGRIA','SUPRIMENTO') then perform _err('Movimento inválido.'); end if;
  if p_amount is null or p_amount <= 0 then perform _err('Valor deve ser maior que zero.'); end if;
  s := _require_session(p_terminal);
  perform 1 from cash_sessions where id = s.id for update;
  if p_kind = 'SANGRIA' then
    select coalesce(sum(amount_cents),0) into v_cash from cash_movements where session_id = s.id and method = 'dinheiro';
    if p_amount > v_cash then perform _err('Sangria maior que o dinheiro na gaveta (' || _brl(v_cash) || ').'); end if;
  end if;
  v_id := _cash_move(s.id, p_kind, 'dinheiro', case when p_kind = 'SANGRIA' then -p_amount else p_amount end, u.id, null, null, nullif(p_note, ''));
  perform _audit(u.id, 'CAIXA_' || p_kind, 'cash_movement', v_id, jsonb_build_object('amount', p_amount, 'note', p_note));
  return session_summary(s.id);
end $$;

create or replace function cash_close(p_token text, p_terminal text, p_counted jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; s cash_sessions; m text; v_exp int; v_c int; v_expected jsonb := '{}'::jsonb;
begin
  u := _op(p_token);
  s := _require_session(p_terminal);
  perform 1 from cash_sessions where id = s.id for update;
  foreach m in array array['dinheiro','pix','debito','credito','voucher','fiado'] loop
    select coalesce(sum(amount_cents),0) into v_exp from cash_movements where session_id = s.id and method = m;
    v_c := coalesce(nullif(p_counted->>m, '')::int, v_exp);
    if v_c < 0 then perform _err('Valor contado inválido em ' || m || '.'); end if;
    insert into cash_session_counts(session_id, method, expected_cents, counted_cents) values (s.id, m, v_exp, v_c);
    v_expected := v_expected || jsonb_build_object(m, v_exp);
  end loop;
  update cash_sessions set status = 'FECHADO', closed_by = u.id, closed_at = now(), note = nullif(p_note, '') where id = s.id;
  perform _audit(u.id, 'CAIXA_FECHAMENTO', 'cash_session', s.id, jsonb_build_object('expected', v_expected, 'counted', p_counted));
  return session_summary(s.id);
end $$;

-- ---------- vendas ----------
create or replace function sale_get(p_id int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _require_store();
  select to_jsonb(s) || jsonb_build_object('user_name', u.name, 'customer_name', c.name, 'customer_balance_cents', c.balance_cents,
      'canceled_by_name', cu.name, 'deleted_by_name', du.name,
      -- v3.4: situação do caixa da venda (para explicar o que acontece ao apagar)
      'session_status', (select cs.status from cash_sessions cs where cs.id = s.session_id),
      'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from sale_items i where i.sale_id = s.id), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from sale_payments p where p.sale_id = s.id), '[]'::jsonb),
      'fiscal', (select jsonb_build_object('provider', f.provider, 'status', f.status, 'access_key', f.access_key)
                   from fiscal_documents f where f.sale_id = s.id order by f.id desc limit 1),
      -- v3.3: venda que veio de uma encomenda
      'order', (select jsonb_build_object('id', o.id, 'customer_name', o.customer_name, 'phone', o.phone, 'delivery', o.delivery, 'address', o.address)
                  from orders o where o.sale_id = s.id limit 1))
    into r
    from sales s join users u on u.id = s.user_id left join customers c on c.id = s.customer_id left join users cu on cu.id = s.canceled_by left join users du on du.id = s.deleted_by
   where s.id = p_id;
  if r is null then perform _err('Venda não encontrada.', 'NAO_ENCONTRADO'); end if;
  return r;
end $$;

-- Finalizar venda: valida, calcula no servidor, baixa estoque, grava pagamentos, caixa e fiado — tudo numa transação.
create or replace function sale_create(p_token text, p_terminal text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u users; st store_settings; sess cash_sessions; p products; it jsonb; pay jsonb; ln jsonb; v_pr promotions; v_price int; v_at timestamptz;
  v_items jsonb := coalesce(p_data->'items', '[]'::jsonb);
  v_pays jsonb := coalesce(p_data->'payments', '[]'::jsonb);
  v_lines jsonb := '[]'::jsonb;
  v_qty int; v_lg int; v_ld int; v_gross int := 0; v_item_disc int := 0; v_sub int; v_tdisc int; v_total int; v_disc int; v_pct int;
  v_paid int := 0; v_noncash int := 0; v_change int; v_fiado int := 0; v_cost int := 0; v_amt int; v_net int; v_change_left int;
  v_number int; v_sale int; v_disc_by int; v_existing int; v_key text;
  v_customer int := nullif(p_data->>'customer_id', '')::int;
  v_uuid uuid := nullif(p_data->>'client_uuid', '')::uuid;
  v_offline boolean := coalesce((p_data->>'offline')::boolean, false);
begin
  u := _op(p_token);
  if v_uuid is not null then
    select id into v_existing from sales where client_uuid = v_uuid;
    if v_existing is not null then return sale_get(v_existing); end if; -- reenvio da fila offline: idempotente
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then perform _err('Carrinho vazio.'); end if;
  if jsonb_typeof(v_pays) <> 'array' or jsonb_array_length(v_pays) = 0 then perform _err('Informe o pagamento.'); end if;
  select * into st from store_settings where loja_id = current_loja_id();
  -- hora da venda para a promoção: venda offline usa a hora em que aconteceu (até 7 dias atrás)
  v_at := now();
  if v_offline and nullif(p_data->>'sold_at', '') is not null then
    begin v_at := greatest(least((p_data->>'sold_at')::timestamptz, now()), now() - interval '7 days'); exception when others then v_at := now(); end;
  end if;

  for it in select * from jsonb_array_elements(v_items) loop
    select * into p from products where id = (it->>'product_id')::int;
    if p.id is null then perform _err('Produto ' || coalesce(it->>'product_id', '?') || ' não encontrado.', 'NAO_ENCONTRADO'); end if;
    if not p.active then perform _err(p.name || ' está inativo e não pode ser vendido.', 'PRODUTO_INATIVO'); end if;
    v_qty := (it->>'qty')::int;
    if v_qty is null or v_qty <= 0 then perform _err('Quantidade inválida para ' || p.name || '.'); end if;
    if p.unit <> 'KG' and v_qty % 1000 <> 0 then perform _err(p.name || ' é vendido por unidade inteira.'); end if;
    -- promoção: a que o caixa usou (com folga de 2 h depois do fim, carrinho montado antes de acabar) ou a vigente agora
    v_pr := null;
    if nullif(it->>'promotion_id', '') is not null then
      select * into v_pr from promotions x where x.id = (it->>'promotion_id')::int and x.product_id = p.id
         and x.starts_at - interval '15 minutes' <= v_at and v_at < least(x.ends_at, coalesce(x.ended_at, x.ends_at)) + interval '2 hours';
    end if;
    if v_pr.id is null then
      select * into v_pr from promotions x where x.product_id = p.id and x.starts_at <= v_at
         and v_at < least(x.ends_at, coalesce(x.ended_at, x.ends_at)) order by x.starts_at desc limit 1;
    end if;
    v_price := case when v_pr.id is not null and v_pr.promo_price_cents < p.price_cents then v_pr.promo_price_cents else p.price_cents end;
    if v_price = p.price_cents then v_pr := null; end if;
    v_lg := round(v_price::numeric * v_qty / 1000.0)::int;
    v_ld := _disc(v_lg, it->'discount');
    v_gross := v_gross + v_lg; v_item_disc := v_item_disc + v_ld;
    v_cost := v_cost + round(p.cost_cents::numeric * v_qty / 1000.0)::int;
    v_lines := v_lines || jsonb_build_object('product_id', p.id, 'name', p.name, 'unit', p.unit, 'qty', v_qty,
      'price', v_price, 'regular', p.price_cents, 'promo', v_pr.id, 'cost', p.cost_cents, 'gross', v_lg, 'disc', v_ld);
  end loop;
  v_sub := v_gross - v_item_disc;
  v_tdisc := _disc(v_sub, p_data->'total_discount');
  v_total := v_sub - v_tdisc;
  v_disc := v_item_disc + v_tdisc;
  v_pct := case when v_gross > 0 then round(v_disc * 10000.0 / v_gross)::int else 0 end;
  if v_total <= 0 then perform _err('Total da venda precisa ser maior que zero.'); end if;
  if v_disc > 0 and v_pct > st.discount_limit_pct then
    v_disc_by := _authorize_manager(u, p_data->>'manager_pin',
      'Desconto de ' || _pct(v_pct) || ' acima do limite de ' || _pct(st.discount_limit_pct));
  end if;

  for pay in select * from jsonb_array_elements(v_pays) loop
    v_amt := (pay->>'amount_cents')::int;
    if pay->>'method' not in ('dinheiro','pix','debito','credito','voucher','fiado') then perform _err('Forma de pagamento inválida.', 'PAGAMENTO'); end if;
    if v_amt is null or v_amt <= 0 then perform _err('Valor de pagamento inválido.', 'PAGAMENTO'); end if;
    v_paid := v_paid + v_amt;
    if pay->>'method' <> 'dinheiro' then v_noncash := v_noncash + v_amt; end if;
    if pay->>'method' = 'fiado' then v_fiado := v_fiado + v_amt; end if;
  end loop;
  if v_paid < v_total then perform _err('Pagamento menor que o total.', 'PAGAMENTO'); end if;
  if v_noncash > v_total then perform _err('Troco só em dinheiro: PIX/cartão/voucher/fiado não podem passar do total.', 'PAGAMENTO'); end if;
  v_change := v_paid - v_total;
  if v_fiado > 0 and v_customer is null then perform _err('Fiado precisa de cliente.', 'FIADO_SEM_CLIENTE'); end if;

  sess := _require_session(p_terminal);
  update store_settings set last_sale_number = last_sale_number + 1 where loja_id = current_loja_id() returning last_sale_number into v_number;

  insert into sales(number, client_uuid, offline, session_id, terminal, user_id, customer_id, gross_cents, item_discount_cents,
      total_discount_cents, total_cents, paid_cents, change_cents, cost_cents, discount_authorized_by)
  values (v_number, v_uuid, v_offline, sess.id, p_terminal, u.id, v_customer, v_gross, v_item_disc, v_tdisc, v_total, v_paid,
      v_change, v_cost, v_disc_by)
  returning id into v_sale;

  for ln in select * from jsonb_array_elements(v_lines) loop
    insert into sale_items(sale_id, product_id, name, unit, qty, unit_price_cents, gross_cents, discount_cents, total_cents, unit_cost_cents,
        promotion_id, regular_price_cents)
    values (v_sale, (ln->>'product_id')::int, ln->>'name', ln->>'unit', (ln->>'qty')::int, (ln->>'price')::int, (ln->>'gross')::int,
      (ln->>'disc')::int, (ln->>'gross')::int - (ln->>'disc')::int, (ln->>'cost')::int,
      nullif(ln->>'promo', '')::int, (ln->>'regular')::int);
    -- venda que já aconteceu offline não é barrada por estoque (fica registrada na auditoria)
    perform _apply_stock((ln->>'product_id')::int, -(ln->>'qty')::int, 'VENDA', u.id, null, 'venda', v_sale, null,
      'Venda nº ' || v_number, not v_offline);
  end loop;

  v_change_left := v_change;
  for pay in select * from jsonb_array_elements(v_pays) loop
    v_amt := (pay->>'amount_cents')::int; v_net := v_amt;
    if pay->>'method' = 'dinheiro' and v_change_left > 0 then
      v_net := v_amt - least(v_change_left, v_amt); v_change_left := v_change_left - least(v_change_left, v_amt);
    end if;
    insert into sale_payments(sale_id, method, amount_cents, net_cents) values (v_sale, pay->>'method', v_amt, v_net);
    if v_net <> 0 then perform _cash_move(sess.id, 'VENDA', pay->>'method', v_net, u.id, 'venda', v_sale, 'Venda nº ' || v_number); end if;
  end loop;
  if v_fiado > 0 then
    perform _ledger(v_customer, 'COMPRA', v_fiado, u.id, v_sale, sess.id, 'fiado', 'Venda nº ' || v_number, true);
  end if;
  -- FiscalProvider simulado (NFC-e futura): nada vai para a SEFAZ
  insert into fiscal_documents(sale_id, provider, status, access_key, payload)
  values (v_sale, 'mock', 'SIMULADO', left('35' || to_char(now(), 'YYMMDDHH24MISS') || lpad(v_number::text, 9, '0') || repeat('0', 44), 44),
    jsonb_build_object('message', 'Simulação — sem envio à SEFAZ. NÃO É DOCUMENTO FISCAL.'));
  perform _audit(u.id, case when v_offline then 'VENDA_OFFLINE' else 'VENDA' end, 'sale', v_sale, jsonb_build_object(
    'number', v_number, 'total', v_total, 'payments', v_pays, 'discount', v_disc, 'discount_authorized_by', v_disc_by, 'terminal', p_terminal));
  return sale_get(v_sale);
end $$;

create or replace function sale_cancel(p_token text, p_terminal text, p_id int, p_reason text default '', p_manager_pin text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; v_by int; s sales; orig cash_sessions; sess cash_sessions; it record; pay record;
begin
  u := _op(p_token);
  v_by := _authorize_manager(u, p_manager_pin, 'Cancelamento de venda');
  select * into s from sales where id = p_id for update;
  if s.id is null then perform _err('Venda não encontrada.', 'NAO_ENCONTRADO'); end if;
  if s.status = 'EXCLUIDA' then perform _err('Venda apagada pelo administrador.', 'CONFLITO'); end if;
  if s.status <> 'FINALIZADA' then perform _err('Venda já cancelada.', 'CONFLITO'); end if;
  if s.imported then perform _err('Venda importada do sistema antigo: não dá para cancelar aqui.', 'CONFLITO'); end if;
  if _local_date(s.created_at) <> _today() then perform _err('Só dá para cancelar venda do dia.', 'FORA_DO_DIA'); end if;
  select * into orig from cash_sessions where id = s.session_id;
  if orig.status = 'ABERTO' then sess := orig; else sess := _open_session(p_terminal); end if;
  if sess.id is null then perform _err('Abra o caixa para estornar esta venda.', 'CAIXA_FECHADO'); end if;
  update sales set status = 'CANCELADA', canceled_at = now(), canceled_by = u.id, cancel_authorized_by = v_by, cancel_reason = nullif(p_reason, '')
   where id = s.id;
  for it in select * from sale_items where sale_id = s.id and product_id is not null loop -- item livre de encomenda não tem estoque
    perform _apply_stock(it.product_id, it.qty, 'CANCELAMENTO', u.id, null, 'venda', s.id, null, 'Cancelamento venda nº ' || s.number, false);
  end loop;
  for pay in select * from sale_payments where sale_id = s.id loop
    if pay.net_cents <> 0 then
      perform _cash_move(sess.id, 'ESTORNO', pay.method, -pay.net_cents, u.id, 'venda', s.id, 'Estorno venda nº ' || s.number, v_by);
    end if;
    if pay.method = 'fiado' and s.customer_id is not null then
      perform _ledger(s.customer_id, 'ESTORNO', -pay.net_cents, u.id, s.id, sess.id, 'fiado', 'Cancelamento venda nº ' || s.number, false);
    end if;
  end loop;
  -- v3.3: venda de encomenda cancelada: a encomenda volta para "Pronta" (o dinheiro foi estornado, então fica "a pagar")
  update orders set status = 'PRONTA', sale_id = null, concluded_at = null, concluded_by = null, paid = false, paid_method = null, updated_at = now()
   where sale_id = s.id;
  perform _audit(u.id, 'VENDA_CANCELADA', 'sale', s.id, jsonb_build_object('number', s.number, 'total', s.total_cents, 'reason', p_reason, 'authorized_by', v_by));
  return sale_get(s.id);
end $$;

-- ---------- vendas pausadas ----------
create or replace function held_create(p_token text, p_terminal text, p_label text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; v_id int;
begin
  u := _op(p_token);
  insert into held_sales(terminal, user_id, label, payload) values (p_terminal, u.id, coalesce(nullif(p_label, ''), 'Venda pausada'), p_payload) returning id into v_id;
  perform _audit(u.id, 'VENDA_PAUSADA', 'held_sale', v_id, jsonb_build_object('label', p_label));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function held_resume(p_token text, p_id int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; h held_sales;
begin
  u := _op(p_token);
  delete from held_sales where id = p_id returning * into h;
  if h.id is null then perform _err('Venda pausada não encontrada.', 'NAO_ENCONTRADO'); end if;
  perform _audit(u.id, 'VENDA_RETOMADA', 'held_sale', p_id, jsonb_build_object('label', h.label));
  return to_jsonb(h);
end $$;

-- ---------- estoque ----------
create or replace function stock_entry(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; p products; v_qty int := (p_data->>'qty')::int; v_cost int := nullif(p_data->>'unit_cost_cents', '')::int;
  v_lot int; v_bal int; v_exp date := nullif(p_data->>'expiry_date', '')::date; v_code text := nullif(p_data->>'lot_code', '');
begin
  u := _op(p_token);
  perform _require_role(u, array['admin','gerente']);
  if v_qty is null or v_qty <= 0 then perform _err('Quantidade da entrada deve ser maior que zero.'); end if;
  select * into p from products where id = (p_data->>'product_id')::int;
  if p.id is null then perform _err('Produto não encontrado.', 'NAO_ENCONTRADO'); end if;
  if v_code is not null or v_exp is not null then
    insert into lots(product_id, lot_code, expiry_date, qty_initial, qty_left) values (p.id, v_code, v_exp, v_qty, v_qty) returning id into v_lot;
  end if;
  if v_cost is not null then update products set cost_cents = v_cost where id = p.id; end if;
  v_bal := _apply_stock(p.id, v_qty, 'ENTRADA', u.id, coalesce(v_cost, p.cost_cents), case when v_lot is null then null else 'lote' end,
    v_lot, v_lot, coalesce(nullif(p_data->>'note', ''), 'Entrada de compra'), false);
  perform _audit(u.id, 'ESTOQUE_ENTRADA', 'product', p.id, jsonb_build_object('qty', v_qty, 'cost', v_cost, 'lot', v_lot, 'expiry', v_exp));
  return jsonb_build_object('balance', v_bal, 'lot_id', v_lot);
end $$;

create or replace function stock_adjust(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; v_by int; p products; v_counted int := (p_data->>'counted_qty')::int; v_delta int; v_bal int;
begin
  u := _op(p_token);
  if v_counted is null then perform _err('Quantidade contada inválida.'); end if;
  v_by := _authorize_manager(u, p_data->>'manager_pin', 'Ajuste de estoque');
  select * into p from products where id = (p_data->>'product_id')::int for update;
  if p.id is null then perform _err('Produto não encontrado.', 'NAO_ENCONTRADO'); end if;
  v_delta := v_counted - p.stock_qty;
  if v_delta = 0 then return jsonb_build_object('balance', p.stock_qty, 'delta', 0); end if;
  v_bal := _apply_stock(p.id, v_delta, 'AJUSTE', u.id, null, null, null, null, coalesce(nullif(p_data->>'note', ''), 'Ajuste de contagem'), false);
  perform _audit(u.id, 'ESTOQUE_AJUSTE', 'product', p.id, jsonb_build_object('from', p.stock_qty, 'to', v_counted, 'authorized_by', v_by));
  return jsonb_build_object('balance', v_bal, 'delta', v_delta);
end $$;

create or replace function stock_loss(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; v_by int; p products; v_qty int := (p_data->>'qty')::int; v_reason text := p_data->>'reason'; v_cost int; v_id int; v_bal int;
  v_label text;
begin
  u := _op(p_token);
  if v_qty is null or v_qty <= 0 then perform _err('Quantidade da perda deve ser maior que zero.'); end if;
  v_label := case v_reason when 'amadureceu' then 'Amadureceu' when 'estragou' then 'Estragou' when 'queda' then 'Queda'
    when 'consumo_interno' then 'Consumo interno' end;
  if v_label is null then perform _err('Motivo de perda inválido.'); end if;
  v_by := _authorize_manager(u, p_data->>'manager_pin', 'Perda/quebra');
  select * into p from products where id = (p_data->>'product_id')::int;
  if p.id is null then perform _err('Produto não encontrado.', 'NAO_ENCONTRADO'); end if;
  v_cost := round(p.cost_cents::numeric * v_qty / 1000.0)::int;
  insert into losses(product_id, qty, reason, cost_cents, note, user_id, authorized_by)
  values (p.id, v_qty, v_reason, v_cost, nullif(p_data->>'note', ''), u.id, v_by) returning id into v_id;
  v_bal := _apply_stock(p.id, -v_qty, 'PERDA', u.id, null, 'perda', v_id, null,
    'Perda: ' || v_label || coalesce(' — ' || nullif(p_data->>'note', ''), ''), true);
  perform _audit(u.id, 'PERDA', 'loss', v_id, jsonb_build_object('product', p.name, 'qty', v_qty, 'reason', v_reason, 'cost', v_cost, 'authorized_by', v_by));
  return jsonb_build_object('id', v_id, 'balance', v_bal, 'cost_cents', v_cost);
end $$;

create or replace function expiring_lots(p_days int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d int;
begin
  perform _require_store();
  d := coalesce(p_days, (select expiry_alert_days from store_settings where loja_id = current_loja_id()), 2);
  return coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('product_name', p.name, 'unit', p.unit, 'icon', p.icon,
      'days_left', l.expiry_date - _today()) order by l.expiry_date)
    from lots l join products p on p.id = l.product_id
    where l.qty_left > 0 and l.expiry_date is not null and l.expiry_date <= _today() + d and p.deleted_at is null), '[]'::jsonb);
end $$;

create or replace function top_sellers(p_days int default 30, p_limit int default 24) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_store();
  return coalesce((select jsonb_agg(x) from (
    select p.id, p.name, p.icon, sum(i.total_cents)::int total_cents, count(*)::int n from sale_items i
      join sales s on s.id = i.sale_id and s.status = 'FINALIZADA' join products p on p.id = i.product_id
     where s.created_at >= now() - make_interval(days => p_days) and p.active and p.deleted_at is null
     group by p.id order by n desc, total_cents desc limit p_limit) x), '[]'::jsonb);
end $$;

-- ---------- cadastro ----------
create or replace function product_save(p_token text, p_id int, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; v_id int; v_dup text; v_code text := trim(coalesce(p_data->>'code', '')); v_ean text := nullif(trim(coalesce(p_data->>'ean', '')), '');
  v_pos int := nullif(p_data->>'shortcut_pos', '')::int; v_init int := coalesce(nullif(p_data->>'initial_stock', '')::int, 0);
begin
  u := _op(p_token);
  perform _require_role(u, array['admin','gerente']);
  if trim(coalesce(p_data->>'name', '')) = '' then perform _err('Nome é obrigatório.'); end if;
  if v_code = '' then perform _err('Código é obrigatório.'); end if;
  if p_data->>'unit' not in ('KG','UN','BANDEJA','MACO','DUZIA','PCT') then perform _err('Unidade inválida.'); end if;
  if v_pos is not null and (v_pos < 1 or v_pos > 24) then perform _err('Atalho deve ser de 1 a 24.'); end if;
  if coalesce((p_data->>'price_cents')::int, -1) < 0 or coalesce((p_data->>'cost_cents')::int, -1) < 0 then perform _err('Preço/custo inválido.'); end if;
  select name into v_dup from products where (code = v_code or (v_ean is not null and ean = v_ean)) and id <> coalesce(p_id, 0) limit 1;
  if v_dup is not null then perform _err('Código/EAN já usado por ' || v_dup || '.', 'CONFLITO'); end if;
  if v_pos is not null then update products set shortcut_pos = null where shortcut_pos = v_pos and id <> coalesce(p_id, 0); end if;
  if p_id is not null then
    update products set code = v_code, ean = v_ean, name = trim(p_data->>'name'), category_id = (p_data->>'category_id')::int,
      unit = p_data->>'unit', price_cents = (p_data->>'price_cents')::int, cost_cents = (p_data->>'cost_cents')::int,
      min_stock = coalesce((p_data->>'min_stock')::int, 0), active = coalesce((p_data->>'active')::boolean, true),
      allow_negative = coalesce((p_data->>'allow_negative')::boolean, false), shortcut_pos = v_pos, icon = coalesce(p_data->>'icon', ''),
      ncm = nullif(p_data->>'ncm', ''), cfop = nullif(p_data->>'cfop', ''), cst = nullif(p_data->>'cst', ''), updated_at = now()
     where id = p_id and deleted_at is null returning id into v_id;
    if v_id is null then perform _err('Produto não encontrado.', 'NAO_ENCONTRADO'); end if;
    perform _audit(u.id, 'PRODUTO_ALTERADO', 'product', v_id, p_data);
  else
    insert into products(code, ean, name, category_id, unit, price_cents, cost_cents, min_stock, active, allow_negative, shortcut_pos, icon, ncm, cfop, cst)
    values (v_code, v_ean, trim(p_data->>'name'), (p_data->>'category_id')::int, p_data->>'unit', (p_data->>'price_cents')::int,
      (p_data->>'cost_cents')::int, coalesce((p_data->>'min_stock')::int, 0), coalesce((p_data->>'active')::boolean, true),
      coalesce((p_data->>'allow_negative')::boolean, false), v_pos, coalesce(p_data->>'icon', ''),
      nullif(p_data->>'ncm', ''), nullif(p_data->>'cfop', ''), nullif(p_data->>'cst', '')) returning id into v_id;
    if v_init > 0 then perform _apply_stock(v_id, v_init, 'INICIAL', u.id, null, null, null, null, 'Estoque inicial', false); end if;
    perform _audit(u.id, 'PRODUTO_CRIADO', 'product', v_id, p_data);
  end if;
  return (select to_jsonb(v) from v_products v where v.id = v_id);
end $$;

create or replace function shortcuts_set(p_token text, p_slots jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare u users; s jsonb;
begin
  u := _op(p_token);
  perform _require_role(u, array['admin','gerente']);
  update products set shortcut_pos = null where shortcut_pos is not null;
  for s in select * from jsonb_array_elements(p_slots) loop
    if (s->>'pos')::int not between 1 and 24 then perform _err('Posição de atalho inválida.'); end if;
    if nullif(s->>'product_id', '') is not null then
      update products set shortcut_pos = (s->>'pos')::int where id = (s->>'product_id')::int;
    end if;
  end loop;
  perform _audit(u.id, 'ATALHOS_ALTERADOS', 'products', null, p_slots);
end $$;

-- ---------- clientes / fiado ----------
create or replace function customer_save(p_token text, p_id int, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; v_id int; v_lim int := (p_data->>'credit_limit_cents')::int;
begin
  u := _op(p_token);
  perform _require_role(u, array['admin','gerente']);
  if trim(coalesce(p_data->>'name', '')) = '' then perform _err('Nome do cliente é obrigatório.'); end if;
  if v_lim is null or v_lim < 0 then perform _err('Limite inválido.'); end if;
  if p_id is not null then
    update customers set name = trim(p_data->>'name'), phone = coalesce(p_data->>'phone', ''), doc = coalesce(p_data->>'doc', ''),
      credit_limit_cents = v_lim, active = coalesce((p_data->>'active')::boolean, true), note = coalesce(p_data->>'note', '')
     where id = p_id returning id into v_id;
    if v_id is null then perform _err('Cliente não encontrado.', 'NAO_ENCONTRADO'); end if;
    perform _audit(u.id, 'CLIENTE_ALTERADO', 'customer', v_id, p_data);
  else
    insert into customers(name, phone, doc, credit_limit_cents, active, note)
    values (trim(p_data->>'name'), coalesce(p_data->>'phone', ''), coalesce(p_data->>'doc', ''), v_lim,
      coalesce((p_data->>'active')::boolean, true), coalesce(p_data->>'note', '')) returning id into v_id;
    perform _audit(u.id, 'CLIENTE_CRIADO', 'customer', v_id, p_data);
  end if;
  return (select to_jsonb(c) from customers c where id = v_id);
end $$;

create or replace function customer_charge(p_token text, p_id int, p_amount int, p_note text default null, p_manager_pin text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; v_by int; v_bal int;
begin
  u := _op(p_token);
  if p_amount is null or p_amount <= 0 then perform _err('Valor deve ser maior que zero.'); end if;
  v_by := _authorize_manager(u, p_manager_pin, 'Lançamento manual no fiado');
  v_bal := _ledger(p_id, 'LANCAMENTO', p_amount, u.id, null, null, null, nullif(p_note, ''), true);
  perform _audit(u.id, 'FIADO_LANCAMENTO', 'customer', p_id, jsonb_build_object('amount', p_amount, 'note', p_note, 'authorized_by', v_by));
  return jsonb_build_object('balance_cents', v_bal);
end $$;

create or replace function customer_receive(p_token text, p_terminal text, p_id int, p_amount int, p_method text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; c customers; s cash_sessions; v_bal int; v_mv bigint;
begin
  u := _op(p_token);
  if p_amount is null or p_amount <= 0 then perform _err('Valor deve ser maior que zero.'); end if;
  if p_method not in ('dinheiro','pix','debito','credito','voucher') then perform _err('Recebimento de fiado não pode ser em fiado.'); end if;
  select * into c from customers where id = p_id for update;
  if c.id is null then perform _err('Cliente não encontrado.', 'NAO_ENCONTRADO'); end if;
  if p_amount > c.balance_cents then perform _err('Valor maior que a dívida (' || _brl(c.balance_cents) || ').'); end if;
  s := _require_session(p_terminal);
  v_bal := _ledger(p_id, 'RECEBIMENTO', -p_amount, u.id, null, s.id, p_method, nullif(p_note, ''), false);
  v_mv := _cash_move(s.id, 'RECEBIMENTO_FIADO', p_method, p_amount, u.id, 'customer', p_id, 'Recebimento fiado — ' || c.name);
  perform _audit(u.id, 'FIADO_RECEBIMENTO', 'customer', p_id, jsonb_build_object('amount', p_amount, 'method', p_method, 'movement', v_mv));
  return jsonb_build_object('balance_cents', v_bal);
end $$;

create or replace function customer_statement(p_id int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb;
begin
  perform _require_store();
  select to_jsonb(x) into c from customers x where id = p_id;
  if c is null then perform _err('Cliente não encontrado.', 'NAO_ENCONTRADO'); end if;
  return jsonb_build_object('customer', c, 'entries', coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('user_name', u.name, 'sale_number', s.number) order by l.id desc)
    from customer_ledger l join users u on u.id = l.user_id left join sales s on s.id = l.sale_id where l.customer_id = p_id), '[]'::jsonb));
end $$;

-- ---------- configurações / usuários ----------
create or replace function settings_update(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users;
begin
  u := _op(p_token);
  perform _require_role(u, array['admin','gerente']);
  update store_settings set
    name = coalesce(nullif(p_data->>'name', ''), name), legal_name = coalesce(p_data->>'legal_name', legal_name),
    cnpj = coalesce(p_data->>'cnpj', cnpj), address = coalesce(p_data->>'address', address), phone = coalesce(p_data->>'phone', phone),
    receipt_footer = coalesce(p_data->>'receipt_footer', receipt_footer),
    discount_limit_pct = least(10000, greatest(0, coalesce((p_data->>'discount_limit_pct')::int, discount_limit_pct))),
    allow_negative_stock = coalesce((p_data->>'allow_negative_stock')::boolean, allow_negative_stock),
    expiry_alert_days = least(60, greatest(0, coalesce((p_data->>'expiry_alert_days')::int, expiry_alert_days))),
    printer_host = coalesce(p_data->>'printer_host', printer_host), printer_port = coalesce((p_data->>'printer_port')::int, printer_port),
    scale_label_mode = coalesce(p_data->>'scale_label_mode', scale_label_mode),
    scale_code_digits = least(6, greatest(4, coalesce((p_data->>'scale_code_digits')::int, scale_code_digits))),
    updated_at = now()
   where loja_id = current_loja_id();
  perform _audit(u.id, 'CONFIG_ALTERADA', 'store_settings', null, p_data);
  return _settings_json();
end $$;

-- ---------- painel ----------
create or replace function app_status(p_token text, p_terminal text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare u users; s cash_sessions;
begin
  u := _op(p_token);
  s := _open_session(p_terminal);
  return jsonb_build_object('store', _settings_json(), 'terminal', p_terminal,
    'user', jsonb_build_object('id', u.id, 'name', u.name, 'role', u.role),
    'session', case when s.id is null then null else session_summary(s.id) end,
    'alerts', jsonb_build_object('expiring', expiring_lots(null),
       'low_stock', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'unit', unit, 'stock_qty', stock_qty, 'min_stock', min_stock, 'icon', icon) order by name)
          from products where active and stock_qty <= min_stock), '[]'::jsonb)),
    'held_count', (select count(*) from held_sales where terminal = p_terminal),
    'orders_pending', (select count(*) from orders where status in ('AGUARDANDO','AVISADA','PRONTA')));
end $$;

-- ---------- relatórios ----------
create or replace function report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sum record; v_canc record; v_loss int; v_promo record;
begin
  perform _require_store();
  select count(*)::int items, count(distinct i.sale_id)::int sales, coalesce(sum(i.total_cents),0)::int total,
         coalesce(sum(greatest(0, round((coalesce(i.regular_price_cents, i.unit_price_cents) - i.unit_price_cents)::numeric * i.qty / 1000.0))),0)::int savings
    into v_promo from sale_items i join sales s on s.id = i.sale_id
   where i.promotion_id is not null and s.status = 'FINALIZADA' and _local_date(s.created_at) between p_from and p_to;
  select count(*)::int sales_count, coalesce(sum(gross_cents),0)::int gross_cents,
         coalesce(sum(item_discount_cents + total_discount_cents),0)::int discount_cents,
         coalesce(sum(total_cents),0)::int total_cents, coalesce(sum(cost_cents),0)::int cost_cents,
         (count(*) filter (where imported))::int imported_count, coalesce(sum(total_cents) filter (where imported),0)::int imported_total_cents
    into v_sum from sales s where s.status = 'FINALIZADA' and _local_date(s.created_at) between p_from and p_to;
  select count(*)::int n, coalesce(sum(total_cents),0)::int total into v_canc
    from sales s where s.status = 'CANCELADA' and _local_date(s.created_at) between p_from and p_to;
  select coalesce(sum(cost_cents),0)::int into v_loss from losses l where _local_date(l.created_at) between p_from and p_to;
  return jsonb_build_object('from', p_from, 'to', p_to,
    'summary', jsonb_build_object('sales_count', v_sum.sales_count, 'gross_cents', v_sum.gross_cents, 'discount_cents', v_sum.discount_cents,
      'total_cents', v_sum.total_cents, 'cost_cents', v_sum.cost_cents,
      -- margem só das vendas com itens (as importadas não têm custo)
      'margin_cents', v_sum.total_cents - v_sum.imported_total_cents - v_sum.cost_cents,
      'margin_pct_x100', case when v_sum.total_cents - v_sum.imported_total_cents > 0 then round((v_sum.total_cents - v_sum.imported_total_cents - v_sum.cost_cents) * 10000.0 / (v_sum.total_cents - v_sum.imported_total_cents))::int else 0 end,
      'imported_count', v_sum.imported_count, 'imported_total_cents', v_sum.imported_total_cents,
      'promo_items_count', v_promo.items, 'promo_sales_count', v_promo.sales, 'promo_total_cents', v_promo.total, 'promo_savings_cents', v_promo.savings,
      'ticket_medio_cents', case when v_sum.sales_count > 0 then round(v_sum.total_cents::numeric / v_sum.sales_count)::int else 0 end,
      'canceled_count', v_canc.n, 'canceled_total_cents', v_canc.total, 'loss_cost_cents', v_loss),
    'by_operator', coalesce((select jsonb_agg(x order by x.total_cents desc) from (
        select case when s.imported then 'Sistema antigo (importadas)' else u.name end as name, count(*)::int sales_count, sum(s.total_cents)::int total_cents
          from sales s join users u on u.id = s.user_id
         where s.status = 'FINALIZADA' and _local_date(s.created_at) between p_from and p_to group by 1) x), '[]'::jsonb),
    'by_payment', coalesce((select jsonb_agg(x order by x.total_cents desc) from (
        select p.method, count(*)::int n, sum(p.net_cents)::int total_cents,
          case p.method when 'dinheiro' then 'Dinheiro' when 'pix' then 'PIX' when 'debito' then 'Débito' when 'credito' then 'Crédito'
            when 'voucher' then 'Voucher' when 'nao_informado' then 'Não informado' else 'Fiado' end label
          from sale_payments p join sales s on s.id = p.sale_id
         where s.status = 'FINALIZADA' and _local_date(s.created_at) between p_from and p_to group by p.method) x), '[]'::jsonb),
    'by_category', coalesce((select jsonb_agg(x order by x.total_cents desc) from (
        select c.name, c.color, sum(i.total_cents)::int total_cents, sum(round(i.unit_cost_cents::numeric * i.qty / 1000.0))::int cost_cents
          from sale_items i join sales s on s.id = i.sale_id join products p on p.id = i.product_id join categories c on c.id = p.category_id
         where s.status = 'FINALIZADA' and _local_date(s.created_at) between p_from and p_to group by c.id, c.name, c.color) x), '[]'::jsonb),
    'by_product', coalesce((select jsonb_agg(x order by x.total_cents desc) from (
        select p.id, p.name, p.unit, p.icon, sum(i.qty)::int qty, sum(i.total_cents)::int total_cents,
               sum(round(i.unit_cost_cents::numeric * i.qty / 1000.0))::int cost_cents,
               coalesce(sum(i.total_cents) filter (where i.promotion_id is not null), 0)::int promo_total_cents
          from sale_items i join sales s on s.id = i.sale_id join products p on p.id = i.product_id
         where s.status = 'FINALIZADA' and _local_date(s.created_at) between p_from and p_to group by p.id) x), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(x order by x.day) from (
        select _local_date(s.created_at) as day, count(*)::int sales_count, sum(s.total_cents)::int total_cents from sales s
         where s.status = 'FINALIZADA' and _local_date(s.created_at) between p_from and p_to group by 1) x), '[]'::jsonb),
    'losses', coalesce((select jsonb_agg(x order by x.cost_cents desc) from (
        select l.reason, count(*)::int n, sum(l.cost_cents)::int cost_cents,
          case l.reason when 'amadureceu' then 'Amadureceu' when 'estragou' then 'Estragou' when 'queda' then 'Queda' else 'Consumo interno' end label
          from losses l where _local_date(l.created_at) between p_from and p_to group by l.reason) x), '[]'::jsonb),
    'loss_items', coalesce((select jsonb_agg(x order by x.id desc) from (
        select l.id, l.created_at, l.reason, l.qty, l.cost_cents, l.note, p.name, p.unit, u.name as user_name
          from losses l join products p on p.id = l.product_id join users u on u.id = l.user_id
         where _local_date(l.created_at) between p_from and p_to) x), '[]'::jsonb));
end $$;

-- ---------- views de leitura (respeitam RLS de quem consulta) ----------
-- produtos apagados (deleted_at) somem de todas as telas; a lista deles é v_products_deleted (06_products_delete.sql)
drop view if exists v_products;
-- v3.2: promo_* = promoção vigente ou a próxima agendada (o app confere início/fim pelo relógio, até sem internet)
create view v_products with (security_invoker = true) as
  select p.*, c.name as category_name, c.color as category_color, c.slug as category_slug,
         pr.id as promo_id, pr.promo_price_cents, pr.starts_at as promo_starts_at, pr.ends_until as promo_ends_at
    from products p join categories c on c.id = p.category_id
    left join lateral (select x.id, x.promo_price_cents, x.starts_at, least(x.ends_at, coalesce(x.ended_at, x.ends_at)) as ends_until
                         from promotions x where x.product_id = p.id and least(x.ends_at, coalesce(x.ended_at, x.ends_at)) > now()
                        order by x.starts_at limit 1) pr on true
   where p.deleted_at is null;
create or replace view v_cash_sessions with (security_invoker = true) as
  select s.*, u.name as opened_by_name from cash_sessions s join users u on u.id = s.opened_by;
create or replace view v_sales_list with (security_invoker = true) as
  select s.id, s.number, s.status, s.total_cents, s.created_at, s.terminal, s.offline, _local_date(s.created_at) as local_date,
         u.name as user_name, c.name as customer_name,
         (select string_agg(method, '+' order by id) from sale_payments where sale_id = s.id) as methods,
         (select count(*) from sale_items where sale_id = s.id)::int as items_count, s.imported,
         s.deleted_at, s.delete_reason, (select d.name from users d where d.id = s.deleted_by) as deleted_by_name
    from sales s join users u on u.id = s.user_id left join customers c on c.id = s.customer_id;
create or replace view v_losses with (security_invoker = true) as
  select l.*, _local_date(l.created_at) as local_date, p.name as product_name, p.unit, u.name as user_name, a.name as authorized_name
    from losses l join products p on p.id = l.product_id join users u on u.id = l.user_id left join users a on a.id = l.authorized_by;
drop view if exists v_stock_movements;
create view v_stock_movements with (security_invoker = true) as
  select m.*, u.name as user_name, s.name as supplier_name, p.name as product_name, p.unit as product_unit
    from stock_movements m left join users u on u.id = m.user_id
    left join suppliers s on s.id = m.supplier_id join products p on p.id = m.product_id;
create or replace view v_held_sales with (security_invoker = true) as
  select h.*, u.name as user_name from held_sales h join users u on u.id = h.user_id;
create or replace view v_audit with (security_invoker = true) as
  select a.*, u.name as user_name from audit_log a left join users u on u.id = a.user_id;
