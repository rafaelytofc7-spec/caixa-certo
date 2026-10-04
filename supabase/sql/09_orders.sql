-- v3.3: encomendas. O operador cadastra, avisa o cliente pelo WhatsApp quando chega (o app só abre a conversa
-- com a mensagem pronta) e conclui: aí vira uma venda de verdade (número, estoque, caixa, fiado), igual à do caixa.

create or replace view v_orders with (security_invoker = true) as
  select o.*, _local_date(o.created_at) as local_date,
         cu.name as created_by_name, nu.name as notified_by_name, ku.name as concluded_by_name, xu.name as canceled_by_name,
         s.number as sale_number, s.status as sale_status,
         coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'product_id', i.product_id, 'name', i.name, 'unit', i.unit, 'qty', i.qty,
                    'line_cents', i.line_cents, 'icon', p.icon, 'price_cents', p.price_cents) order by i.pos, i.id)
                     from order_items i left join products p on p.id = i.product_id where i.order_id = o.id), '[]'::jsonb) as items,
         (select case when bool_and(i.line_cents is not null) then sum(i.line_cents) end from order_items i where i.order_id = o.id)::int as total_cents
    from orders o left join users cu on cu.id = o.created_by left join users nu on nu.id = o.notified_by
         left join users ku on ku.id = o.concluded_by left join users xu on xu.id = o.canceled_by left join sales s on s.id = o.sale_id;

create or replace function _order_json(p_id int) returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(v) from v_orders v where v.id = p_id
$$;

-- telefone BR: só dígitos, sem o 55 do país; aceita fixo (10) ou celular (11)
create or replace function _br_phone(p text) returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) in (12, 13) and left(d, 2) = '55' then d := substr(d, 3); end if;
  if d = '' then return ''; end if;
  if length(d) not in (10, 11) then perform _err('Telefone inválido: use DDD + número (ex.: (11) 98765-4321).', 'TELEFONE'); end if;
  return d;
end $$;

