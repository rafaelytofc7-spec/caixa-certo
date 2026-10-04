// Cupom/relatórios 80 mm — modelo de linhas puro (sem banco). Usado pelo servidor local e pelo navegador (modo online).
import { formatBRL, formatQty } from './format';
import { UNIT_LABEL, Unit, PAYMENT_LABEL, PaymentMethod } from './types';
import { BRAND } from './brand';

export interface ReceiptStore { name: string; legal_name?: string; cnpj?: string; address?: string; phone?: string; receipt_footer?: string }

export const COLS = 48;

/** Modelo de linha do cupom — mesmo modelo gera HTML, PDF e ESC/POS. */
export type RLine =
  | { k: 'title'; text: string }
  | { k: 'center'; text: string; bold?: boolean }
  | { k: 'text'; text: string; bold?: boolean }
  | { k: 'lr'; left: string; right: string; bold?: boolean; big?: boolean }
  | { k: 'cols'; cells: string[]; bold?: boolean }
  | { k: 'hr' }
  | { k: 'blank' };

export interface ReceiptDoc { lines: RLine[]; openDrawer?: boolean; title: string }

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
export function lr(left: string, right: string, cols = COLS) {
  const space = cols - right.length - 1;
  return pad(left, Math.max(0, space)) + ' ' + right;
}
export function wrap(text: string, cols = COLS): string[] {
  const out: string[] = []; let cur = '';
  for (const w of text.split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > cols) { if (cur) out.push(cur); cur = w.slice(0, cols); } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}
