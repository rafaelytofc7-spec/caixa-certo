-- v3.2: promoções. Só gerente/admin cria/encerra (RPC com _require_role; a tabela não aceita escrita direta pela API).

create or replace view v_promotions with (security_invoker = true) as
  select x.id, x.product_id, x.promo_price_cents, x.starts_at, x.ends_at, x.ended_at, x.note, x.created_at,
         least(x.ends_at, coalesce(x.ended_at, x.ends_at)) as ends_until,
         case when least(x.ends_at, coalesce(x.ended_at, x.ends_at)) <= now()
                then case when x.ended_at is not null and x.ended_at < x.ends_at then 'ENCERRADA' else 'EXPIRADA' end
              when x.starts_at > now() then 'AGENDADA' else 'ATIVA' end as status,
         p.name as product_name, p.icon as product_icon, p.unit as product_unit, p.code as product_code, p.price_cents as regular_price_cents,
         p.deleted_at is not null as product_deleted, u.name as created_by_name,
         (select count(*) from sale_items i join sales s on s.id = i.sale_id where i.promotion_id = x.id and s.status = 'FINALIZADA')::int as items_sold,
         (select coalesce(sum(i.total_cents), 0) from sale_items i join sales s on s.id = i.sale_id where i.promotion_id = x.id and s.status = 'FINALIZADA')::int as total_sold_cents
    from promotions x join products p on p.id = x.product_id left join users u on u.id = x.created_by;

-- p_data: { items: [{product_id, promo_price_cents}], starts_at, ends_at, note }
create or replace function promo_save(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; it jsonb; p products; v_start timestamptz; v_end timestamptz; v_price int; v_ids int[] := '{}'; v_id int; v_dup text;
begin
  u := _op(p_token);
  perform _require_role(u, array['admin','gerente']);
  begin
    v_start := coalesce(nullif(p_data->>'starts_at', '')::timestamptz, now());
    v_end := (p_data->>'ends_at')::timestamptz;
  exception when others then perform _err('Data/hora da promoção inválida.'); end;
  if v_end is null then perform _err('Informe quando a promoção acaba.'); end if;
  if v_end <= v_start then perform _err('O fim da promoção precisa ser depois do início.'); end if;
  if v_end <= now() then perform _err('Essa promoção já teria acabado: escolha um fim no futuro.'); end if;
  if jsonb_typeof(p_data->'items') <> 'array' or jsonb_array_length(p_data->'items') = 0 then perform _err('Escolha pelo menos um produto.'); end if;
  for it in select * from jsonb_array_elements(p_data->'items') loop
    select * into p from products where id = (it->>'product_id')::int and deleted_at is null;
    if p.id is null then perform _err('Produto ' || coalesce(it->>'product_id', '?') || ' não encontrado.', 'NAO_ENCONTRADO'); end if;
    v_price := (it->>'promo_price_cents')::int;
    if v_price is null or v_price <= 0 then perform _err('Preço de promoção inválido para ' || p.name || '.'); end if;
    if v_price >= p.price_cents then perform _err('Preço de promoção de ' || p.name || ' precisa ser menor que o normal (' || _brl(p.price_cents) || ').'); end if;
    select to_char(x.starts_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || ' a ' || to_char(least(x.ends_at, coalesce(x.ended_at, x.ends_at)) at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
      into v_dup from promotions x where x.product_id = p.id and least(x.ends_at, coalesce(x.ended_at, x.ends_at)) > v_start and x.starts_at < v_end limit 1;
    if v_dup is not null then perform _err(p.name || ' já tem promoção nesse período (' || v_dup || '). Encerre a outra antes.', 'CONFLITO'); end if;
    insert into promotions(product_id, promo_price_cents, starts_at, ends_at, note, created_by)
    values (p.id, v_price, v_start, v_end, nullif(p_data->>'note', ''), u.id) returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  perform _audit(u.id, 'PROMO_CRIADA', 'promotions', null, jsonb_build_object('ids', to_jsonb(v_ids), 'items', p_data->'items', 'starts_at', v_start, 'ends_at', v_end));
  return coalesce((select jsonb_agg(to_jsonb(v) order by v.product_name) from v_promotions v where v.id = any(v_ids)), '[]'::jsonb);
end $$;

create or replace function promo_end(p_token text, p_id int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; x promotions;
begin
  u := _op(p_token);
  perform _require_role(u, array['admin','gerente']);
  select * into x from promotions where id = p_id for update;
  if x.id is null then perform _err('Promoção não encontrada.', 'NAO_ENCONTRADO'); end if;
  if least(x.ends_at, coalesce(x.ended_at, x.ends_at)) <= now() then perform _err('Essa promoção já acabou.', 'CONFLITO'); end if;
  update promotions set ended_at = now() where id = p_id;
  perform _audit(u.id, 'PROMO_ENCERRADA', 'promotion', p_id, jsonb_build_object('product_id', x.product_id, 'promo_price_cents', x.promo_price_cents,
    'antes_de_comecar', x.starts_at > now()));
  return (select to_jsonb(v) from v_promotions v where v.id = p_id);
end $$;

revoke all on function promo_save(text, jsonb), promo_end(text, int) from public, anon;
grant execute on function promo_save(text, jsonb), promo_end(text, int) to authenticated;
revoke all on v_promotions from anon;
grant select on v_promotions to authenticated;
grant select on promotions to authenticated;
