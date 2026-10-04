-- v3.1: apagar produto (só gerente/admin).
--  * sem histórico (nunca vendido, comprado/entrada, ajustado, perdido nem com lote) → apaga de vez (e o "Estoque inicial" dele);
--  * com histórico → some de todas as telas (inativo, sem atalho, deleted_at), mas vendas/relatórios continuam com o nome;
--  * nos dois casos o código (PLU) e o código de barras ficam livres: no apagado com histórico viram "101~17" (sufixo ~id).
--  * restaurar devolve código/EAN originais se ainda estiverem livres.

create or replace view v_products_deleted with (security_invoker = true) as
  select p.*, c.name as category_name, c.color as category_color, c.slug as category_slug,
         regexp_replace(p.code, '~\d+$', '') as original_code, regexp_replace(p.ean, '~\d+$', '') as original_ean
    from products p join categories c on c.id = p.category_id where p.deleted_at is not null;

create or replace function _product_usage(p_id int) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'sales', (select count(*) from sale_items where product_id = p_id)::int,
    'movements', (select count(*) from stock_movements where product_id = p_id and type <> 'INICIAL')::int,
    'lots', (select count(*) from lots where product_id = p_id)::int,
    'losses', (select count(*) from losses where product_id = p_id)::int)
$$;

create or replace function product_usage(p_id int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _require_store();
  r := _product_usage(p_id);
  return r || jsonb_build_object('has_history', (r->>'sales')::int + (r->>'movements')::int + (r->>'lots')::int + (r->>'losses')::int > 0);
end $$;

create or replace function product_delete(p_token text, p_id int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; p products; us jsonb; hist boolean;
begin
  u := _op(p_token);
  perform _require_role(u, array['admin','gerente']);
  select * into p from products where id = p_id and deleted_at is null for update;
  if p.id is null then perform _err('Produto não encontrado (ou já apagado).', 'NAO_ENCONTRADO'); end if;
  us := _product_usage(p_id);
  hist := (us->>'sales')::int + (us->>'movements')::int + (us->>'lots')::int + (us->>'losses')::int > 0;
  -- promoção em andamento/agendada do produto acaba junto
  update promotions set ended_at = now() where product_id = p_id and least(ends_at, coalesce(ended_at, ends_at)) > now();
  if hist then
    update products set active = false, shortcut_pos = null, deleted_at = now(), updated_at = now(),
      code = code || '~' || id, ean = case when ean is null then null else ean || '~' || id end
     where id = p_id;
  else
    delete from stock_movements where product_id = p_id and type = 'INICIAL';
    delete from products where id = p_id;
  end if;
  perform _audit(u.id, 'PRODUTO_APAGADO', 'product', p_id, jsonb_build_object('name', p.name, 'code', p.code, 'ean', p.ean,
    'modo', case when hist then 'escondido (tem histórico)' else 'apagado de vez' end, 'uso', us));
  return jsonb_build_object('id', p_id, 'name', p.name, 'mode', case when hist then 'soft' else 'hard' end, 'usage', us);
end $$;

create or replace function product_restore(p_token text, p_id int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; p products; v_code text; v_ean text; warn text := null;
begin
  u := _op(p_token);
  perform _require_role(u, array['admin','gerente']);
  select * into p from products where id = p_id and deleted_at is not null for update;
  if p.id is null then perform _err('Produto apagado não encontrado.', 'NAO_ENCONTRADO'); end if;
  v_code := regexp_replace(p.code, '~\d+$', '');
  v_ean := nullif(regexp_replace(coalesce(p.ean, ''), '~\d+$', ''), '');
  if exists (select 1 from products where code = v_code and id <> p_id) then
    warn := 'O código ' || v_code || ' já é de outro produto: este voltou com o código ' || p.code || ' (mude no cadastro).';
    v_code := p.code;
  end if;
  if v_ean is not null and exists (select 1 from products where ean = v_ean and id <> p_id) then
    warn := coalesce(warn || ' ', '') || 'O código de barras ' || v_ean || ' já é de outro produto: este voltou sem código de barras.';
    v_ean := null;
  end if;
  update products set deleted_at = null, active = true, code = v_code, ean = v_ean, updated_at = now() where id = p_id;
  perform _audit(u.id, 'PRODUTO_RESTAURADO', 'product', p_id, jsonb_build_object('name', p.name, 'code', v_code, 'ean', v_ean));
  return (select to_jsonb(v) from v_products v where v.id = p_id) || jsonb_build_object('warning', warn);
end $$;

revoke all on function _product_usage(int) from public, anon, authenticated;
revoke all on function product_usage(int), product_delete(text, int), product_restore(text, int) from public, anon;
grant execute on function product_usage(int), product_delete(text, int), product_restore(text, int) to authenticated;
revoke all on v_products_deleted from anon;
grant select on v_products_deleted to authenticated;
