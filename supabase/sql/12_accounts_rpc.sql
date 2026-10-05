-- ===================== Contas sem Edge Function =====================
-- Criar/alterar logins direto no banco (auth.users + auth.identities), em UMA transação com a loja.
-- Assim não é preciso service_role em lugar nenhum: o navegador só tem a chave anon, e cada função confere quem chama.
-- O hash da senha é bcrypt (o mesmo formato que o Supabase Auth usa); o login continua sendo pelo Supabase Auth.

-- e-mails internos (ninguém recebe). NÃO mude depois que houver lojas (os logins usam esses domínios).
create or replace function _store_email(p_doc text, p_user text) returns text language sql immutable as $$
  select lower(p_doc) || '.' || lower(p_user) || '@lojas.caixacerto.invalid'
$$;

create or replace function _check_password(p text) returns void language plpgsql immutable as $$
begin
  if p is null or length(p) < 8 or length(p) > 72 then perform _err('A senha precisa ter pelo menos 8 caracteres.', 'DADOS'); end if;
end $$;

-- cria o login (já confirmado). Um cadastro "solto" com o mesmo e-mail, sem confirmação e sem loja/admin (ex.: alguém
-- chamou o /signup público do Auth para "reservar" o nome) é apagado antes, para não bloquear a loja de verdade.
create or replace function _auth_create_user(p_email text, p_password text, p_meta jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare v uuid := gen_random_uuid(); old auth.users;
begin
  perform _check_password(p_password);
  select * into old from auth.users where email = lower(p_email);
  if old.id is not null then
    if old.email_confirmed_at is null and not exists (select 1 from public.loja_usuarios where user_id = old.id)
       and not exists (select 1 from public.super_admins where user_id = old.id) then
      delete from auth.users where id = old.id;
    else
      perform _err('Esse usuário já existe.', 'USUARIO_EXISTE');
    end if;
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated', lower(p_email), crypt(p_password, gen_salt('bf', 10)), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, coalesce(p_meta, '{}'::jsonb), now(), now(), '', '', '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v, v::text, jsonb_build_object('sub', v::text, 'email', lower(p_email), 'email_verified', true), 'email', now(), now(), now());
  return v;
end $$;

