// v3.3: digitação de quantidade/peso "esperta" (teclado grande do celular, campo de texto e teclado do PC).
import { formatKg } from './format';

/**
 * Peso em kg a partir do que a pessoa digitou (milésimos = gramas):
 *  - com vírgula/ponto é kg: "1,5" → 1500 · ",350" → 350 · "0.75" → 750
 *  - só dígitos, até 2 (1 a 99) é kg: "2" → 2000 · "12" → 12000
 *  - só dígitos, 3 ou mais é grama: "350" → 350 · "1250" → 1250
 */
export function parseKgEntry(raw: string): number {
  const s = String(raw ?? '').trim().replace('.', ',').replace(/[^\d,]/g, '');
  if (!s || s === ',') return 0;
  if (s.includes(',')) {
    const [i, f = ''] = s.split(',');
    return (parseInt(i || '0', 10) * 1000) + parseInt((f + '000').slice(0, 3), 10);
  }
  const n = parseInt(s, 10) || 0;
  return s.replace(/^0+/, '').length <= 2 && !/^0\d/.test(s) ? n * 1000 : n;
}
/** o que foi digitado está em gramas? (só dígitos, 3 ou mais, ou começando com 0: "350", "050") */
export function isGramEntry(raw: string): boolean {
  const s = String(raw ?? '').trim().replace(/[^\d,.]/g, '');
  return !!s && !/[,.]/.test(s) && (s.replace(/^0+/, '').length > 2 || /^0\d/.test(s));
}
/** como o app entendeu o que foi digitado (para mostrar embaixo do número) */
export function kgEntryHint(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '350 = 350 g · 1,5 = 1,5 kg · 2 = 2 kg';
  const g = parseKgEntry(s);
  if (s.includes(',') || s.includes('.')) return `${formatKg(g)} kg`;
  return isGramEntry(s) ? `${g} g = ${formatKg(g)} kg` : `${s} = ${s} kg`;
}
/** unidades inteiras: "3" → 3000 */
export function parseUnitEntry(raw: string): number {
  const n = parseInt(String(raw ?? '').replace(/\D/g, '') || '0', 10);
  return Math.min(9999, n) * 1000;
}
/** dinheiro no teclado: com vírgula = reais ("5,5" → 550); só dígitos = centavos estilo maquininha ("500" → 500 = R$ 5,00) */
export function parseMoneyEntry(raw: string): number {
  const s = String(raw ?? '').trim().replace('.', ',').replace(/[^\d,]/g, '');
  if (!s || s === ',') return 0;
  if (s.includes(',')) { const [i, f = ''] = s.split(','); return parseInt(i || '0', 10) * 100 + parseInt((f + '00').slice(0, 2), 10); }
  return Math.min(99999999, parseInt(s, 10) || 0);
}
/** peso que dá o valor pedido ("me vê R$ 5 de tomate") */
export const kgForValue = (cents: number, pricePerKg: number) => (pricePerKg > 0 ? Math.round((cents * 1000) / pricePerKg) : 0);
/** valor de uma quantidade (milésimos) a um preço */
export const lineValue = (qty: number, price: number) => Math.round((price * qty) / 1000);
/** texto inicial do teclado para editar uma quantidade já existente */
export const qtyToEntry = (qty: number, kg: boolean) => (kg ? formatKg(qty) : String(Math.round(qty / 1000)));