-- criar (p_id null) ou alterar. p_data: {customer_id, customer_name, phone, items:[{product_id|null, name, unit, qty, line_cents}],
--   paid, paid_method, delivery, address, note}
create or replace function order_save(p_token text, p_id int, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; o orders; it jsonb; p products; v_id int; v_pos int := 0; v_qty int; v_line int; v_unit text; v_name text;
  v_items jsonb := coalesce(p_data->'items', '[]'::jsonb); v_total int := 0; v_all_valued boolean := true;
  v_cust int := nullif(p_data->>'customer_id', '')::int; v_paid boolean := coalesce((p_data->>'paid')::boolean, false);
  v_method text := nullif(p_data->>'paid_method', ''); v_delivery text := coalesce(nullif(p_data->>'delivery', ''), 'a_combinar');
  v_phone text;
begin
  u := _op(p_token);
  if trim(coalesce(p_data->>'customer_name', '')) = '' then perform _err('Informe o nome do cliente.'); end if;
  v_phone := _br_phone(p_data->>'phone');
  if v_phone = '' then perform _err('Informe o telefone (WhatsApp) do cliente.', 'TELEFONE'); end if;
  if v_cust is not null and not exists (select 1 from customers where id = v_cust) then perform _err('Cliente não encontrado.', 'NAO_ENCONTRADO'); end if;
  if v_delivery not in ('buscar','entrega','a_combinar') then perform _err('Escolha buscar, entrega ou a combinar.'); end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then perform _err('Coloque pelo menos um item na encomenda.'); end if;
  if v_paid and (v_method is null or v_method not in ('dinheiro','pix','debito','credito','voucher')) then
    perform _err('Encomenda paga: diga a forma (dinheiro, Pix, débito, crédito ou voucher).', 'PAGAMENTO');
  end if;
  if not v_paid then v_method := null; end if;
  if p_id is not null then
    select * into o from orders where id = p_id for update;
    if o.id is null then perform _err('Encomenda não encontrada.', 'NAO_ENCONTRADO'); end if;
    if o.status in ('CONCLUIDA','CANCELADA') then perform _err('Encomenda ' || lower(o.status) || ': não dá para alterar.', 'CONFLITO'); end if;
  end if;
  -- valida os itens antes de gravar
  for it in select * from jsonb_array_elements(v_items) loop
    v_qty := nullif(it->>'qty', '')::int; v_line := nullif(it->>'line_cents', '')::int;
    if v_qty is null or v_qty <= 0 then perform _err('Quantidade inválida em ' || coalesce(nullif(it->>'name', ''), 'um item') || '.'); end if;
    if v_line is not null and v_line < 0 then perform _err('Valor inválido em ' || coalesce(nullif(it->>'name', ''), 'um item') || '.'); end if;
    if nullif(it->>'product_id', '') is not null then
      select * into p from products where id = (it->>'product_id')::int and deleted_at is null;
      if p.id is null then perform _err('Produto ' || coalesce(it->>'name', it->>'product_id') || ' não encontrado.', 'NAO_ENCONTRADO'); end if;
      if p.unit <> 'KG' and v_qty % 1000 <> 0 then perform _err(p.name || ' é por unidade inteira.'); end if;
    elsif trim(coalesce(it->>'name', '')) = '' then perform _err('Item sem nome.');
    end if;
    if v_line is null then v_all_valued := false; else v_total := v_total + v_line; end if;
  end loop;
  if v_paid and (not v_all_valued or v_total <= 0) then perform _err('Encomenda paga precisa do valor de todos os itens.', 'PAGAMENTO'); end if;

  if p_id is null then
    insert into orders(customer_id, customer_name, phone, paid, paid_method, delivery, address, note, created_by)
    values (v_cust, trim(p_data->>'customer_name'), v_phone, v_paid, v_method, v_delivery, coalesce(trim(p_data->>'address'), ''),
      coalesce(trim(p_data->>'note'), ''), u.id) returning id into v_id;
  else
    v_id := p_id;
    update orders set customer_id = v_cust, customer_name = trim(p_data->>'customer_name'), phone = v_phone, paid = v_paid, paid_method = v_method,
      delivery = v_delivery, address = coalesce(trim(p_data->>'address'), ''), note = coalesce(trim(p_data->>'note'), ''), updated_at = now()
     where id = v_id;
    delete from order_items where order_id = v_id;
  end if;
  for it in select * from jsonb_array_elements(v_items) loop
    v_pos := v_pos + 1; p := null;
    if nullif(it->>'product_id', '') is not null then select * into p from products where id = (it->>'product_id')::int; end if;
    v_name := coalesce(p.name, trim(it->>'name')); v_unit := coalesce(p.unit, case when it->>'unit' = 'KG' then 'KG' else 'UN' end);
    insert into order_items(order_id, product_id, name, unit, qty, line_cents, pos)
    values (v_id, p.id, v_name, v_unit, (it->>'qty')::int, nullif(it->>'line_cents', '')::int, v_pos);
  end loop;
  perform _audit(u.id, case when p_id is null then 'ENCOMENDA_CRIADA' else 'ENCOMENDA_ALTERADA' end, 'order', v_id,
    jsonb_build_object('cliente', trim(p_data->>'customer_name'), 'itens', jsonb_array_length(v_items), 'pago', v_paid, 'total', case when v_all_valued then v_total end));
  return _order_json(v_id);
end $$;

-- "Chegou": marca avisada (o app abre o WhatsApp com a mensagem; quem envia é a pessoa)
create or replace function order_notify(p_token text, p_id int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; o orders;
begin
  u := _op(p_token);
  select * into o from orders where id = p_id for update;
  if o.id is null then perform _err('Encomenda não encontrada.', 'NAO_ENCONTRADO'); end if;
  if o.status in ('CONCLUIDA','CANCELADA') then perform _err('Encomenda ' || lower(o.status) || '.', 'CONFLITO'); end if;
  update orders set status = case when status = 'AGUARDANDO' then 'AVISADA' else status end, notified_at = now(), notified_by = u.id,
    notified_count = notified_count + 1, updated_at = now() where id = p_id;
  perform _audit(u.id, 'ENCOMENDA_AVISADA', 'order', p_id, jsonb_build_object('cliente', o.customer_name, 'vez', o.notified_count + 1));
  return _order_json(p_id);
end $$;

create or replace function order_ready(p_token text, p_id int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; o orders;
begin
  u := _op(p_token);
  select * into o from orders where id = p_id for update;
  if o.id is null then perform _err('Encomenda não encontrada.', 'NAO_ENCONTRADO'); end if;
  if o.status in ('CONCLUIDA','CANCELADA') then perform _err('Encomenda ' || lower(o.status) || '.', 'CONFLITO'); end if;
  update orders set status = 'PRONTA', ready_at = now(), updated_at = now() where id = p_id;
  perform _audit(u.id, 'ENCOMENDA_PRONTA', 'order', p_id, jsonb_build_object('cliente', o.customer_name));
  return _order_json(p_id);
end $$;

-- cancelar: gerente/admin (operador precisa do PIN do gerente, como no cancelamento de venda)
create or replace function order_cancel(p_token text, p_id int, p_reason text default '', p_manager_pin text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; o orders; v_by int;
begin
  u := _op(p_token);
  v_by := _authorize_manager(u, p_manager_pin, 'Cancelar encomenda');
  select * into o from orders where id = p_id for update;
  if o.id is null then perform _err('Encomenda não encontrada.', 'NAO_ENCONTRADO'); end if;
  if o.status in ('CONCLUIDA','CANCELADA') then perform _err('Encomenda ' || lower(o.status) || ': não dá para cancelar.', 'CONFLITO'); end if;
  update orders set status = 'CANCELADA', canceled_at = now(), canceled_by = v_by, cancel_reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now() where id = p_id;
  perform _audit(u.id, 'ENCOMENDA_CANCELADA', 'order', p_id, jsonb_build_object('cliente', o.customer_name, 'motivo', p_reason, 'authorized_by', v_by));
  return _order_json(p_id);
end $$;

-- Concluir: vira venda de verdade (número, estoque, caixa aberto, fiado). Paga antes: usa a forma e o valor combinados.
-- p_data: {payments:[{method, amount_cents}], items:[{id, qty, line_cents}] (ajustes, só se não estava paga), customer_id (fiado)}
create or replace function order_conclude(p_token text, p_terminal text, p_id int, p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u users; o orders; sess cash_sessions; it record; ov jsonb; pay jsonb; p products;
  v_pays jsonb; v_total int := 0; v_cost int := 0; v_paid int := 0; v_noncash int := 0; v_fiado int := 0; v_change int; v_change_left int;
  v_amt int; v_net int; v_number int; v_sale int; v_qty int; v_line int; v_cust int; v_first text;
begin
  u := _op(p_token);
  select * into o from orders where id = p_id for update;
  if o.id is null then perform _err('Encomenda não encontrada.', 'NAO_ENCONTRADO'); end if;
  if o.status = 'CONCLUIDA' then perform _err('Encomenda já concluída (venda feita).', 'CONFLITO'); end if;
  if o.status = 'CANCELADA' then perform _err('Encomenda cancelada.', 'CONFLITO'); end if;
  -- ajustes de quantidade/valor na hora de entregar (ex.: veio 1,850 kg em vez de 2 kg) — só se ainda não foi paga
  if not o.paid and jsonb_typeof(p_data->'items') = 'array' then
    for ov in select * from jsonb_array_elements(p_data->'items') loop
      v_qty := nullif(ov->>'qty', '')::int; v_line := nullif(ov->>'line_cents', '')::int;
      if v_qty is null or v_qty <= 0 or v_line is null or v_line < 0 then perform _err('Quantidade e valor de cada item precisam estar preenchidos.'); end if;
      update order_items set qty = v_qty, line_cents = v_line where id = (ov->>'id')::int and order_id = o.id;
    end loop;
  end if;
  for it in select i.*, pr.unit as p_unit, pr.cost_cents as p_cost, pr.price_cents as p_price from order_items i left join products pr on pr.id = i.product_id
            where i.order_id = o.id loop
    if it.qty is null or it.qty <= 0 or it.line_cents is null then perform _err('Falta quantidade ou valor em ' || it.name || '.'); end if;
    if it.product_id is not null and it.p_unit <> 'KG' and it.qty % 1000 <> 0 then perform _err(it.name || ' é por unidade inteira.'); end if;
    v_total := v_total + it.line_cents;
    v_cost := v_cost + coalesce(round(it.p_cost::numeric * it.qty / 1000.0)::int, 0);
  end loop;
  if v_total <= 0 then perform _err('Total da encomenda precisa ser maior que zero.'); end if;

  v_pays := case when o.paid then jsonb_build_array(jsonb_build_object('method', o.paid_method, 'amount_cents', v_total))
                 else coalesce(p_data->'payments', '[]'::jsonb) end;
  if jsonb_typeof(v_pays) <> 'array' or jsonb_array_length(v_pays) = 0 then perform _err('Informe a forma de pagamento.', 'PAGAMENTO'); end if;
  for pay in select * from jsonb_array_elements(v_pays) loop
    v_amt := (pay->>'amount_cents')::int;
    if pay->>'method' not in ('dinheiro','pix','debito','credito','voucher','fiado') then perform _err('Forma de pagamento inválida.', 'PAGAMENTO'); end if;
    if v_amt is null or v_amt <= 0 then perform _err('Valor de pagamento inválido.', 'PAGAMENTO'); end if;
    v_paid := v_paid + v_amt; v_first := coalesce(v_first, pay->>'method');
    if pay->>'method' <> 'dinheiro' then v_noncash := v_noncash + v_amt; end if;
    if pay->>'method' = 'fiado' then v_fiado := v_fiado + v_amt; end if;
  end loop;
  if v_paid < v_total then perform _err('Pagamento menor que o total (' || _brl(v_total) || ').', 'PAGAMENTO'); end if;
  if v_noncash > v_total then perform _err('Troco só em dinheiro: PIX/cartão/voucher/fiado não podem passar do total.', 'PAGAMENTO'); end if;
  v_change := v_paid - v_total;
  v_cust := coalesce(nullif(p_data->>'customer_id', '')::int, o.customer_id);
  if v_fiado > 0 and v_cust is null then perform _err('Fiado precisa de cliente cadastrado: escolha o cliente.', 'FIADO_SEM_CLIENTE'); end if;

  sess := _open_session(p_terminal);
  if sess.id is null then perform _err('Caixa fechado. Abra o caixa para concluir a encomenda (a venda entra no caixa).', 'CAIXA_FECHADO'); end if;
  update store_settings set last_sale_number = last_sale_number + 1 where loja_id = current_loja_id() returning last_sale_number into v_number;
  insert into sales(number, session_id, terminal, user_id, customer_id, gross_cents, item_discount_cents, total_discount_cents, total_cents,
      paid_cents, change_cents, cost_cents)
  values (v_number, sess.id, p_terminal, u.id, v_cust, v_total, 0, 0, v_total, v_paid, v_change, v_cost) returning id into v_sale;
  for it in select i.*, pr.cost_cents as p_cost, pr.price_cents as p_price from order_items i left join products pr on pr.id = i.product_id
            where i.order_id = o.id order by i.pos, i.id loop
    insert into sale_items(sale_id, product_id, name, unit, qty, unit_price_cents, gross_cents, discount_cents, total_cents, unit_cost_cents, regular_price_cents)
    values (v_sale, it.product_id, it.name, it.unit, it.qty, round(it.line_cents * 1000.0 / it.qty)::int, it.line_cents, 0, it.line_cents,
      coalesce(it.p_cost, 0), it.p_price);
    if it.product_id is not null then
      perform _apply_stock(it.product_id, -it.qty, 'VENDA', u.id, null, 'venda', v_sale, null, 'Encomenda nº ' || o.id || ' · venda nº ' || v_number, true);
    end if;
  end loop;
  v_change_left := v_change;
  for pay in select * from jsonb_array_elements(v_pays) loop
    v_amt := (pay->>'amount_cents')::int; v_net := v_amt;
    if pay->>'method' = 'dinheiro' and v_change_left > 0 then
      v_net := v_amt - least(v_change_left, v_amt); v_change_left := v_change_left - least(v_change_left, v_amt);
    end if;
    insert into sale_payments(sale_id, method, amount_cents, net_cents) values (v_sale, pay->>'method', v_amt, v_net);
    if v_net <> 0 then perform _cash_move(sess.id, 'VENDA', pay->>'method', v_net, u.id, 'venda', v_sale, 'Encomenda nº ' || o.id || ' · venda nº ' || v_number); end if;
  end loop;
  if v_fiado > 0 then
    perform _ledger(v_cust, 'COMPRA', v_fiado, u.id, v_sale, sess.id, 'fiado', 'Encomenda nº ' || o.id || ' · venda nº ' || v_number, true);
  end if;
  insert into fiscal_documents(sale_id, provider, status, access_key, payload)
  values (v_sale, 'mock', 'SIMULADO', left('35' || to_char(now(), 'YYMMDDHH24MISS') || lpad(v_number::text, 9, '0') || repeat('0', 44), 44),
    jsonb_build_object('message', 'Simulação — sem envio à SEFAZ. NÃO É DOCUMENTO FISCAL.'));
  update orders set status = 'CONCLUIDA', concluded_at = now(), concluded_by = u.id, sale_id = v_sale, customer_id = v_cust,
    paid = v_fiado = 0, paid_method = v_first, updated_at = now() where id = o.id;
  perform _audit(u.id, 'VENDA', 'sale', v_sale, jsonb_build_object('number', v_number, 'total', v_total, 'payments', v_pays, 'terminal', p_terminal, 'order_id', o.id));
  perform _audit(u.id, 'ENCOMENDA_CONCLUIDA', 'order', o.id, jsonb_build_object('cliente', o.customer_name, 'venda', v_number, 'total', v_total, 'ja_paga', o.paid));
  return jsonb_build_object('order', _order_json(o.id), 'sale', sale_get(v_sale));
end $$;