export function center(text: string, cols = COLS) {
  const t = text.slice(0, cols); const l = Math.floor((cols - t.length) / 2);
  return ' '.repeat(l) + t;
}
export const dt = (s: string) => { // "2026-10-02 16:05:00" -> "02/10/2026 16:05"
  const [d, t] = s.split(' '); const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y} ${(t ?? '').slice(0, 5)}`;
};

export function storeHeader(s: ReceiptStore): RLine[] {
  const L: RLine[] = [{ k: 'title', text: s.name.toUpperCase() }];
  if (s.legal_name) L.push({ k: 'center', text: s.legal_name });
  if (s.cnpj) L.push({ k: 'center', text: `CNPJ ${s.cnpj}` });
  if (s.address) for (const w of wrap(s.address)) L.push({ k: 'center', text: w });
  if (s.phone) L.push({ k: 'center', text: `Tel. ${s.phone}` });
  return L;
}

/** sale = venda completa (itens, pagamentos, customer_name); balance = saldo devedor atual do cliente */
export function buildReceiptDoc(s: ReceiptStore, sale: any, customerBalanceCents: number | null = null): ReceiptDoc {
  const L: RLine[] = storeHeader(s);
  L.push({ k: 'hr' }, { k: 'center', text: 'NÃO É DOCUMENTO FISCAL', bold: true }, { k: 'hr' });
  L.push({ k: 'lr', left: `Venda nº ${String(sale.number).padStart(6, '0')}`, right: dt(sale.created_at), bold: true });
  if (sale.imported) L.push({ k: 'center', text: 'VENDA IMPORTADA DO SISTEMA ANTIGO', bold: true }, { k: 'center', text: 'só o total: sem itens e sem forma de pagamento' });
  else L.push({ k: 'lr', left: `Caixa ${sale.terminal}`, right: `Op. ${sale.user_name}` });
  if (sale.status === 'CANCELADA') L.push({ k: 'center', text: '*** VENDA CANCELADA ***', bold: true });
  if (sale.status === 'EXCLUIDA') L.push({ k: 'center', text: '*** VENDA APAGADA (ADMIN) ***', bold: true });
  if (sale.order) L.push({ k: 'center', text: `ENCOMENDA nº ${sale.order.id} · ${sale.order.customer_name}`, bold: true });
  L.push({ k: 'hr' });
  sale.items.forEach((it: any, i: number) => {
    L.push({ k: 'text', text: `${String(i + 1).padStart(2, '0')} ${it.name}`, bold: true });
    const unit = it.unit as Unit;
    const priceTxt = unit === 'KG' ? `${formatBRL(it.unit_price_cents)}/kg` : `${formatBRL(it.unit_price_cents)}/${UNIT_LABEL[unit]}`;
    L.push({ k: 'lr', left: `   ${formatQty(it.qty, unit)} x ${priceTxt}`, right: formatBRL(it.gross_cents) });
    if (it.promotion_id && it.regular_price_cents > it.unit_price_cents) L.push({ k: 'text', text: `   PROMOÇÃO (de ${formatBRL(it.regular_price_cents)})` });
    if (it.discount_cents > 0) L.push({ k: 'lr', left: '   desconto', right: '-' + formatBRL(it.discount_cents) });
  });
  L.push({ k: 'hr' });
  if (!sale.imported) L.push({ k: 'lr', left: `Itens: ${sale.items.length}`, right: '' });
  if (sale.item_discount_cents + sale.total_discount_cents > 0) {
    L.push({ k: 'lr', left: 'Subtotal', right: formatBRL(sale.gross_cents) });
    L.push({ k: 'lr', left: 'Descontos', right: '-' + formatBRL(sale.item_discount_cents + sale.total_discount_cents) });
  }
  L.push({ k: 'lr', left: 'TOTAL', right: formatBRL(sale.total_cents), bold: true, big: true });
  L.push({ k: 'blank' });
  for (const p of sale.payments) L.push({ k: 'lr', left: PAYMENT_LABEL[p.method as PaymentMethod] ?? p.method, right: formatBRL(p.amount_cents) });
  if (sale.change_cents > 0) L.push({ k: 'lr', left: 'Troco', right: formatBRL(sale.change_cents), bold: true });
  if (!sale.customer_name && sale.order) L.push({ k: 'hr' }, { k: 'text', text: `Cliente: ${sale.order.customer_name}` });
  if (sale.customer_name) {
    L.push({ k: 'hr' }, { k: 'text', text: `Cliente: ${sale.customer_name}` });
    const fiado = sale.payments.filter((p: any) => p.method === 'fiado').reduce((a: number, p: any) => a + p.amount_cents, 0);
    if (fiado > 0) {
      L.push({ k: 'lr', left: 'No fiado nesta compra', right: formatBRL(fiado) });
      L.push({ k: 'lr', left: 'Saldo devedor', right: formatBRL(customerBalanceCents ?? 0) });
      L.push({ k: 'blank' }, { k: 'text', text: 'Assinatura: ______________________________' });
    }
  }
  L.push({ k: 'hr' });
  if (s.receipt_footer) for (const w of wrap(s.receipt_footer)) L.push({ k: 'center', text: w });
  L.push({ k: 'center', text: 'NÃO É DOCUMENTO FISCAL', bold: true });
  L.push({ k: 'center', text: `${BRAND.name} — ${BRAND.tagline}` });
  return { lines: L, openDrawer: sale.payments.some((p: any) => p.method === 'dinheiro'), title: `Cupom ${sale.number}` };
}

export function buildSessionReportDoc(s: ReceiptStore, r: any): ReceiptDoc {
  const L: RLine[] = storeHeader(s);
  L.push({ k: 'hr' }, { k: 'center', text: r.session.status === 'FECHADO' ? 'FECHAMENTO DE CAIXA' : 'PARCIAL DE CAIXA', bold: true }, { k: 'hr' });
  L.push({ k: 'lr', left: `Sessão nº ${r.session.id}`, right: `Caixa ${r.session.terminal}` });
  L.push({ k: 'lr', left: 'Abertura', right: `${dt(r.session.opened_at)} ${r.session.opened_by_name}` });
  if (r.session.closed_at) L.push({ k: 'lr', left: 'Fechamento', right: `${dt(r.session.closed_at)} ${r.session.closed_by_name ?? ''}` });
  L.push({ k: 'hr' });
  L.push({ k: 'lr', left: 'Fundo de troco', right: formatBRL(r.opening_float_cents) });
  L.push({ k: 'lr', left: `Vendas (${r.sales_count})`, right: formatBRL(r.sales_total_cents) });
  L.push({ k: 'lr', left: 'Ticket médio', right: formatBRL(r.ticket_medio_cents) });
  L.push({ k: 'lr', left: `Canceladas (${r.canceled_count})`, right: formatBRL(r.canceled_total_cents) });
  L.push({ k: 'lr', left: 'Suprimentos', right: formatBRL(r.suprimento_cents) });
  L.push({ k: 'lr', left: 'Sangrias', right: (r.sangria_cents ? '-' : '') + formatBRL(r.sangria_cents) });
  L.push({ k: 'lr', left: 'Recebido de fiado', right: formatBRL(r.recebimento_fiado_cents) });
  L.push({ k: 'hr' });
  L.push({ k: 'cols', cells: ['Forma', 'Esperado', 'Contado', 'Diferença'], bold: true });
  for (const m of r.by_method) {
    if (m.method !== 'dinheiro' && !m.expected_cents && !m.counted_cents) continue; // sem movimento: não polui
    L.push({ k: 'cols', cells: [PAYMENT_LABEL[m.method as PaymentMethod], formatBRL(m.expected_cents),
      m.counted_cents == null ? '-' : formatBRL(m.counted_cents),
      m.diff_cents == null ? '-' : m.diff_cents === 0 ? 'ok' : (m.diff_cents > 0 ? '+' : '') + formatBRL(m.diff_cents)] });
  }
  L.push({ k: 'hr' });
  L.push({ k: 'lr', left: 'TOTAL ESPERADO', right: formatBRL(r.expected_total_cents), bold: true });
  if (r.counted_total_cents != null) {
    L.push({ k: 'lr', left: 'TOTAL CONTADO', right: formatBRL(r.counted_total_cents), bold: true });
    const diff = r.counted_total_cents - r.expected_total_cents;
    L.push({ k: 'lr', left: diff === 0 ? 'CAIXA BATEU' : diff > 0 ? 'SOBRA' : 'FALTA', right: formatBRL(Math.abs(diff)), bold: true, big: true });
  }
  L.push({ k: 'blank' }, { k: 'text', text: 'Conferido: ______________________________' });
  L.push({ k: 'center', text: 'NÃO É DOCUMENTO FISCAL', bold: true });
  return { lines: L, title: `Fechamento ${r.session.id}` };
}

/** 1ª coluna à esquerda, demais à direita (48 col: 9 + 13 + 13 + 13) */
export function colsLine(cells: string[], cols = COLS) {
  const first = cols - 13 * (cells.length - 1);
  return cells.map((c, i) => (i === 0 ? pad(c, first) : c.slice(0, 12).padStart(13))).join('');
}

// ---------- Texto puro (48 colunas) ----------
export function renderText(doc: ReceiptDoc, cols = COLS): string[] {
  const out: string[] = [];
  for (const l of doc.lines) {
    switch (l.k) {
      case 'title': out.push(center(l.text, cols)); break;
      case 'center': out.push(center(l.text, cols)); break;
      case 'text': out.push(...wrap(l.text, cols)); break;
      case 'lr': out.push(lr(l.left, l.right, cols)); break;
      case 'cols': out.push(colsLine(l.cells, cols)); break;
      case 'hr': out.push('-'.repeat(cols)); break;
      case 'blank': out.push(''); break;
    }
  }
  return out;
}

// ---------- ESC/POS 80 mm ----------
const CP860: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ã': 0x84, 'à': 0x85, 'Á': 0x86, 'ç': 0x87, 'ê': 0x88, 'Ê': 0x89, 'è': 0x8a,
  'Í': 0x8b, 'Ô': 0x8c, 'ì': 0x8d, 'Ã': 0x8e, 'Â': 0x8f, 'É': 0x90, 'À': 0x91, 'È': 0x92, 'ô': 0x93, 'õ': 0x94, 'ò': 0x95,
  'Ú': 0x96, 'ù': 0x97, 'Ì': 0x98, 'Õ': 0x99, 'Ü': 0x9a, 'Ù': 0x9d, 'Ó': 0x9f, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3,
  'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7, '—': 0x2d, '–': 0x2d, '•': 0x2a,
};
export function encodeCp860(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c < 0x80) out.push(c);
    else if (CP860[ch] !== undefined) out.push(CP860[ch]);
    else {
      const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      out.push(base && base.charCodeAt(0) < 0x80 ? base.charCodeAt(0) : 0x3f);
    }
  }
  return out;
}

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;
export function renderEscPos(doc: ReceiptDoc, opts: { cut?: boolean; drawer?: boolean } = {}): Uint8Array {
  const b: number[] = [ESC, 0x40, ESC, 0x74, 3]; // init + PC860 (português)
  const text = (s: string) => { b.push(...encodeCp860(s), LF); };
  const align = (n: 0 | 1 | 2) => b.push(ESC, 0x61, n);
  const bold = (on: boolean) => b.push(ESC, 0x45, on ? 1 : 0);
  const size = (big: boolean) => b.push(GS, 0x21, big ? 0x11 : 0x00);
  for (const l of doc.lines) {
    switch (l.k) {
      case 'title': align(1); bold(true); size(true); text(l.text.slice(0, COLS / 2)); size(false); bold(false); align(0); break;
      case 'center': align(1); if (l.bold) bold(true); text(l.text.slice(0, COLS)); if (l.bold) bold(false); align(0); break;
      case 'text': if (l.bold) bold(true); for (const w of wrap(l.text)) text(w); if (l.bold) bold(false); break;
      case 'lr':
        if (l.bold) bold(true);
        if (l.big) { size(true); text(lr(l.left, l.right, COLS / 2)); size(false); } else text(lr(l.left, l.right));
        if (l.bold) bold(false); break;
      case 'cols': if (l.bold) bold(true); text(colsLine(l.cells)); if (l.bold) bold(false); break;
      case 'hr': text('-'.repeat(COLS)); break;
      case 'blank': text(''); break;
    }
  }
  b.push(ESC, 0x64, 4); // avança 4 linhas
  if (opts.drawer ?? doc.openDrawer) b.push(ESC, 0x70, 0, 25, 250); // abre gaveta
  if (opts.cut !== false) b.push(GS, 0x56, 0x42, 0); // corte parcial
  return Uint8Array.from(b);
}

// ---------- HTML 80 mm ----------
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export function renderHtml(doc: ReceiptDoc, autoPrint = false): string {
  const body = doc.lines.map((l) => {
    switch (l.k) {
      case 'title': return `<div class="title">${esc(l.text)}</div>`;
      case 'center': return `<div class="c${l.bold ? ' b' : ''}">${esc(l.text)}</div>`;
      case 'text': return `<div class="${l.bold ? 'b' : ''}">${esc(l.text)}</div>`;
      case 'lr': return `<div class="lr${l.bold ? ' b' : ''}${l.big ? ' big' : ''}"><span>${esc(l.left)}</span><span>${esc(l.right)}</span></div>`;
      case 'cols': return `<div class="cols${l.bold ? ' b' : ''}">${l.cells.map((c) => `<span>${esc(c)}</span>`).join('')}</div>`;
      case 'hr': return '<hr>';
      case 'blank': return '<div>&nbsp;</div>';
    }
  }).join('\n');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
@page { size: 80mm auto; margin: 3mm; }
body { margin: 0; background: #F7F4EC; font-family: 'DM Sans', system-ui, sans-serif; color: #1C1917; }
.paper { width: 74mm; margin: 0 auto; background: #fff; padding: 4mm; font-size: 12px; line-height: 1.35; font-variant-numeric: tabular-nums; }
.title { text-align: center; font-weight: 700; font-size: 17px; color: #1F7A4D; letter-spacing: .5px; }
.c { text-align: center; } .b { font-weight: 700; }
.lr { display: flex; justify-content: space-between; gap: 8px; } .lr span:last-child { white-space: nowrap; }
.big { font-size: 18px; color: #1F7A4D; }
.cols { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 4px; } .cols span:not(:first-child) { text-align: right; white-space: nowrap; }
hr { border: 0; border-top: 1.5px dashed #1F7A4D; margin: 5px 0; }
@media print { body { background: #fff; } .paper { width: auto; padding: 0; } }
</style></head><body><div class="paper">${body}</div>${autoPrint ? '<script>window.onload=()=>window.print()</script>' : ''}</body></html>`;
}
