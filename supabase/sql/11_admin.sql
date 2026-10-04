-- ===================== Painel do administrador da plataforma (super admin) =====================
-- Todas as funções: SECURITY DEFINER (dono postgres) e começam com _require_super_admin().
-- Usuário de loja que chamar recebe erro PROIBIDO. Nada daqui lê dados de venda além de contagem/total por loja.

create or replace function _require_super_admin() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not is_super_admin() then perform _err('Acesso negado.', 'PROIBIDO'); end if;
end $$;

create or replace function admin_me() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_super_admin();
  return (select jsonb_build_object('usuario', usuario, 'config', (select to_jsonb(c) from plataforma_config c where id = 1))
            from super_admins where user_id = auth.uid());
end $$;

create or replace function _admin_loja_json(l lojas) returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(l) - 'gateway' - 'gateway_cliente_id' || jsonb_build_object(
    'dias_restantes', l.vencimento - _today(),
    'liberada', _loja_liberada(l.id),
    'situacao', case when l.status = 'bloqueada' then 'bloqueada'
                     when not _loja_liberada(l.id) then 'vencida'
                     when _today() > l.vencimento then 'carencia'
                     else l.status end,
    'vendas_total', (select count(*) from sales s where s.loja_id = l.id and s.status = 'FINALIZADA')::int,
    'vendas_mes', (select count(*) from sales s where s.loja_id = l.id and s.status = 'FINALIZADA'
                     and _local_date(s.created_at) >= date_trunc('month', _today())::date)::int,
    'total_mes_cents', (select coalesce(sum(total_cents), 0) from sales s where s.loja_id = l.id and s.status = 'FINALIZADA'
                     and _local_date(s.created_at) >= date_trunc('month', _today())::date)::bigint,
    'usuarios', (select count(*) from loja_usuarios u where u.loja_id = l.id)::int,
    'dono_usuario', (select usuario from loja_usuarios u where u.loja_id = l.id and u.papel = 'dono' order by criado_em limit 1),
    'ultimo_pagamento', (select jsonb_build_object('pago_em', p.pago_em, 'valor_cents', p.valor_cents) from pagamentos p where p.loja_id = l.id order by p.id desc limit 1))
$$;

-- lista de lojas (para a tabela do painel)
create or replace function admin_lojas() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_super_admin();
  return coalesce((select jsonb_agg(_admin_loja_json(l) order by l.criado_em desc) from lojas l), '[]'::jsonb);
end $$;

create or replace function admin_loja(p_loja uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l lojas;
begin
  perform _require_super_admin();
  select * into l from lojas where id = p_loja;
  if l.id is null then perform _err('Loja não encontrada.', 'NAO_ENCONTRADO'); end if;
  return _admin_loja_json(l) || jsonb_build_object(
    'pagamentos', coalesce((select jsonb_agg(to_jsonb(p) order by p.id desc) from pagamentos p where p.loja_id = l.id), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (select * from loja_eventos where loja_id = l.id order by id desc limit 100) e), '[]'::jsonb),
    'equipe', coalesce((select jsonb_agg(jsonb_build_object('usuario', u.usuario, 'nome', u.nome, 'papel', u.papel, 'ativo', u.ativo) order by u.criado_em)
                         from loja_usuarios u where u.loja_id = l.id), '[]'::jsonb));
end $$;

