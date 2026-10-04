-- v3.2: livro caixa (calendário). Só leitura. Inclui as vendas importadas do sistema antigo.

-- por dia no período: vendas (e importadas), aberturas/fechamentos, sangrias/suprimentos e diferença dos fechamentos
create or replace function cash_book_days(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_store();
  if p_to < p_from or p_to - p_from > 200 then perform _err('Período inválido (até 200 dias).'); end if;
  return coalesce((select jsonb_agg(x order by x.day) from (
    select d::date as day,
      coalesce(s.n, 0) sales_count, coalesce(s.total, 0) total_cents, coalesce(s.imp_n, 0) imported_count, coalesce(s.imp_total, 0) imported_total_cents,
      coalesce(o.n, 0) opened, coalesce(c.n, 0) closed, coalesce(c.diff, 0) diff_cents, coalesce(c.has_counts, false) has_counts,
      coalesce(m.sangria, 0) sangria_cents, coalesce(m.suprimento, 0) suprimento_cents
    from generate_series(p_from, p_to, interval '1 day') d
    left join (select _local_date(created_at) as day, count(*)::int as n, sum(total_cents)::int as total,
                      (count(*) filter (where imported))::int imp_n, coalesce(sum(total_cents) filter (where imported), 0)::int imp_total
                 from sales where status = 'FINALIZADA' and _local_date(created_at) between p_from and p_to group by 1) s on s.day = d::date
    left join (select _local_date(opened_at) as day, count(*)::int n from cash_sessions where _local_date(opened_at) between p_from and p_to group by 1) o on o.day = d::date
    left join (select _local_date(cs.closed_at) as day, count(*)::int n, sum(k.diff)::int diff, bool_or(k.diff is not null) has_counts
                 from cash_sessions cs left join (select session_id, sum(counted_cents - expected_cents)::int diff from cash_session_counts group by 1) k on k.session_id = cs.id
                where cs.closed_at is not null and _local_date(cs.closed_at) between p_from and p_to group by 1) c on c.day = d::date
    left join (select _local_date(created_at) as day, coalesce(abs(sum(amount_cents) filter (where type = 'SANGRIA')), 0)::int sangria,
                      coalesce(sum(amount_cents) filter (where type = 'SUPRIMENTO'), 0)::int suprimento
                 from cash_movements where _local_date(created_at) between p_from and p_to group by 1) m on m.day = d::date) x), '[]'::jsonb);
end $$;

-- detalhe de um dia ou período: vendas por forma de pagamento, sessões (abertura/fechamento/diferença) e movimentos
create or replace function cash_book_detail(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_store();
  if p_to < p_from or p_to - p_from > 400 then perform _err('Período inválido.'); end if;
  return jsonb_build_object('from', p_from, 'to', p_to,
    'sales', (select jsonb_build_object('count', count(*)::int, 'total_cents', coalesce(sum(total_cents), 0)::int,
                'imported_count', (count(*) filter (where imported))::int, 'imported_total_cents', coalesce(sum(total_cents) filter (where imported), 0)::int,
                'canceled_count', (select count(*) from sales c where c.status = 'CANCELADA' and _local_date(c.created_at) between p_from and p_to)::int,
                'canceled_total_cents', (select coalesce(sum(total_cents), 0) from sales c where c.status = 'CANCELADA' and _local_date(c.created_at) between p_from and p_to)::int)
              from sales where status = 'FINALIZADA' and _local_date(created_at) between p_from and p_to),
    'by_payment', coalesce((select jsonb_agg(x order by x.total_cents desc) from (
        select p.method, count(*)::int n, sum(p.net_cents)::int total_cents from sale_payments p join sales s on s.id = p.sale_id
         where s.status = 'FINALIZADA' and _local_date(s.created_at) between p_from and p_to group by p.method) x), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(x order by x.opened_at) from (
        select cs.id, cs.terminal, cs.status, cs.opened_at, cs.closed_at, cs.opening_float_cents, uo.name opened_by_name, uc.name closed_by_name,
               (select sum(expected_cents) from cash_session_counts k where k.session_id = cs.id)::int expected_cents,
               (select sum(counted_cents) from cash_session_counts k where k.session_id = cs.id)::int counted_cents,
               (select sum(counted_cents - expected_cents) from cash_session_counts k where k.session_id = cs.id)::int diff_cents,
               (select coalesce(sum(total_cents), 0) from sales s where s.session_id = cs.id and s.status = 'FINALIZADA')::int sales_total_cents
          from cash_sessions cs join users uo on uo.id = cs.opened_by left join users uc on uc.id = cs.closed_by
         where _local_date(cs.opened_at) between p_from and p_to or (cs.closed_at is not null and _local_date(cs.closed_at) between p_from and p_to)) x), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(x order by x.created_at) from (
        select m.id, m.session_id, m.type, m.method, m.amount_cents, m.note, m.created_at, u.name user_name
          from cash_movements m join users u on u.id = m.user_id
         where m.type in ('ABERTURA','SANGRIA','SUPRIMENTO','RECEBIMENTO_FIADO','ESTORNO') and _local_date(m.created_at) between p_from and p_to
         order by m.created_at limit 500) x), '[]'::jsonb));
end $$;

revoke all on function cash_book_days(date, date), cash_book_detail(date, date) from public, anon;
grant execute on function cash_book_days(date, date), cash_book_detail(date, date) to authenticated;
