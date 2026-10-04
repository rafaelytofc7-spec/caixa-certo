// Código de barras: validação (EAN/UPC), etiqueta de balança (EAN-13 que começa com "2"),
// e o detector de leitor USB/teclado ("keyboard wedge"). Puro (sem DOM) para rodar no navegador, no servidor e nos testes.
import type { Unit } from './types';

/** Dígito verificador GTIN (EAN-8, UPC-A/EAN-12, EAN-13, GTIN-14): recebe os dígitos SEM o DV. */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}
/** true se é um EAN-8, UPC-A (12), EAN-13 ou GTIN-14 com DV certo. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** UPC-E (8 dígitos, começa com 0 ou 1) → UPC-A (12 dígitos). null se não for UPC-E válido. */
export function upcEtoA(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const ns = code[0]; const d = code.slice(1, 7); const check = code[7];
  const last = d[5];
  let body: string;
  if ('012'.includes(last)) body = d.slice(0, 2) + last + '0000' + d.slice(2, 5);
  else if (last === '3') body = d.slice(0, 3) + '00000' + d.slice(3, 5);
  else if (last === '4') body = d.slice(0, 4) + '00000' + d[4];
  else body = d.slice(0, 5) + '0000' + last;
  const a = ns + body + check;
  return isValidGtin(a) ? a : null;
}

/** Limpa o que veio do leitor/câmera: tira espaços, Enter/Tab e prefixo de simbologia AIM (]E0, ]C1, ]Q1…). */
export function normalizeScan(raw: string): string {
  let c = String(raw ?? '').replace(/[\r\n\t\u0000-\u001f]/g, '').trim();
  if (/^\][A-Za-z]\d/.test(c)) c = c.slice(3);
  return c.trim();
}

/** Parece um código de barras/código interno (e não um nome ou peso)? */
export const looksLikeCode = (s: string) => /^[0-9A-Za-z\-._/]{4,64}$/.test(s) && /\d/.test(s);

/**
 * Formas equivalentes de um código para procurar no cadastro: o próprio código,
 * UPC-A (12) ⇄ EAN-13 com zero na frente, UPC-E expandido e GTIN-14 com zero na frente.
 */
export function barcodeCandidates(code: string): string[] {
  const c = normalizeScan(code);
  const out = [c];
  if (/^\d{12}$/.test(c)) out.push('0' + c);
  if (/^0\d{12}$/.test(c)) out.push(c.slice(1));
  if (/^0\d{13}$/.test(c)) out.push(c.slice(1));
  const a = upcEtoA(c);
  if (a) out.push(a, '0' + a);
  return [...new Set(out)];
}

/** Dígito verificador EAN-13 (mantido por compatibilidade) */
export function ean13Check(first12: string): number {
  return gtinCheckDigit(first12.slice(0, 12));
}

export type ScaleMode = 'peso' | 'preco';
/**
 * Etiqueta de balança (EAN-13 iniciado em "2"): 2 + código do produto (codeDigits) + valor + DV.
 *  - codeDigits 5 (padrão): 2 CCCCC VVVVVV D  → valor com 6 dígitos
 *  - codeDigits 4:          2 CCCC VVVVVVV D  → (cobre também o layout "2 CCCC 0 VVVVVV D" das Toledo/Filizola)
 *  - codeDigits 6:          2 CCCCCC VVVVV D
 * O valor é peso em gramas (mode 'peso') ou preço total em centavos (mode 'preco').
 * productCode sai sem zeros à esquerda ("00101" → "101"), que é como o código (PLU) fica no cadastro.
 */
export function parseScaleLabel(code: string, codeDigits = 5): { productCode: string; productCodeRaw: string; value: number } | null {
  const c = normalizeScan(code);
  if (!/^2\d{12}$/.test(c)) return null;
  if (gtinCheckDigit(c.slice(0, 12)) !== Number(c[12])) return null;
  const n = Math.min(6, Math.max(4, Math.round(codeDigits) || 5));
  const raw = c.slice(1, 1 + n);
  const productCode = String(parseInt(raw, 10));
  const value = parseInt(c.slice(1 + n, 12), 10);
  return { productCode, productCodeRaw: raw, value };
}

/** Monta uma etiqueta de balança (para testes e para o "testar etiqueta" da Config.). */
export function buildScaleLabel(productCode: string | number, value: number, codeDigits = 5): string {
  const n = Math.min(6, Math.max(4, codeDigits));
  const body = '2' + String(productCode).padStart(n, '0').slice(-n) + String(Math.round(value)).padStart(11 - n, '0').slice(-(11 - n));
  return body + gtinCheckDigit(body);
}

