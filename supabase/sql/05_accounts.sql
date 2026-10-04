-- ===================== Contas (CPF/CNPJ + usuário + senha) =====================
-- Login: documento da loja + usuário viram o e-mail interno <documento>.<usuario>@lojas.caixacerto.invalid no Supabase Auth
-- (ninguém recebe e-mail). O cadastro público do Supabase Auth fica DESLIGADO: contas só nascem pela Edge Function
-- "accounts" (service_role só no servidor), que chama as funções account_* abaixo (executáveis apenas por service_role).

create or replace function _check_username(p text) returns text language plpgsql immutable as $$
begin
  if p is null or p !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then
    perform _err('Usuário deve ter de 3 a 30 letras minúsculas, números, ponto, hífen ou _ (sem espaço e sem acento).', 'USUARIO_INVALIDO');
  end if;
  return p;
end $$;

-- categorias iniciais de uma loja nova (catálogo começa vazio)
create or replace function _seed_categories(p_loja uuid) returns void language sql security definer set search_path = public as $$
  insert into categories(loja_id, name, slug, color, icon) values
    (p_loja, 'Frutas','frutas','#E8A33D','🍎'), (p_loja, 'Verduras','verduras','#3F9A4E','🥬'), (p_loja, 'Legumes','legumes','#D4742C','🥕'),
    (p_loja, 'Temperos','temperos','#7FA83A','🌿'), (p_loja, 'Ovos','ovos','#C9A46A','🥚'), (p_loja, 'Grãos','graos','#9A7349','🫘'),
    (p_loja, 'Frios','frios','#5E8FB8','🧀'), (p_loja, 'Padaria','padaria','#B9854A','🥖'), (p_loja, 'Bebidas','bebidas','#3F8FA0','🥤'),
    (p_loja, 'Outros','outros','#8A8178','🧺')
  on conflict do nothing
$$;

