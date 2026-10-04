-- ===================== Permissões e RLS (isolamento entre lojas) =====================
-- anon: NADA (nenhuma tabela, view ou função).
-- authenticated (usuário logado de uma loja): só SELECT nas tabelas/views de negócio, filtrado por RLS
--   (loja_id = current_loja_id() e loja liberada), e EXECUTE nas RPCs públicas da lista abaixo.
-- app_definer (dono das RPCs da loja): lê/escreve nas tabelas de negócio, mas SEMPRE pelo RLS da própria loja.
-- Tabelas da plataforma (lojas, loja_usuarios, super_admins, pagamentos, loja_eventos, plataforma_config):
--   RLS ligado e NENHUMA política/permissão para anon/authenticated → só funções SECURITY DEFINER acessam.

grant create on schema public to app_definer;   -- exigido para trocar o dono das funções (revogado no fim)

do $$
declare t text; f record;
  biz text[] := array['store_settings','users','user_pins','op_sessions','categories','products','lots','suppliers','purchases',
    'stock_movements','losses','customers','cash_sessions','cash_session_counts','cash_movements','sales','sale_items','sale_payments',
    'held_sales','customer_ledger','fiscal_documents','audit_log','promotions','orders','order_items'];
  secret text[] := array['user_pins','op_sessions'];       -- sem leitura pela API nem para a própria loja (hash do PIN, tokens)
  plat text[] := array['lojas','loja_usuarios','super_admins','pagamentos','loja_eventos','plataforma_config'];
  -- funções que ficam com o dono postgres (leem tabelas da plataforma; cada uma confere quem chama)
  pg_owned text[] := array['_uid','_jwt','_hex_token','_hash_pin','_pin_ok','current_loja_id','_loja_liberada','loja_liberada','is_super_admin','_tg_sep_admin_loja','_tg_users_sync',
    '_doc_tipo','_doc_norm','_doc_fmt','_seed_categories','account_signup_check','_create_loja','account_signup_loja',
    'account_admin_create_loja','account_admin_check','account_admin_target','_admin_from_token','account_check_admin','account_create','account_target',
    '_touch_loja','minha_loja','_require_super_admin','admin_me','_admin_loja_json','admin_lojas','admin_loja',
    'admin_registrar_pagamento','admin_bloquear','admin_desbloquear','admin_editar_loja','admin_config_salvar'];
  -- RPCs que o app da loja chama
  store_rpc text[] := array['pin_login','pin_logout','op_me','session_summary','cash_open','cash_move','cash_close','sale_get','sale_create',
    'sale_cancel','held_create','held_resume','stock_entry','stock_adjust','stock_loss','expiring_lots','top_sellers','product_save',
    'shortcuts_set','customer_save','customer_charge','customer_receive','customer_statement','settings_update','user_save',
    'app_status','report','self_login','pin_users','users_list','supplier_save','purchase_entry',
    'prices_update','product_usage','product_delete','product_restore','promo_save','promo_end','cash_book_days','cash_book_detail',
    'order_save','order_notify','order_ready','order_cancel','order_conclude','sale_delete','minha_loja','load_sample_products'];
  -- usadas dentro das políticas RLS / views (executadas como o usuário que consulta)
  policy_fns text[] := array['current_loja_id','loja_liberada','_local_date'];
  -- RPCs do painel (cada uma recusa quem não é super admin)
  admin_rpc text[] := array['admin_me','admin_lojas','admin_loja','admin_registrar_pagamento','admin_bloquear','admin_desbloquear',
    'admin_editar_loja','admin_config_salvar'];
  -- só a Edge Function "accounts" (service_role, no servidor)
  service_rpc text[] := array['account_signup_check','account_signup_loja','account_admin_create_loja','account_admin_check','account_admin_target',
    'account_check_admin','account_create','account_target'];
begin
  -- 1) ninguém de fora tem nada em nada (tabelas, views, sequências)
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','v','m','S','p','f') loop
    execute format('revoke all on %I from public, anon, authenticated', t);
  end loop;

  -- 2) tabelas de negócio: RLS por loja
  foreach t in array biz loop
    execute format('alter table %I enable row level security', t);
    for f in select polname from pg_policy where polrelid = t::regclass loop
      execute format('drop policy %I on %I', f.polname, t);
    end loop;
    if not t = any(secret) then
      execute format('grant select on %I to authenticated', t);
      execute format('create policy loja_leitura on %I for select to authenticated using (loja_id = (select current_loja_id()) and (select loja_liberada()))', t);
    end if;
    execute format('grant select, insert, update, delete on %I to app_definer', t);
    execute format('create policy loja_app on %I for all to app_definer using (loja_id = (select current_loja_id()) and (select loja_liberada())) with check (loja_id = (select current_loja_id()) and (select loja_liberada()))', t);
  end loop;

  -- 3) tabelas da plataforma: RLS ligado, sem política (nega tudo pela API)
  foreach t in array plat loop
    execute format('alter table %I enable row level security', t);
    for f in select polname from pg_policy where polrelid = t::regclass loop
      execute format('drop policy %I on %I', f.polname, t);
    end loop;
  end loop;

  -- 4) views de leitura (security_invoker: respeitam o RLS de quem consulta)
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' loop
    execute format('grant select on %I to authenticated, app_definer', t);
  end loop;

  -- 5) funções: dono, execute
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname = any(pg_owned) then
      execute format('alter function %s owner to postgres', f.sig);
    else
      execute format('alter function %s owner to app_definer', f.sig);
    end if;
    if not (f.proname = any(admin_rpc) or f.proname = any(service_rpc) or f.proname in ('_create_loja','_admin_from_token','_require_super_admin','_admin_loja_json','is_super_admin')) then
      execute format('grant execute on function %s to app_definer', f.sig);
    end if;
    if f.proname = any(store_rpc) or f.proname = any(policy_fns) or f.proname = any(admin_rpc) then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if f.proname = any(service_rpc) then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;

grant usage, select on all sequences in schema public to app_definer;
revoke create on schema public from app_definer;

-- tabelas/funções criadas no futuro NÃO ficam abertas por padrão para anon/authenticated
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;

-- PostgREST: recarrega o cache do esquema
notify pgrst, 'reload schema';
