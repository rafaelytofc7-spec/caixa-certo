import { Discount, CartItemInput } from './types';

/** Total bruto da linha: round(preço * qtd / 1000). Para KG, preço é por kg e qtd em gramas. */
export function lineGross(priceCents: number, qty: number): number {
  return Math.round((priceCents * qty) / 1000);
}

export function discountAmount(base: number, d?: Discount | null): number {
  if (!d || !d.value || d.value <= 0) return 0;
  const v = d.type === 'pct' ? Math.round((base * d.value) / 10000) : Math.round(d.value);
  return Math.max(0, Math.min(base, v));
}

export interface CalcLine { gross_cents: number; discount_cents: number; total_cents: number }
export interface CalcResult {
  lines: CalcLine[];
  gross_cents: number;          // soma bruta sem desconto
  item_discount_cents: number;  // soma dos descontos de item
  subtotal_cents: number;       // bruto - desconto de item
  total_discount_cents: number; // desconto no total
  discount_cents: number;       // todos os descontos
  total_cents: number;
  discount_pct_x100: number;    // % total de desconto sobre o bruto (x100)
}

export function calcSale(
  items: Array<Pick<CartItemInput, 'qty' | 'discount'> & { price_cents: number }>,
  totalDiscount?: Discount | null,
): CalcResult {
  const lines = items.map((it) => {
    const gross = lineGross(it.price_cents, it.qty);
    const disc = discountAmount(gross, it.discount);
    return { gross_cents: gross, discount_cents: disc, total_cents: gross - disc };
  });
  const gross = lines.reduce((a, l) => a + l.gross_cents, 0);
  const itemDisc = lines.reduce((a, l) => a + l.discount_cents, 0);
  const subtotal = gross - itemDisc;
  const totalDisc = discountAmount(subtotal, totalDiscount);
  const discount = itemDisc + totalDisc;
  return {
    lines, gross_cents: gross, item_discount_cents: itemDisc, subtotal_cents: subtotal,
    total_discount_cents: totalDisc, discount_cents: discount, total_cents: subtotal - totalDisc,
    discount_pct_x100: gross > 0 ? Math.round((discount * 10000) / gross) : 0,
  };
}

/** Pagamentos: troco só sai do dinheiro. Retorna troco ou erro. */
export function calcChange(totalCents: number, payments: Array<{ method: string; amount_cents: number }>):
  { ok: true; paid_cents: number; change_cents: number } | { ok: false; error: string } {
  const paid = payments.reduce((a, p) => a + p.amount_cents, 0);
  const nonCash = payments.filter((p) => p.method !== 'dinheiro').reduce((a, p) => a + p.amount_cents, 0);
  if (payments.some((p) => !Number.isInteger(p.amount_cents) || p.amount_cents <= 0))
    return { ok: false, error: 'Valor de pagamento inválido.' };
  if (paid < totalCents) return { ok: false, error: 'Pagamento menor que o total.' };
  if (nonCash > totalCents) return { ok: false, error: 'Troco só em dinheiro: PIX/cartão/voucher/fiado não podem passar do total.' };
  return { ok: true, paid_cents: paid, change_cents: paid - totalCents };
}