-- confere documento e usuário antes de criar o login no Auth (não grava nada)
create or replace function account_signup_check(p_documento text, p_usuario text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d text := _doc_norm(p_documento); t text := _doc_tipo(p_documento);
begin
  if t is null then perform _err('CPF ou CNPJ inválido: confira os números.', 'DOC_INVALIDO'); end if;
  perform _check_username(p_usuario);
  if exists (select 1 from lojas where documento = d) then
    perform _err('Já existe uma loja com esse CPF/CNPJ. Entre com seu usuário ou fale com o suporte.', 'DOC_EXISTE');
  end if;
  return jsonb_build_object('documento', d, 'tipo_documento', t);
end $$;

-- cria a loja + configurações + categorias + o primeiro usuário (dono). p_data: nome, documento, responsavel, usuario, telefone, pin
create or replace function _create_loja(p_auth_uid uuid, p_data jsonb, p_status text, p_vencimento date, p_por uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare d text := _doc_norm(p_data->>'documento'); t text := _doc_tipo(p_data->>'documento'); v_loja uuid; v_uid int;
  v_nome text := trim(coalesce(p_data->>'nome', '')); v_resp text := trim(coalesce(p_data->>'responsavel', ''));
  v_user text := lower(trim(coalesce(p_data->>'usuario', ''))); v_pin text := nullif(p_data->>'pin', '');
  v_tel text := regexp_replace(coalesce(p_data->>'telefone', ''), '\D', '', 'g');
begin
  if t is null then perform _err('CPF ou CNPJ inválido: confira os números.', 'DOC_INVALIDO'); end if;
  if length(v_nome) < 2 or length(v_nome) > 80 then perform _err('Informe o nome da loja (2 a 80 letras).', 'DADOS'); end if;
  if length(v_resp) < 2 or length(v_resp) > 60 then perform _err('Informe o nome do responsável.', 'DADOS'); end if;
  perform _check_username(v_user);
  if v_pin is not null and v_pin !~ '^\d{4}$' then perform _err('O PIN precisa ter 4 dígitos.', 'PIN_INVALIDO'); end if;
  if v_tel <> '' and length(v_tel) not in (10, 11, 12, 13) then perform _err('WhatsApp inválido: use DDD + número.', 'TELEFONE'); end if;
  if exists (select 1 from lojas where documento = d) then
    perform _err('Já existe uma loja com esse CPF/CNPJ. Entre com seu usuário ou fale com o suporte.', 'DOC_EXISTE');
  end if;
  insert into lojas(nome, documento, tipo_documento, responsavel, telefone, status, vencimento)
  values (v_nome, d, t, v_resp, v_tel, p_status, p_vencimento) returning id into v_loja;
  -- CNPJ sai no cupom; CPF não (privacidade): o dono preenche em Configurações se quiser
  insert into store_settings(loja_id, name, cnpj, phone) values (v_loja, v_nome, case when t = 'CNPJ' then _doc_fmt(d) else '' end, v_tel);
  perform _seed_categories(v_loja);
  insert into users(loja_id, name, username, auth_uid, role, active) values (v_loja, v_resp, v_user, p_auth_uid, 'admin', true) returning id into v_uid;
  if v_pin is not null then insert into user_pins(loja_id, user_id, pin_hash) values (v_loja, v_uid, _hash_pin(v_pin)); end if;
  insert into loja_usuarios(user_id, loja_id, usuario, nome, papel) values (p_auth_uid, v_loja, v_user, v_resp, 'dono');
  insert into audit_log(loja_id, user_id, action, entity, entity_id, details)
  values (v_loja, v_uid, 'LOJA_CRIADA', 'loja', null, jsonb_build_object('usuario', v_user, 'status', p_status, 'vencimento', p_vencimento));
  insert into loja_eventos(loja_id, tipo, detalhes, por) values (v_loja, 'CRIADA', jsonb_build_object('status', p_status, 'vencimento', p_vencimento,
    'origem', case when p_por is null then 'cadastro' else 'painel' end), p_por);
  return jsonb_build_object('loja_id', v_loja, 'nome', v_nome, 'documento', d, 'tipo_documento', t, 'status', p_status, 'vencimento', p_vencimento,
    'user', jsonb_build_object('id', v_uid, 'username', v_user, 'role', 'admin'));
end $$;

-- "Criar conta da loja" (auto cadastro): status teste, vence em hoje + dias_teste
create or replace function account_signup_loja(p_auth_uid uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  return _create_loja(p_auth_uid, p_data, 'teste', _today() + (select dias_teste from plataforma_config where id = 1), null);
end $$;

-- painel: super admin cria loja manualmente (status e vencimento escolhidos)
create or replace function account_admin_create_loja(p_caller uuid, p_auth_uid uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_status text := coalesce(nullif(p_data->>'status', ''), 'ativa'); v_venc date; r jsonb;
begin
  if not exists (select 1 from super_admins where user_id = p_caller) then perform _err('Acesso negado.', 'PROIBIDO'); end if;
  if v_status not in ('teste','ativa','bloqueada') then perform _err('Situação inválida.', 'DADOS'); end if;
  v_venc := coalesce(nullif(p_data->>'vencimento', '')::date, _today() + 30);
  r := _create_loja(p_auth_uid, p_data, v_status, v_venc, p_caller);
  update lojas set plano = coalesce(nullif(trim(p_data->>'plano'), ''), plano),
    valor_mensal_cents = greatest(0, coalesce(nullif(p_data->>'valor_mensal_cents', '')::int, valor_mensal_cents)),
    observacao = coalesce(p_data->>'observacao', observacao) where id = (r->>'loja_id')::uuid;
  return r;
end $$;

create or replace function account_admin_check(p_caller uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from super_admins where user_id = p_caller)
$$;

-- Confere que quem chama é admin (dono) da loja: token do PIN aberto pelo mesmo login, loja liberada
create or replace function _admin_from_token(p_token text, p_caller uuid) returns users
language plpgsql stable security definer set search_path = public as $$
declare u users; v_loja uuid;
begin
  select loja_id into v_loja from loja_usuarios where user_id = p_caller and ativo;
  if v_loja is null then perform _err('Login não autorizado.', 'SEM_LOGIN'); end if;
  if not _loja_liberada(v_loja) then perform _err('Acesso bloqueado: assinatura vencida ou suspensa.', 'LOJA_BLOQUEADA'); end if;
  select u2.* into u from op_sessions s join users u2 on u2.id = s.user_id and u2.loja_id = s.loja_id
   where s.token = p_token and s.auth_uid = p_caller and s.loja_id = v_loja and u2.active and s.created_at > now() - interval '30 days';
  if u.id is null then perform _err('Entre de novo no caixa.', 'SEM_PIN'); end if;
  if u.role <> 'admin' then perform _err('Só o dono (admin) cria usuários e troca senhas.', 'PROIBIDO'); end if;
  return u;
end $$;

-- A Edge Function confere se quem chama é admin ANTES de criar o login no Auth (e pega o documento p/ o e-mail interno)
create or replace function account_check_admin(p_token text, p_caller uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a users;
begin
  a := _admin_from_token(p_token, p_caller);
  return jsonb_build_object('id', a.id, 'name', a.name, 'loja_id', a.loja_id, 'documento', (select documento from lojas where id = a.loja_id));
end $$;

-- Admin da loja cria funcionário (gerente/operador/admin) com usuário+senha (+ PIN opcional) — sempre na PRÓPRIA loja
create or replace function account_create(p_token text, p_caller uuid, p_auth_uid uuid, p_name text, p_username text, p_role text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a users; v_id int;
begin
  a := _admin_from_token(p_token, p_caller);
  if trim(coalesce(p_name, '')) = '' then perform _err('Informe o nome.'); end if;
  perform _check_username(p_username);
  if p_role not in ('admin','gerente','operador') then perform _err('Papel inválido.'); end if;
  if p_pin is not null and p_pin <> '' and p_pin !~ '^\d{4}$' then perform _err('O PIN precisa ter 4 dígitos.', 'PIN_INVALIDO'); end if;
  if exists (select 1 from users where loja_id = a.loja_id and username = p_username) then perform _err('Esse usuário já existe.', 'USUARIO_EXISTE'); end if;
  insert into users(loja_id, name, username, auth_uid, role, active) values (a.loja_id, trim(p_name), p_username, p_auth_uid, p_role, true) returning id into v_id;
  if p_pin is not null and p_pin <> '' then insert into user_pins(loja_id, user_id, pin_hash) values (a.loja_id, v_id, _hash_pin(p_pin)); end if;
  insert into loja_usuarios(user_id, loja_id, usuario, nome, papel)
  values (p_auth_uid, a.loja_id, p_username, trim(p_name), case p_role when 'admin' then 'dono' else p_role end);
  insert into audit_log(loja_id, user_id, action, entity, entity_id, details) values (a.loja_id, a.id, 'USUARIO_CRIADO', 'user', v_id,
    jsonb_build_object('name', p_name, 'username', p_username, 'role', p_role, 'pin', p_pin is not null and p_pin <> ''));
  return jsonb_build_object('id', v_id, 'username', p_username, 'role', p_role);
end $$;

-- Admin troca a senha de alguém DA PRÓPRIA LOJA: devolve o auth uid do alvo (a Edge Function faz a troca no Auth)
create or replace function account_target(p_token text, p_caller uuid, p_user_id int) returns uuid
language plpgsql security definer set search_path = public as $$
declare a users; v uuid;
begin
  a := _admin_from_token(p_token, p_caller);
  select auth_uid into v from users where id = p_user_id and loja_id = a.loja_id;
  if v is null then perform _err('Usuário sem login.', 'NAO_ENCONTRADO'); end if;
  insert into audit_log(loja_id, user_id, action, entity, entity_id) values (a.loja_id, a.id, 'SENHA_REDEFINIDA', 'user', p_user_id);
  return v;
end $$;

-- marca o último acesso da loja (no máximo 1 vez a cada 5 min)
create or replace function _touch_loja() returns void language sql security definer set search_path = public as $$
  update lojas set ultimo_acesso = now() where id = current_loja_id() and (ultimo_acesso is null or ultimo_acesso < now() - interval '5 minutes')
$$;

-- Situação da loja de quem está logado (o app mostra a tela "Acesso bloqueado" e a faixa de vencimento)
create or replace function minha_loja() returns jsonb
language plpgsql security definer set search_path = public as $$
declare l lojas; c plataforma_config; lu loja_usuarios; v_lim date;
begin
  select * into lu from loja_usuarios where user_id = auth.uid();
  if lu.user_id is null then perform _err('Este login não é de nenhuma loja.', 'SEM_LOJA'); end if;
  if not lu.ativo then perform _err('Seu usuário está inativo. Fale com o dono da loja.', 'SEM_LOGIN'); end if;
  select * into l from lojas where id = lu.loja_id;
  select * into c from plataforma_config where id = 1;
  v_lim := l.vencimento + case when l.status = 'ativa' then c.carencia_dias else 0 end;
  perform _touch_loja();
  return jsonb_build_object('id', l.id, 'nome', l.nome, 'documento', l.documento, 'tipo_documento', l.tipo_documento,
    'status', l.status, 'vencimento', l.vencimento, 'dias_restantes', l.vencimento - _today(),
    'liberada', _loja_liberada(l.id), 'em_carencia', l.status = 'ativa' and _today() > l.vencimento and _today() <= v_lim,
    'bloqueio_em', v_lim + 1, 'aviso_dias', c.aviso_dias, 'plano', l.plano, 'valor_mensal_cents', l.valor_mensal_cents,
    'motivo_bloqueio', case when l.status = 'bloqueada' then l.motivo_bloqueio end,
    'usuario', lu.usuario, 'papel', lu.papel);
end $$;

-- Depois do login com usuário+senha: abre a sessão do caixa para a própria pessoa (sem PIN)
create or replace function self_login(p_terminal text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; v_token text;
begin
  perform _require_store();
  select * into u from users where auth_uid = _uid() and active;
  if u.id is null then perform _err('Seu usuário está inativo ou não existe. Fale com o administrador.', 'SEM_LOGIN'); end if;
  -- só logo depois de digitar a senha (amr = momento do login). Assim quem trocou de operador por PIN
  -- não consegue "voltar" para o dono do login sem saber a senha.
  if coalesce((select max((a->>'timestamp')::bigint) from jsonb_array_elements(coalesce(_jwt()->'amr', '[]'::jsonb)) a
               where a->>'method' = 'password'), 0) < extract(epoch from now())::bigint - 600 then
    perform _err('Digite a senha de novo para entrar.', 'SENHA_DE_NOVO');
  end if;
  v_token := _hex_token(24);
  insert into op_sessions(token, user_id, auth_uid, terminal) values (v_token, u.id, _uid(), p_terminal);
  perform _touch_loja();
  perform _audit(u.id, 'LOGIN', 'user', u.id, jsonb_build_object('terminal', p_terminal, 'via', 'senha'));
  return jsonb_build_object('token', v_token, 'user', jsonb_build_object('id', u.id, 'name', u.name, 'role', u.role, 'username', u.username));
end $$;

-- Quem pode trocar de operador por PIN neste aparelho (só quem tem PIN)
create or replace function pin_users() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_store();
  return coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'role', u.role, 'username', u.username) order by u.id)
    from users u where u.active and exists (select 1 from user_pins p where p.user_id = u.id)), '[]'::jsonb);
end $$;

-- Lista de usuários para a tela do admin (com "tem PIN" e "tem login")
create or replace function users_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_store();
  return coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'role', u.role, 'username', u.username, 'active', u.active,
      'created_at', u.created_at, 'has_pin', exists (select 1 from user_pins p where p.user_id = u.id), 'has_login', u.auth_uid is not null) order by u.id)
    from users u), '[]'::jsonb);