create or replace function _auth_set_password(p_uid uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  perform _check_password(p_password);
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf', 10)), updated_at = now() where id = p_uid;
  if not found then perform _err('Login não encontrado.', 'NAO_ENCONTRADO'); end if;
  -- derruba as sessões abertas desse login (quem tinha a senha antiga precisa entrar de novo)
  delete from auth.sessions where user_id = p_uid;
end $$;

-- campos comuns: responsável/nome, usuário, senha, PIN
create or replace function _check_person(p_name text, p_user text, p_password text, p_pin text) returns void language plpgsql immutable as $$
begin
  if trim(coalesce(p_name, '')) = '' or length(trim(p_name)) > 60 then perform _err('Informe o nome (até 60 letras).', 'DADOS'); end if;
  perform _check_username(p_user);
  perform _check_password(p_password);
  if coalesce(p_pin, '') <> '' and p_pin !~ '^\d{4}$' then perform _err('O PIN precisa ter 4 dígitos.', 'DADOS'); end if;
end $$;

-- "Criar conta da loja" (público, chamado com a chave anon): loja em TESTE + login do DONO.
-- p_data: loja_nome, documento, responsavel, usuario, senha, whatsapp, pin
create or replace function account_signup(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_nome text := trim(coalesce(p_data->>'loja_nome', '')); v_user text := lower(trim(coalesce(p_data->>'usuario', '')));
  chk jsonb; v_uid uuid; v_doc text;
begin
  -- freio contra cadastro em massa (vale para todo mundo)
  if (select count(*) from lojas where criado_em > now() - interval '1 hour') >= 30 then
    perform _err('Muitos cadastros agora. Tente de novo em alguns minutos.', 'LIMITE');
  end if;
  perform _check_person(p_data->>'responsavel', v_user, p_data->>'senha', p_data->>'pin');
  if length(v_nome) < 2 or length(v_nome) > 80 then perform _err('Informe o nome da loja.', 'DADOS'); end if;
  chk := account_signup_check(p_data->>'documento', v_user);
  v_doc := chk->>'documento';
  v_uid := _auth_create_user(_store_email(v_doc, v_user), p_data->>'senha',
             jsonb_build_object('username', v_user, 'name', trim(p_data->>'responsavel'), 'documento', v_doc));
  return jsonb_build_object('ok', true, 'loja', account_signup_loja(v_uid, jsonb_build_object('nome', v_nome, 'documento', v_doc,
    'responsavel', trim(p_data->>'responsavel'), 'usuario', v_user, 'telefone', regexp_replace(coalesce(p_data->>'whatsapp', ''), '\D', '', 'g'),
    'pin', nullif(p_data->>'pin', ''))));
end $$;

-- painel: super admin cria loja manualmente. p_data: como no cadastro + status, vencimento, plano, valor_mensal_cents, observacao
create or replace function account_admin_new_loja(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_nome text := trim(coalesce(p_data->>'loja_nome', '')); v_user text := lower(trim(coalesce(p_data->>'usuario', '')));
  chk jsonb; v_uid uuid; v_doc text;
begin
  if not account_admin_check(_uid()) then perform _err('Acesso negado.', 'PROIBIDO'); end if;
  perform _check_person(p_data->>'responsavel', v_user, p_data->>'senha', p_data->>'pin');
  if length(v_nome) < 2 or length(v_nome) > 80 then perform _err('Informe o nome da loja.', 'DADOS'); end if;
  chk := account_signup_check(p_data->>'documento', v_user);
  v_doc := chk->>'documento';
  v_uid := _auth_create_user(_store_email(v_doc, v_user), p_data->>'senha',
             jsonb_build_object('username', v_user, 'name', trim(p_data->>'responsavel'), 'documento', v_doc));
  return jsonb_build_object('ok', true, 'loja', account_admin_create_loja(_uid(), v_uid, jsonb_build_object('nome', v_nome, 'documento', v_doc,
    'responsavel', trim(p_data->>'responsavel'), 'usuario', v_user, 'telefone', regexp_replace(coalesce(p_data->>'whatsapp', ''), '\D', '', 'g'),
    'pin', nullif(p_data->>'pin', ''), 'status', p_data->>'status', 'vencimento', p_data->>'vencimento', 'plano', p_data->>'plano',
    'valor_mensal_cents', p_data->'valor_mensal_cents', 'observacao', p_data->>'observacao')));
end $$;

-- painel: nova senha para um usuário de uma loja (fica em loja_eventos)
create or replace function account_admin_password(p_loja uuid, p_usuario text, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _check_password(p_password);
  perform _auth_set_password(account_admin_target(_uid(), p_loja, p_usuario), p_password);
  return jsonb_build_object('ok', true);
end $$;

-- dono da loja cria funcionário (sempre na PRÓPRIA loja; token do caixa aberto pelo mesmo login)
-- p_data: name, username, password, role, pin
create or replace function account_user_create(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare who jsonb; v_user text := lower(trim(coalesce(p_data->>'username', ''))); v_uid uuid; v_role text := coalesce(p_data->>'role', 'operador');
begin
  who := account_check_admin(p_token, _uid());
  perform _check_person(p_data->>'name', v_user, p_data->>'password', p_data->>'pin');
  if v_role not in ('admin','gerente','operador') then perform _err('Papel inválido.', 'DADOS'); end if;
  v_uid := _auth_create_user(_store_email(who->>'documento', v_user), p_data->>'password',
             jsonb_build_object('username', v_user, 'name', trim(p_data->>'name'), 'documento', who->>'documento'));
  return jsonb_build_object('ok', true, 'user', account_create(p_token, _uid(), v_uid, p_data->>'name', v_user, v_role, nullif(p_data->>'pin', '')));
end $$;

-- dono troca a senha de alguém DA PRÓPRIA LOJA
create or replace function account_user_password(p_token text, p_user_id int, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _check_password(p_password);
  perform _auth_set_password(account_target(p_token, _uid(), p_user_id), p_password);
  return jsonb_build_object('ok', true);
end $$;