/** O código (PLU) do cadastro bate com o da etiqueta? Compara sem zeros à esquerda ("0101" = "101"). */
export const sameProductCode = (productCode: string | null | undefined, labelCode: string) =>
  !!productCode && (productCode === labelCode || productCode.replace(/^0+(?=\d)/, '') === labelCode.replace(/^0+(?=\d)/, ''));

/**
 * Quantidade da venda (milésimos: gramas para KG, un×1000 para os outros) a partir do valor da etiqueta.
 *  - peso: KG → gramas; unidade → o valor é a quantidade de unidades.
 *  - preço: KG → gramas que dão exatamente esse preço (quando existe), senão o mais próximo;
 *           unidade → nº de unidades = preço ÷ preço unitário (mínimo 1).
 */
export function scaleLabelQty(product: { unit: Unit | string; price_cents: number }, value: number, mode: ScaleMode): number {
  const kg = product.unit === 'KG';
  if (mode === 'peso') return kg ? value : Math.max(1, value) * 1000;
  const price = product.price_cents;
  if (!(price > 0)) return 0;
  if (!kg) return Math.max(1, Math.round(value / price)) * 1000;
  const g0 = Math.round((value * 1000) / price);
  for (const d of [0, -1, 1, -2, 2, -3, 3]) {
    const g = g0 + d;
    if (g > 0 && Math.round((price * g) / 1000) === value) return g;
  }
  return g0;
}

export interface ScanProduct { id: number; code: string; ean: string | null; unit: Unit | string; price_cents: number; active?: boolean }
export type ScanResult<P extends ScanProduct> =
  | { kind: 'product'; product: P; qty: number | null; fromLabel: false; code: string }
  | { kind: 'label'; product: P; qty: number; fromLabel: true; value: number; mode: ScaleMode; code: string }
  | { kind: 'unknown'; code: string; label: { productCode: string; value: number } | null };

/**
 * Resolve um código lido (câmera, leitor USB ou digitado) com a lista de produtos já carregada:
 * 1) código interno ou EAN exatos (com as formas equivalentes UPC/EAN); 2) etiqueta de balança (começa com 2).
 * Não acessa rede: funciona offline.
 */
export function resolveScan<P extends ScanProduct>(raw: string, products: P[], settings?: { scale_label_mode?: ScaleMode; scale_code_digits?: number } | null): ScanResult<P> {
  const code = normalizeScan(raw);
  const cands = barcodeCandidates(code);
  const direct = products.find((p) => cands.includes(p.ean ?? '\u0000')) ?? products.find((p) => p.code === code);
  if (direct) return { kind: 'product', product: direct, qty: null, fromLabel: false, code };
  const lbl = parseScaleLabel(code, settings?.scale_code_digits ?? 5);
  if (lbl) {
    const p = products.find((x) => sameProductCode(x.code, lbl.productCode));
    const mode: ScaleMode = settings?.scale_label_mode === 'preco' ? 'preco' : 'peso';
    if (p) return { kind: 'label', product: p, qty: scaleLabelQty(p, lbl.value, mode), fromLabel: true, value: lbl.value, mode, code };
    return { kind: 'unknown', code, label: { productCode: lbl.productCode, value: lbl.value } };
  }
  return { kind: 'unknown', code, label: null };
}

/**
 * Leitor USB/Bluetooth em modo teclado: os caracteres chegam muito rápido (poucos ms entre teclas) e terminam com Enter.
 * Uma pessoa digitando leva 80–250 ms entre teclas. Alimente com cada tecla (key + horário) e ele diz quando foi uma leitura.
 */
export class WedgeDetector {
  private buf = '';
  private first = 0;
  private last = 0;
  constructor(public opts: { minLength?: number; maxGapMs?: number; maxAvgMs?: number } = {}) {}
  get minLength() { return this.opts.minLength ?? 6; }
  get maxGapMs() { return this.opts.maxGapMs ?? 60; }
  get maxAvgMs() { return this.opts.maxAvgMs ?? 35; }
  /** true quando a tecla começa uma rajada nova (dá para guardar o estado da tela antes dela). */
  key(k: string, t: number): { started: boolean } {
    let started = false;
    if (!this.buf || t - this.last > this.maxGapMs) { this.buf = ''; this.first = t; started = true; }
    this.buf += k; this.last = t;
    return { started };
  }
  /** Enter: devolve o código se a rajada parece leitor; senão null. Sempre zera o buffer. */
  enter(t: number): string | null {
    const b = this.buf; const n = b.length;
    const ok = n >= this.minLength && t - this.last <= this.maxGapMs * 2 && (this.last - this.first) / Math.max(1, n - 1) <= this.maxAvgMs;
    this.reset();
    return ok ? b : null;
  }
  reset() { this.buf = ''; this.first = 0; this.last = 0; }
  get pending() { return this.buf; }
}