-- registrar pagamento (PIX manual): +30 dias a partir do vencimento (ou de hoje, se já venceu) ou data escolhida
-- p_data: { valor_cents, pago_em (date, padrão hoje), novo_vencimento (date, opcional), dias (padrão 30), metodo, observacao }
create or replace function admin_registrar_pagamento(p_loja uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l lojas; v_valor int := nullif(p_data->>'valor_cents', '')::int; v_pago date; v_novo date; v_dias int := coalesce(nullif(p_data->>'dias', '')::int, 30);
  v_id bigint;
begin
  perform _require_super_admin();
  select * into l from lojas where id = p_loja for update;
  if l.id is null then perform _err('Loja não encontrada.', 'NAO_ENCONTRADO'); end if;
  if v_valor is null or v_valor < 0 then perform _err('Informe o valor pago.', 'DADOS'); end if;
  if v_dias < 1 or v_dias > 400 then perform _err('Dias inválidos.', 'DADOS'); end if;
  begin
    v_pago := coalesce(nullif(p_data->>'pago_em', '')::date, _today());
    v_novo := nullif(p_data->>'novo_vencimento', '')::date;
  exception when others then perform _err('Data inválida.', 'DADOS'); end;
  v_novo := coalesce(v_novo, greatest(l.vencimento, _today()) + v_dias);
  if v_novo < _today() then perform _err('O novo vencimento precisa ser hoje ou depois.', 'DADOS'); end if;
  insert into pagamentos(loja_id, valor_cents, pago_em, metodo, vencimento_anterior, vencimento_novo, observacao, registrado_por)
  values (l.id, v_valor, v_pago, coalesce(nullif(p_data->>'metodo', ''), 'pix'), l.vencimento, v_novo, coalesce(p_data->>'observacao', ''), auth.uid())
  returning id into v_id;
  update lojas set vencimento = v_novo, status = 'ativa', motivo_bloqueio = null where id = l.id;
  insert into loja_eventos(loja_id, tipo, motivo, detalhes, por) values (l.id, 'PAGAMENTO', nullif(p_data->>'observacao', ''),
    jsonb_build_object('pagamento_id', v_id, 'valor_cents', v_valor, 'pago_em', v_pago, 'vencimento_anterior', l.vencimento, 'vencimento_novo', v_novo,
      'status_anterior', l.status), auth.uid());
  return admin_loja(l.id);
end $$;

create or replace function admin_bloquear(p_loja uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l lojas; v_m text := trim(coalesce(p_motivo, ''));
begin
  perform _require_super_admin();
  if length(v_m) < 3 then perform _err('Escreva o motivo do bloqueio.', 'DADOS'); end if;
  select * into l from lojas where id = p_loja for update;
  if l.id is null then perform _err('Loja não encontrada.', 'NAO_ENCONTRADO'); end if;
  update lojas set status = 'bloqueada', motivo_bloqueio = v_m where id = l.id;
  insert into loja_eventos(loja_id, tipo, motivo, detalhes, por) values (l.id, 'BLOQUEADA', v_m, jsonb_build_object('status_anterior', l.status), auth.uid());
  return admin_loja(l.id);
end $$;

-- desbloquear: volta para 'ativa' (ou 'teste'); se o vencimento já passou, informe novo_vencimento (ou registre pagamento)
create or replace function admin_desbloquear(p_loja uuid, p_motivo text, p_status text default 'ativa', p_novo_vencimento date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l lojas; v_m text := trim(coalesce(p_motivo, ''));
begin
  perform _require_super_admin();
  if length(v_m) < 3 then perform _err('Escreva o motivo do desbloqueio.', 'DADOS'); end if;
  if p_status not in ('ativa','teste') then perform _err('Situação inválida.', 'DADOS'); end if;
  select * into l from lojas where id = p_loja for update;
  if l.id is null then perform _err('Loja não encontrada.', 'NAO_ENCONTRADO'); end if;
  if p_novo_vencimento is not null and p_novo_vencimento < _today() then perform _err('O novo vencimento precisa ser hoje ou depois.', 'DADOS'); end if;
  update lojas set status = p_status, motivo_bloqueio = null, vencimento = coalesce(p_novo_vencimento, vencimento) where id = l.id;
  insert into loja_eventos(loja_id, tipo, motivo, detalhes, por) values (l.id, 'DESBLOQUEADA', v_m,
    jsonb_build_object('status_anterior', l.status, 'status_novo', p_status, 'vencimento_anterior', l.vencimento, 'vencimento_novo', coalesce(p_novo_vencimento, l.vencimento)), auth.uid());
  return admin_loja(l.id);
end $$;

-- editar dados comerciais: nome, telefone, plano, valor_mensal_cents, vencimento, observacao, responsavel
create or replace function admin_editar_loja(p_loja uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l lojas; v_venc date;
begin
  perform _require_super_admin();
  select * into l from lojas where id = p_loja for update;
  if l.id is null then perform _err('Loja não encontrada.', 'NAO_ENCONTRADO'); end if;
  begin v_venc := nullif(p_data->>'vencimento', '')::date; exception when others then perform _err('Data inválida.', 'DADOS'); end;
  if p_data ? 'nome' and length(trim(coalesce(p_data->>'nome', ''))) < 2 then perform _err('Nome da loja muito curto.', 'DADOS'); end if;
  if p_data ? 'valor_mensal_cents' and coalesce(nullif(p_data->>'valor_mensal_cents', '')::int, -1) < 0 then perform _err('Valor mensal inválido.', 'DADOS'); end if;
  update lojas set
    nome = coalesce(nullif(trim(p_data->>'nome'), ''), nome),
    responsavel = coalesce(nullif(trim(p_data->>'responsavel'), ''), responsavel),
    telefone = coalesce(regexp_replace(p_data->>'telefone', '\D', '', 'g'), telefone),
    plano = coalesce(nullif(trim(p_data->>'plano'), ''), plano),
    valor_mensal_cents = coalesce(nullif(p_data->>'valor_mensal_cents', '')::int, valor_mensal_cents),
    vencimento = coalesce(v_venc, vencimento),
    observacao = coalesce(p_data->>'observacao', observacao)
   where id = l.id;
  insert into loja_eventos(loja_id, tipo, detalhes, por) values (l.id, 'EDITADA', p_data, auth.uid());
  return admin_loja(l.id);
end $$;

create or replace function admin_config_salvar(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _require_super_admin();
  update plataforma_config set
    carencia_dias = coalesce(nullif(p_data->>'carencia_dias', '')::int, carencia_dias),
    dias_teste = coalesce(nullif(p_data->>'dias_teste', '')::int, dias_teste),
    aviso_dias = coalesce(nullif(p_data->>'aviso_dias', '')::int, aviso_dias),
    atualizado_em = now() where id = 1;
  return (select to_jsonb(c) from plataforma_config c where id = 1);
end $$;
