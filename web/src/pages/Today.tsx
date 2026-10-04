import { useEffect, useState } from 'react';
import { get, todayISO, isoDaysAgo } from '../api';
import { useApp } from '../ctx';
import { ReceiptModal } from './ReceiptModal';
import { Alerts } from './Stock';
import { formatBRL, formatQty, PAYMENT_LABEL, PaymentMethod, Unit } from '@folha/shared';
import { PIcon } from '../productPhotos';

const PAY_IC: Record<string, string> = { dinheiro: '💵', pix: '⚡', debito: '💳', credito: '💳', voucher: '🎟', fiado: '📒', nao_informado: '❔' };

/** "Hoje": o resumo que o dono da banca quer ver — vendido, vendas, ticket médio, formas de pagamento, perdas, mais vendidos. */
export function Today() {
  const { status, go, toast } = useApp();
  const [r, setR] = useState<any>(null);
  const [y, setY] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [view, setView] = useState<number | null>(null);
  const load = () => {
    get(`/api/reports?from=${todayISO()}&to=${todayISO()}`).then(setR).catch((e) => toast(e.message, 'erro'));
    get(`/api/reports?from=${isoDaysAgo(1)}&to=${isoDaysAgo(1)}`).then(setY).catch(() => {});
    get(`/api/sales?from=${todayISO()}&to=${todayISO()}`).then((x) => setRecent(x.filter((v: any) => v.status !== 'EXCLUIDA').slice(0, 6))).catch(() => {});
  };
  useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i); }, []); // eslint-disable-line
  const s = r?.summary; const ys = y?.summary;
  const cmp = (a?: number, b?: number) => {
    if (a == null || !b) return null;
    const d = Math.round(((a - b) / b) * 100);
    return <span className={`delta ${d >= 0 ? 'up' : 'down'}`}>{d >= 0 ? '▲' : '▼'} {Math.abs(d)}% vs ontem</span>;
  };
  const pays = (r?.by_payment ?? []).filter((p: any) => p.total_cents > 0);
  const payTotal = pays.reduce((a: number, p: any) => a + p.total_cents, 0) || 1;
  const top = [...(r?.by_product ?? [])].sort((a: any, b: any) => b.total_cents - a.total_cents).slice(0, 8);
  const topMax = Math.max(1, ...top.map((p: any) => p.total_cents));
  const cur = status?.session;
  const d = new Date();
  return (
    <div className="page today">
      <div className="page-title">
        <div><h1>📈 Hoje</h1><div className="muted small cap">{d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</div></div>
        <span className="spacer" />
        <div className="row wrap quick">
          <button className="btn btn-primary" onClick={() => go('venda')}>🛒 Vender</button>
          <button className="btn" onClick={() => go('produtos/precos')}>🏷 Preço do dia</button>
          <button className="btn" onClick={() => go('compras/nova')}>🚚 Lançar compra</button>
          <button className="btn" onClick={() => go('caixa')}>{cur ? '💵 Fechar caixa' : '💵 Abrir caixa'}</button>
        </div>
      </div>
      {!s ? <div className="card muted">Carregando…</div> : <>
        <div className="grid4 kpis">
          <div className="stat hero"><div className="lbl">Vendido hoje</div><div className="val">{formatBRL(s.total_cents)}</div>{cmp(s.total_cents, ys?.total_cents)}</div>
          <div className="stat"><div className="lbl">Nº de vendas</div><div className="val">{s.sales_count}</div>{cmp(s.sales_count, ys?.sales_count)}</div>
          <div className="stat"><div className="lbl">Ticket médio</div><div className="val">{formatBRL(s.ticket_medio_cents)}</div><span className="small muted">{s.imported_count ? `inclui ${s.imported_count} importada(s) do sistema antigo` : 'por freguês'}</span></div>
          <div className={`stat ${s.loss_cost_cents ? 'tomate' : ''}`}><div className="lbl">Perdas (custo)</div><div className="val">{formatBRL(s.loss_cost_cents)}</div>
            <span className="small muted">{s.canceled_count ? `${s.canceled_count} cancelada(s) · ${formatBRL(s.canceled_total_cents)}` : 'nenhuma venda cancelada'}</span></div>
          {s.promo_items_count > 0 && <div className="stat promo-stat" data-testid="today-promo"><div className="lbl">🔥 Vendido em promoção</div><div className="val">{formatBRL(s.promo_total_cents)}</div>
            <span className="small muted">{s.promo_items_count} item(ns) · freguês economizou {formatBRL(s.promo_savings_cents)}</span></div>}
        </div>
        <div className="grid2">
          <div className="card">
            <h3>Por forma de pagamento</h3>
            {!pays.length ? <div className="empty-mini">Nenhuma venda ainda hoje. Bora abrir a banca! 🍅</div> :
              <div className="paybars">{pays.map((p: any) => (
                <div key={p.method} className={`paybar m-${p.method}`}>
                  <span className="pm">{PAY_IC[p.method] ?? '•'} {PAYMENT_LABEL[p.method as PaymentMethod] ?? p.label}</span>
                  <span className="bar"><i style={{ width: `${(p.total_cents / payTotal) * 100}%` }} /></span>
                  <span className="pv"><b>{formatBRL(p.total_cents)}</b><small>{p.n} · {Math.round((p.total_cents / payTotal) * 100)}%</small></span>
                </div>))}</div>}
            {cur && <div className="small muted" style={{ marginTop: 10 }}>Na gaveta agora (esperado): <b>{formatBRL(cur.by_method.find((m: any) => m.method === 'dinheiro')?.expected_cents ?? 0)}</b> · caixa aberto por {cur.session.opened_by_name}</div>}
          </div>
          <div className="card">
            <div className="row" style={{ marginBottom: 6 }}><h3 className="grow" style={{ margin: 0 }}>🏆 Mais vendidos</h3><button className="btn btn-sm btn-ghost" onClick={() => go('relatorios')}>Relatório completo ›</button></div>
            {!top.length ? <div className="empty-mini">Os campeões do dia aparecem aqui.</div> :
              <ol className="toplist">{top.map((p: any, i: number) => (
                <li key={p.id}><span className="rk">{i + 1}</span><span className="em"><PIcon p={p} /></span>
                  <span className="grow"><b>{p.name}</b><span className="bar"><i style={{ width: `${(p.total_cents / topMax) * 100}%` }} /></span></span>
                  <span className="pv"><b>{formatBRL(p.total_cents)}</b><small>{formatQty(p.qty, p.unit as Unit)}</small></span></li>))}</ol>}
          </div>
        </div>
        <div className="grid2">
          <div className="card">
            <div className="row" style={{ marginBottom: 6 }}><h3 className="grow" style={{ margin: 0 }}>🧾 Últimas vendas</h3><button className="btn btn-sm btn-ghost" onClick={() => go('vendas')}>Ver todas ›</button></div>
            {!recent.length ? <div className="empty-mini">Sem vendas hoje.</div> :
              <ul className="recent">{recent.map((v) => <li key={v.id}>
                <b className="num">nº {v.number}</b><span className="muted">{v.created_at.slice(11, 16)} · {v.imported ? 'importada' : v.user_name}</span>
                <span className="spacer" />{v.status !== 'FINALIZADA' && <span className="tag bad">Cancelada</span>}
                <b className="num">{formatBRL(v.total_cents)}</b>
                <button className="btn btn-sm" onClick={() => setView(v.id)}>🖨 Cupom</button></li>)}</ul>}
          </div>
          <Alerts compact />
        </div>
      </>}
      {view && <ReceiptModal saleId={view} onClose={() => setView(null)} />}
    </div>
  );
}
