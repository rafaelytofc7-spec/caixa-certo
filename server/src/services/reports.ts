import type { DB } from '../db';
import { LOSS_LABEL, PAYMENT_LABEL, formatKg, formatMoney, UNIT_LABEL, Unit, LossReason, PaymentMethod } from '@folha/shared';

const F = `s.status = 'FINALIZADA' AND date(s.created_at) BETWEEN ? AND ?`;

export function report(db: DB, from: string, to: string) {
  const sum = db.prepare(`SELECT COUNT(*) AS sales_count, COALESCE(SUM(gross_cents),0) AS gross_cents,
      COALESCE(SUM(item_discount_cents + total_discount_cents),0) AS discount_cents, COALESCE(SUM(total_cents),0) AS total_cents,
      COALESCE(SUM(cost_cents),0) AS cost_cents FROM sales s WHERE ${F}`).get(from, to) as any;
  const canceled = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS total_cents FROM sales s
    WHERE s.status = 'CANCELADA' AND date(s.created_at) BETWEEN ? AND ?`).get(from, to) as any;
  const margin = sum.total_cents - sum.cost_cents;
  const byOperator = db.prepare(`SELECT u.name, COUNT(*) AS sales_count, SUM(s.total_cents) AS total_cents FROM sales s
    JOIN users u ON u.id = s.user_id WHERE ${F} GROUP BY u.id ORDER BY total_cents DESC`).all(from, to);
  const byPayment = (db.prepare(`SELECT p.method, COUNT(*) AS n, SUM(p.net_cents) AS total_cents FROM sale_payments p
    JOIN sales s ON s.id = p.sale_id WHERE ${F} GROUP BY p.method ORDER BY total_cents DESC`).all(from, to) as any[])
    .map((r) => ({ ...r, label: PAYMENT_LABEL[r.method as PaymentMethod] }));
  const byCategory = db.prepare(`SELECT c.name, c.color, SUM(i.total_cents) AS total_cents,
      SUM(ROUND(i.unit_cost_cents * i.qty / 1000.0)) AS cost_cents FROM sale_items i JOIN sales s ON s.id = i.sale_id
    JOIN products p ON p.id = i.product_id JOIN categories c ON c.id = p.category_id WHERE ${F}
    GROUP BY c.id ORDER BY total_cents DESC`).all(from, to);
  const byProduct = db.prepare(`SELECT p.id, p.name, p.unit, p.icon, SUM(i.qty) AS qty, SUM(i.total_cents) AS total_cents,
      SUM(ROUND(i.unit_cost_cents * i.qty / 1000.0)) AS cost_cents FROM sale_items i JOIN sales s ON s.id = i.sale_id
    JOIN products p ON p.id = i.product_id WHERE ${F} GROUP BY p.id ORDER BY total_cents DESC`).all(from, to);
  const byDay = db.prepare(`SELECT date(s.created_at) AS day, COUNT(*) AS sales_count, SUM(s.total_cents) AS total_cents FROM sales s
    WHERE ${F} GROUP BY day ORDER BY day`).all(from, to);
  const losses = (db.prepare(`SELECT l.reason, COUNT(*) AS n, SUM(l.cost_cents) AS cost_cents FROM losses l
    WHERE date(l.created_at) BETWEEN ? AND ? GROUP BY l.reason ORDER BY cost_cents DESC`).all(from, to) as any[])
    .map((r) => ({ ...r, label: LOSS_LABEL[r.reason as LossReason] }));
  const lossItems = db.prepare(`SELECT l.id, l.created_at, l.reason, l.qty, l.cost_cents, l.note, p.name, p.unit, u.name AS user_name
    FROM losses l JOIN products p ON p.id = l.product_id JOIN users u ON u.id = l.user_id
    WHERE date(l.created_at) BETWEEN ? AND ? ORDER BY l.id DESC`).all(from, to);
  const lossTotal = (losses as any[]).reduce((a, r) => a + (r.cost_cents ?? 0), 0);
  return {
    from, to,
    summary: {
      ...sum, margin_cents: margin,
      margin_pct_x100: sum.total_cents ? Math.round((margin * 10000) / sum.total_cents) : 0,
      ticket_medio_cents: sum.sales_count ? Math.round(sum.total_cents / sum.sales_count) : 0,
      canceled_count: canceled.n, canceled_total_cents: canceled.total_cents, loss_cost_cents: lossTotal,
    },
    by_operator: byOperator, by_payment: byPayment, by_category: byCategory, by_product: byProduct, by_day: byDay,
    losses, loss_items: lossItems,
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** CSV no padrão brasileiro (separador ;, decimal com vírgula) com BOM para abrir no Excel. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return '\ufeff' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export function reportCsv(db: DB, section: string, from: string, to: string): { filename: string; csv: string } {
  const r = report(db, from, to);
  const m = (c: number) => formatMoney(c ?? 0);
  const qty = (q: number, u: Unit) => (u === 'KG' ? formatKg(q) : String(q / 1000));
  switch (section) {
    case 'produtos':
      return { filename: `produtos_${from}_${to}.csv`, csv: toCsv(['Produto', 'Unidade', 'Quantidade', 'Total (R$)', 'Custo (R$)', 'Margem (R$)'],
        r.by_product.map((p: any) => [p.name, UNIT_LABEL[p.unit as Unit], qty(p.qty, p.unit), m(p.total_cents), m(p.cost_cents), m(p.total_cents - p.cost_cents)])) };
    case 'categorias':
      return { filename: `categorias_${from}_${to}.csv`, csv: toCsv(['Categoria', 'Total (R$)', 'Custo (R$)', 'Margem (R$)'],
        r.by_category.map((c: any) => [c.name, m(c.total_cents), m(c.cost_cents), m(c.total_cents - c.cost_cents)])) };
    case 'pagamentos':
      return { filename: `pagamentos_${from}_${to}.csv`, csv: toCsv(['Forma', 'Qtd', 'Total (R$)'],
        r.by_payment.map((p: any) => [p.label, p.n, m(p.total_cents)])) };
    case 'operadores':
      return { filename: `operadores_${from}_${to}.csv`, csv: toCsv(['Operador', 'Vendas', 'Total (R$)'],
        r.by_operator.map((o: any) => [o.name, o.sales_count, m(o.total_cents)])) };
    case 'perdas':
      return { filename: `perdas_${from}_${to}.csv`, csv: toCsv(['Data', 'Produto', 'Motivo', 'Quantidade', 'Custo (R$)', 'Usuário', 'Obs'],
        r.loss_items.map((l: any) => [l.created_at, l.name, LOSS_LABEL[l.reason as LossReason], qty(l.qty, l.unit), m(l.cost_cents), l.user_name, l.note ?? ''])) };
    case 'vendas': {
      const rows = db.prepare(`SELECT s.number, s.created_at, s.status, u.name AS op, c.name AS cli, s.gross_cents,
          s.item_discount_cents + s.total_discount_cents AS disc, s.total_cents, s.cost_cents,
          (SELECT GROUP_CONCAT(method, '+') FROM sale_payments WHERE sale_id = s.id) AS methods
        FROM sales s JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
        WHERE date(s.created_at) BETWEEN ? AND ? ORDER BY s.number`).all(from, to) as any[];
      return { filename: `vendas_${from}_${to}.csv`, csv: toCsv(['Nº', 'Data/hora', 'Situação', 'Operador', 'Cliente', 'Bruto (R$)', 'Desconto (R$)', 'Total (R$)', 'Custo (R$)', 'Pagamento'],
        rows.map((s) => [s.number, s.created_at, s.status, s.op, s.cli ?? '', m(s.gross_cents), m(s.disc), m(s.total_cents), m(s.cost_cents), s.methods])) };
    }
    default:
      return { filename: `resumo_${from}_${to}.csv`, csv: toCsv(['Dia', 'Vendas', 'Total (R$)'],
        r.by_day.map((d: any) => [d.day, d.sales_count, m(d.total_cents)])) };
  }
}
