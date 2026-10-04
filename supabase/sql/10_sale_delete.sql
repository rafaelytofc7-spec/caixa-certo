-- v3.4: APAGAR VENDA (só administrador). Diferente de "Cancelar" (devolução no dia, gerente):
--  - qualquer dia, inclusive venda importada do sistema antigo e venda de encomenda;
--  - exclusão lógica: status EXCLUIDA + quem/quando/motivo; a venda some dos totais (tudo filtra FINALIZADA) e fica no histórico de auditoria;
--  - estorna o que a venda fez: estoque volta (movimento EXCLUSAO "Estorno por exclusão"), caixa e fiado.
--    Caixa ABERTO: lança ESTORNO no próprio caixa da venda (o esperado diminui).
--    Caixa FECHADO: lança ESTORNO no caixa da venda só como registro; o que foi conferido no fechamento não muda.
--    Venda já CANCELADA: o cancelamento já estornou tudo; só some da lista.
--  - venda de encomenda: a encomenda volta para "Pronta" e "a pagar" (dá para concluir de novo ou cancelar).
create or replace function sale_delete(p_token text, p_id int, p_reason text, p_confirm_number int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; s sales; sess cash_sessions; it record; pay record; v_note text; v_reason text := trim(coalesce(p_reason, ''));
  v_stock int := 0; v_cash int := 0; v_fiado int := 0; v_order int; v_snapshot jsonb;
begin
  u := _op(p_token);
  if u.role <> 'admin' then perform _err('Só o administrador pode apagar venda.', 'PROIBIDO'); end if;
  if length(v_reason) < 3 then perform _err('Escreva o motivo para apagar a venda.', 'DADOS'); end if;
  select * into s from sales where id = p_id for update;
  if s.id is null then perform _err('Venda não encontrada.', 'NAO_ENCONTRADO'); end if;
  if s.status = 'EXCLUIDA' then perform _err('Esta venda já foi apagada.', 'CONFLITO'); end if;
  if p_confirm_number is distinct from s.number then perform _err('Para confirmar, digite o número da venda: ' || s.number || '.', 'CONFIRMAR'); end if;
  v_snapshot := sale_get(s.id);
  v_note := 'Estorno por exclusão da venda nº ' || s.number;
  if s.session_id is not null then select * into sess from cash_sessions where id = s.session_id; end if;
  if s.status = 'FINALIZADA' then
    for it in select * from sale_items where sale_id = s.id and product_id is not null loop
      perform _apply_stock(it.product_id, it.qty, 'EXCLUSAO', u.id, null, 'venda', s.id, null, v_note, false);
      v_stock := v_stock + 1;
    end loop;
    for pay in select * from sale_payments where sale_id = s.id and method <> 'nao_informado' loop
      if sess.id is not null and pay.net_cents <> 0 then
        perform _cash_move(sess.id, 'ESTORNO', pay.method, -pay.net_cents, u.id, 'venda', s.id,
          v_note || case when sess.status = 'ABERTO' then '' else ' (caixa já fechado: a conferência não muda)' end, u.id);
        v_cash := v_cash + pay.net_cents;
      end if;
      if pay.method = 'fiado' and s.customer_id is not null and pay.net_cents <> 0 then
        perform _ledger(s.customer_id, 'ESTORNO', -pay.net_cents, u.id, s.id, sess.id, 'fiado', v_note, false);
        v_fiado := v_fiado + pay.net_cents;
      end if;
    end loop;
    update orders set status = 'PRONTA', sale_id = null, concluded_at = null, concluded_by = null, paid = false, paid_method = null, updated_at = now(),
           note = concat_ws(' · ', nullif(note, ''), 'Venda nº ' || s.number || ' apagada pelo administrador (' || v_reason || ')')
     where sale_id = s.id returning id into v_order;
  end if;
  update sales set status = 'EXCLUIDA', deleted_at = now(), deleted_by = u.id, delete_reason = v_reason, deleted_prev_status = s.status where id = s.id;
  perform _audit(u.id, 'VENDA_EXCLUIDA', 'sale', s.id, jsonb_build_object('number', s.number, 'total', s.total_cents, 'created_at', s.created_at,
    'prev_status', s.status, 'imported', s.imported, 'reason', v_reason, 'session_id', s.session_id, 'session_status', sess.status,
    'stock_lines', v_stock, 'cash_reversed', v_cash, 'fiado_reversed', v_fiado, 'order_id', v_order, 'sale', v_snapshot));
  return sale_get(s.id) || jsonb_build_object('effects', jsonb_build_object('stock_lines', v_stock, 'cash_reversed_cents', v_cash,
    'session_status', sess.status, 'fiado_reversed_cents', v_fiado, 'order_id', v_order, 'prev_status', s.status));
end $$;
