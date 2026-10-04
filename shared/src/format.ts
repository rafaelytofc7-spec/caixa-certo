import { Unit, UNIT_LABEL } from './types';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const n2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n3 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** 123456 -> "R$ 1.234,56" (com espaço normal) */
export function formatBRL(cents: number): string {
  return brl.format(cents / 100).replace(/\u00a0/g, ' ');
}
/** 123456 -> "1.234,56" */
export function formatMoney(cents: number): string { return n2.format(cents / 100); }
/** gramas -> "1,250" */
export function formatKg(grams: number): string { return n3.format(grams / 1000); }

/** quantidade em milésimos formatada conforme unidade: "1,250 kg" / "2 un" */
export function formatQty(qty: number, unit: Unit): string {
  if (unit === 'KG') return `${formatKg(qty)} kg`;
  const v = qty / 1000;
  const s = Number.isInteger(v) ? String(v) : n3.format(v);
  return `${s} ${UNIT_LABEL[unit]}`;
}

/** "12,34" | "12.34" | "R$ 12,34" -> 1234 */
export function parseMoney(input: string): number {
  const s = String(input).replace(/[^\d,.-]/g, '').trim();
  if (!s) return 0;
  let norm = s;
  if (s.includes(',')) norm = s.replace(/\./g, '').replace(',', '.');
  const v = Number(norm);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
}

/**
 * Peso digitado ou vindo da balança (teclado).
 * Com separador ("1,250", "01.250", "0.5") => kg. Sem separador ("1250") => gramas.
 */
export function parseWeight(input: string): number {
  const s = String(input).trim().replace(/[^\d,.]/g, '');
  if (!s) return 0;
  if (/[.,]/.test(s)) {
    const v = Number(s.replace(',', '.'));
    return Number.isFinite(v) ? Math.round(v * 1000) : 0;
  }
  return parseInt(s, 10) || 0;
}

export function pctToText(pctX100: number): string { return `${n2.format(pctX100 / 100)}%`; }