end $$;

-- nome/papel/ativo/PIN; criar usuário só pela Edge Function (precisa de login)
create or replace function user_save(p_token text, p_id int, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; v_id int; v_pin text := nullif(p_data->>'pin', ''); v_role text := p_data->>'role'; v_active boolean := coalesce((p_data->>'active')::boolean, true);
begin
  u := _op(p_token);
  perform _require_role(u, array['admin']);
  if p_id is null then perform _err('Crie usuários em Configurações › Usuários (usuário + senha).'); end if;
  if trim(coalesce(p_data->>'name', '')) = '' then perform _err('Nome é obrigatório.'); end if;
  if v_role not in ('admin','gerente','operador') then perform _err('Papel inválido.'); end if;
  if v_pin is not null and v_pin !~ '^\d{4}$' then perform _err('PIN deve ter 4 dígitos.'); end if;
  if p_id = u.id and (not v_active or v_role <> 'admin') then perform _err('Você não pode tirar o próprio acesso de admin.'); end if;
  update users set name = trim(p_data->>'name'), role = v_role, active = v_active where id = p_id returning id into v_id;
  if v_id is null then perform _err('Usuário não encontrado.', 'NAO_ENCONTRADO'); end if;
  if not v_active then delete from op_sessions where user_id = v_id; end if;
  if v_pin is not null then
    insert into user_pins(user_id, pin_hash) values (v_id, _hash_pin(v_pin))
    on conflict (user_id) do update set pin_hash = excluded.pin_hash;
  end if;
  perform _audit(u.id, 'USUARIO_ALTERADO', 'user', v_id, jsonb_build_object('name', p_data->>'name', 'role', v_role, 'active', v_active, 'pin_changed', v_pin is not null));
  return jsonb_build_object('id', v_id);
end $$;

-- ---------- fornecedores e compras ----------
create or replace function supplier_save(p_token text, p_id int, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; v_id int;
begin
  u := _op(p_token);
  perform _require_role(u, array['admin','gerente']);
  if trim(coalesce(p_data->>'name', '')) = '' then perform _err('Nome do fornecedor é obrigatório.'); end if;
  if p_id is null then
    insert into suppliers(name, phone, doc, note, active) values (trim(p_data->>'name'), coalesce(p_data->>'phone', ''), coalesce(p_data->>'doc', ''),
      coalesce(p_data->>'note', ''), coalesce((p_data->>'active')::boolean, true)) returning id into v_id;
  else
    update suppliers set name = trim(p_data->>'name'), phone = coalesce(p_data->>'phone', phone), doc = coalesce(p_data->>'doc', doc),
      note = coalesce(p_data->>'note', note), active = coalesce((p_data->>'active')::boolean, active) where id = p_id returning id into v_id;
    if v_id is null then perform _err('Fornecedor não encontrado.', 'NAO_ENCONTRADO'); end if;
  end if;
  perform _audit(u.id, case when p_id is null then 'FORNECEDOR_CRIADO' else 'FORNECEDOR_ALTERADO' end, 'supplier', v_id, p_data);
  return (select to_jsonb(s) from suppliers s where id = v_id);
end $$;

-- Entrada de compra com vários itens de um fornecedor (tudo ou nada)
create or replace function purchase_entry(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; it jsonb; p products; v_pid int; v_sup int := nullif(p_data->>'supplier_id', '')::int; v_qty int; v_cost int;
  v_lot int; v_exp date; v_code text; v_total int := 0; v_n int := 0; v_bal int; v_supname text;
begin
  u := _op(p_token);
  perform _require_role(u, array['admin','gerente']);
  if jsonb_typeof(p_data->'items') <> 'array' or jsonb_array_length(p_data->'items') = 0 then perform _err('Inclua pelo menos um item na compra.'); end if;
  if v_sup is not null then
    select name into v_supname from suppliers where id = v_sup and active;
    if v_supname is null then perform _err('Fornecedor não encontrado ou inativo.', 'NAO_ENCONTRADO'); end if;
  end if;
  insert into purchases(supplier_id, user_id, note) values (v_sup, u.id, nullif(p_data->>'note', '')) returning id into v_pid;
  for it in select * from jsonb_array_elements(p_data->'items') loop
    select * into p from products where id = (it->>'product_id')::int;
    if p.id is null then perform _err('Produto não encontrado.', 'NAO_ENCONTRADO'); end if;
    v_qty := (it->>'qty')::int;
    if v_qty is null or v_qty <= 0 then perform _err('Quantidade inválida em ' || p.name || '.'); end if;
    v_cost := nullif(it->>'unit_cost_cents', '')::int;
    if v_cost is not null and v_cost < 0 then perform _err('Custo inválido em ' || p.name || '.'); end if;
    v_exp := nullif(it->>'expiry_date', '')::date; v_code := nullif(it->>'lot_code', ''); v_lot := null;
    if v_code is not null or v_exp is not null then
      insert into lots(product_id, lot_code, expiry_date, qty_initial, qty_left) values (p.id, v_code, v_exp, v_qty, v_qty) returning id into v_lot;
    end if;
    if v_cost is not null then update products set cost_cents = v_cost, updated_at = now() where id = p.id; end if;
    v_bal := _apply_stock(p.id, v_qty, 'ENTRADA', u.id, coalesce(v_cost, p.cost_cents), 'compra', v_pid, v_lot,
      'Compra nº ' || v_pid || coalesce(' — ' || v_supname, ''), false);
    update stock_movements set supplier_id = v_sup where id = (select max(id) from stock_movements where product_id = p.id);
    v_total := v_total + round(coalesce(v_cost, p.cost_cents)::numeric * v_qty / 1000.0)::int; v_n := v_n + 1;
  end loop;
  update purchases set total_cents = v_total, items_count = v_n where id = v_pid;
  perform _audit(u.id, 'COMPRA_ENTRADA', 'purchase', v_pid, jsonb_build_object('supplier', v_supname, 'items', v_n, 'total', v_total));
  return jsonb_build_object('id', v_pid, 'total_cents', v_total, 'items_count', v_n);
end $$;

-- Preço do dia: altera vários preços de uma vez (gerente/admin), com auditoria de antes/depois
create or replace function prices_update(p_token text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; it jsonb; v_old int; v_new int; v_n int := 0; v_log jsonb := '[]'::jsonb; v_name text;
begin
  u := _op(p_token);
  perform _require_role(u, array['admin','gerente']);
  if jsonb_typeof(p_items) <> 'array' then perform _err('Lista de preços inválida.'); end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_new := (it->>'price_cents')::int;
    if v_new is null or v_new < 0 then perform _err('Preço inválido.'); end if;
    select price_cents, name into v_old, v_name from products where id = (it->>'id')::int for update;
    if v_old is null then perform _err('Produto não encontrado.', 'NAO_ENCONTRADO'); end if;
    if v_old <> v_new then
      update products set price_cents = v_new, updated_at = now() where id = (it->>'id')::int;
      v_n := v_n + 1; v_log := v_log || jsonb_build_object('produto', v_name, 'de', v_old, 'para', v_new);
    end if;
  end loop;
  if v_n > 0 then perform _audit(u.id, 'PRECOS_DO_DIA', 'products', null, jsonb_build_object('alterados', v_n, 'itens', v_log)); end if;
  return jsonb_build_object('changed', v_n);
end $$;

create or replace view v_purchases with (security_invoker = true) as
  select pu.*, _local_date(pu.created_at) as local_date, s.name as supplier_name, u.name as user_name
    from purchases pu left join suppliers s on s.id = pu.supplier_id join users u on u.id = pu.user_id;


-- painel: super admin redefine a senha de um usuário de uma loja (ex.: dono esqueceu). Fica registrado em loja_eventos.
create or replace function account_admin_target(p_caller uuid, p_loja uuid, p_usuario text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not exists (select 1 from super_admins where user_id = p_caller) then perform _err('Acesso negado.', 'PROIBIDO'); end if;
  select user_id into v from loja_usuarios where loja_id = p_loja and usuario = lower(trim(p_usuario));
  if v is null then perform _err('Usuário não encontrado nessa loja.', 'NAO_ENCONTRADO'); end if;
  insert into loja_eventos(loja_id, tipo, motivo, por) values (p_loja, 'SENHA_REDEFINIDA', 'usuário ' || lower(trim(p_usuario)), p_caller);
  return v;
end $$;
