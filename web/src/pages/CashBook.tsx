import { useEffect, useMemo, useState } from 'react';
import { get, fmtDateTime } from '../api';
import { useApp } from '../ctx';
import { formatBRL, PAYMENT_LABEL, PaymentMethod } from '@folha/shared';

// Livro caixa (v3.2): calendário do mês com o total vendido em cada dia + detalhe do dia/período.
interface Day { day: string; sales_count: number; total_cents: number; imported_count: number; imported_total_cents: number;
  opened: number; closed: number; diff_cents: number; has_counts: boolean; sangria_cents: number; suprimento_cents: number }
const p2 = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MOV: Record<string, string> = { ABERTURA: 'Abertura (fundo)', SANGRIA: 'Sangria', SUPRIMENTO: 'Suprimento', RECEBIMENTO_FIADO: 'Recebimento de fiado', ESTORNO: 'Estorno (cancelamento)' };
/** valor curto para a célula do calendário: 2.210 · 12,3 mil */
const short = (c: number) => { const r = c / 100; return r >= 10000 ? `${(r / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : Math.round(r).toLocaleString('pt-BR'); };
const fmtDay = (s: string) => parse(s).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });

export function CashBook({ onSession }: { onSession?: (id: number) => void }) {
  const { toast } = useApp();
  const today = iso(new Date());
  const [month, setMonth] = useState(() => today.slice(0, 7)); // AAAA-MM
  const [days, setDays] = useState<Day[] | null>(null);
  const [sel, setSel] = useState<{ from: string; to: string; label: string }>({ from: today, to: today, label: 'Hoje' });
  const [det, setDet] = useState<any>(null);
  const [custom, setCustom] = useState(false);
  const [cf, setCf] = useState(today); const [ct, setCt] = useState(today);
  const [err, setErr] = useState('');

  const first = parse(`${month}-01`);
  const gridFrom = addDays(`${month}-01`, -first.getDay());
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const gridTo = addDays(iso(last), 6 - last.getDay());
  useEffect(() => {
    let live = true; // troca rápida de mês: só vale a resposta do mês que está na tela
    setDays(null);
    get<Day[]>(`/api/cash/book?from=${gridFrom}&to=${gridTo}`).then((d) => { if (live) { setDays(d); setErr(''); } })
      .catch((e) => { if (live) { setDays([]); setErr(e.status === 404 ? 'O livro caixa precisa do modo online (Supabase).' : e.message); } });
    return () => { live = false; };
  }, [gridFrom, gridTo]);
  useEffect(() => {
    let live = true;
    setDet(null);
    get(`/api/cash/book/detail?from=${sel.from}&to=${sel.to}`).then((d) => { if (live) setDet(d); }).catch((e) => live && toast(e.message, 'erro'));
    return () => { live = false; };
  }, [sel.from, sel.to, toast]);

  const byDay = useMemo(() => new Map((days ?? []).map((d) => [d.day, d])), [days]);
  const inMonth = (days ?? []).filter((d) => d.day.startsWith(month));
  const mt = inMonth.reduce((a, d) => ({ total: a.total + d.total_cents, n: a.n + d.sales_count, imp: a.imp + d.imported_total_cents, dias: a.dias + (d.sales_count ? 1 : 0),
    sangria: a.sangria + d.sangria_cents, supr: a.supr + d.suprimento_cents }), { total: 0, n: 0, imp: 0, dias: 0, sangria: 0, supr: 0 });
  const maxDay = Math.max(1, ...inMonth.map((d) => d.total_cents));
  const cells: string[] = []; for (let d = gridFrom; d <= gridTo; d = addDays(d, 1)) cells.push(d);

  const pick = (from: string, to: string, label: string) => { setSel({ from, to, label }); setMonth(from.slice(0, 7)); setCustom(false); };
  const now = new Date();
  const weekStart = addDays(today, -now.getDay());
  const quick: [string, () => void][] = [
    ['Hoje', () => pick(today, today, 'Hoje')], ['Ontem', () => pick(addDays(today, -1), addDays(today, -1), 'Ontem')],
    ['Esta semana', () => pick(weekStart, today, 'Esta semana')], ['Este mês', () => pick(`${today.slice(0, 7)}-01`, today, 'Este mês')],
  ];
  const shiftMonth = (n: number) => { const d = new Date(first.getFullYear(), first.getMonth() + n, 1); setMonth(iso(d).slice(0, 7)); };
  const s = det?.sales;

  return (
    <div className="card cashbook" data-testid="cashbook">
      <div className="row wrap cb-head">
        <h3 style={{ margin: 0 }}>📅 Livro caixa</h3>
        <span className="spacer" />
        <div className="tabs cb-quick">{quick.map(([l, f]) => <button key={l} className={sel.label === l && !custom ? 'on' : ''} onClick={f}>{l}</button>)}
          <button className={custom || sel.label === 'Período' ? 'on' : ''} onClick={() => setCustom((v) => !v)}>Período…</button></div>
      </div>
      {custom && <div className="row wrap cb-custom">
        <input type="date" className="input" value={cf} onChange={(e) => setCf(e.target.value)} aria-label="De" /><span>até</span>
        <input type="date" className="input" value={ct} onChange={(e) => setCt(e.target.value)} aria-label="Até" />
        <button className="btn btn-primary" onClick={() => (cf <= ct ? pick(cf, ct, 'Período') : toast('A data final precisa ser depois da inicial.', 'erro'))}>Ver período</button>
      </div>}
      {err && <div className="err">{err}</div>}
      <div className="cb-wrap">
        <div className="cb-cal">
          <div className="row cb-month">
            <button className="btn btn-sm" onClick={() => shiftMonth(-1)} aria-label="Mês anterior">‹</button>
            <b className="grow cap" style={{ textAlign: 'center' }}>{MONTHS[first.getMonth()]} {first.getFullYear()}</b>
            <button className="btn btn-sm" onClick={() => shiftMonth(1)} aria-label="Próximo mês">›</button>
          </div>
          <div className="cb-mtotal" data-testid="cb-month-total">
            <span>Mês: <b>{formatBRL(mt.total)}</b></span><span>{mt.n} venda(s) em {mt.dias} dia(s)</span>
            {mt.imp > 0 && <span className="muted">inclui {formatBRL(mt.imp)} importado do sistema antigo</span>}
          </div>
          <div className="cb-grid" role="grid" aria-label={`Calendário de ${MONTHS[first.getMonth()]}`}>
            {WD.map((w) => <div key={w} className="cb-wd">{w}</div>)}
            {cells.map((d) => {
              const x = byDay.get(d); const out = !d.startsWith(month); const on = d >= sel.from && d <= sel.to;
              const lvl = x?.total_cents ? Math.min(4, 1 + Math.floor((x.total_cents / maxDay) * 3.99)) : 0;
              return (
                <button key={d} className={`cb-day lvl${lvl} ${out ? 'out' : ''} ${d === today ? 'today' : ''} ${on ? 'sel' : ''} ${d > today ? 'future' : ''}`}
                  onClick={() => pick(d, d, d === today ? 'Hoje' : 'Dia')} aria-label={`${parse(d).toLocaleDateString('pt-BR')}: ${x ? formatBRL(x.total_cents) : 'sem vendas'}`} data-day={d}>
                  <span className="n">{Number(d.slice(8))}</span>
                  {x?.total_cents ? <span className="v">{short(x.total_cents)}</span> : null}
                  <span className="marks">{x?.opened ? <i className="mk-open" title="caixa aberto" /> : null}{x?.has_counts && x.diff_cents !== 0 ? <i className={x.diff_cents < 0 ? 'mk-neg' : 'mk-pos'} title="diferença no fechamento" /> : null}
                    {x?.imported_count ? <i className="mk-imp" title="vendas importadas" /> : null}</span>
                </button>);
            })}
          </div>
          <div className="cb-legend small muted"><span><i className="mk-open" /> caixa aberto</span><span><i className="mk-neg" /> diferença no fechamento</span><span><i className="mk-imp" /> importadas (sistema antigo)</span></div>
        </div>
        <div className="cb-detail" data-testid="cb-detail">
          <h4 className="cap">{sel.from === sel.to ? fmtDay(sel.from) : `${parse(sel.from).toLocaleDateString('pt-BR')} a ${parse(sel.to).toLocaleDateString('pt-BR')}`}</h4>
          {!det ? <p className="muted">Carregando…</p> : <>
            <div className="grid2 cb-kpis">
              <div className="stat verde"><div className="lbl">Vendido</div><div className="val">{formatBRL(s.total_cents)}</div><span className="small muted">{s.count} venda(s){s.canceled_count ? ` · ${s.canceled_count} cancelada(s)` : ''}</span></div>
              <div className="stat"><div className="lbl">Sangria · Suprimento</div><div className="val" style={{ fontSize: 20 }}>{formatBRL(det.movements.filter((m: any) => m.type === 'SANGRIA').reduce((a: number, m: any) => a + Math.abs(m.amount_cents), 0))} · {formatBRL(det.movements.filter((m: any) => m.type === 'SUPRIMENTO').reduce((a: number, m: any) => a + m.amount_cents, 0))}</div></div>
            </div>
            {s.imported_count > 0 && <div className="small muted" style={{ margin: '4px 0 8px' }}>Inclui {s.imported_count} venda(s) importada(s) do sistema antigo ({formatBRL(s.imported_total_cents)}): sem caixa e sem forma de pagamento.</div>}
            <h5>Vendas por forma de pagamento</h5>
            {!det.by_payment.length ? <p className="muted small">Nenhuma venda.</p> :
              <table className="t"><tbody>{det.by_payment.map((p: any) => <tr key={p.method}><td>{PAYMENT_LABEL[p.method as PaymentMethod] ?? p.method}</td><td className="r">{p.n}</td><td className="r"><b>{formatBRL(p.total_cents)}</b></td></tr>)}</tbody></table>}
            <h5>Aberturas e fechamentos</h5>
            {!det.sessions.length ? <p className="muted small">Nenhum caixa aberto ou fechado {sel.from === sel.to ? 'neste dia' : 'no período'}.</p> :
              <div className="table-wrap"><table className="t cb-sessions"><thead><tr><th>Caixa</th><th>Abertura</th><th>Fechamento</th><th className="r">Esperado</th><th className="r">Contado</th><th className="r">Diferença</th><th /></tr></thead>
                <tbody>{det.sessions.map((x: any) => (
                  <tr key={x.id}><td>{x.terminal}<div className="small muted">nº {x.id}</div></td>
                    <td>{fmtDateTime(x.opened_at)}<div className="small muted">{x.opened_by_name} · fundo {formatBRL(x.opening_float_cents)}</div></td>
                    <td>{x.closed_at ? <>{fmtDateTime(x.closed_at)}<div className="small muted">{x.closed_by_name}</div></> : <span className="tag ok">Aberto</span>}</td>
                    <td className="r">{x.expected_cents != null ? formatBRL(x.expected_cents) : '—'}</td><td className="r">{x.counted_cents != null ? formatBRL(x.counted_cents) : '—'}</td>
                    <td className={`r ${x.diff_cents < 0 ? 'neg' : ''}`}>{x.diff_cents != null ? <b>{x.diff_cents > 0 ? '+' : ''}{formatBRL(x.diff_cents)}</b> : '—'}</td>
                    <td className="r">{onSession && <button className="btn btn-sm" onClick={() => onSession(x.id)}>Relatório</button>}</td></tr>))}</tbody></table></div>}
            <h5>Movimentos do caixa</h5>
            {!det.movements.length ? <p className="muted small">Sem sangria, suprimento ou abertura {sel.from === sel.to ? 'neste dia' : 'no período'}.</p> :
              <table className="t"><tbody>{det.movements.map((m: any) => (
                <tr key={m.id}><td className="small">{sel.from === sel.to ? new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : fmtDateTime(m.created_at)}</td><td>{MOV[m.type] ?? m.type}{m.note ? <div className="small muted">{m.note}</div> : null}</td>
                  <td className="small muted">{m.user_name}</td><td className={`r ${m.amount_cents < 0 ? 'neg' : ''}`}>{formatBRL(m.amount_cents)}</td></tr>))}</tbody></table>}
          </>}
        </div>
      </div>
    </div>
  );
}
