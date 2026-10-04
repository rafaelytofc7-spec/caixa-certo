// v3.2: promoções. O banco manda em cada produto a promoção vigente ou a próxima agendada (promo_*);
// o app decide pelo relógio se ela vale agora — assim a promoção começa/acaba sozinha, até sem internet.
import { formatBRL } from './format';
import { UNIT_LABEL, Unit } from './types';

export interface PromoFields {
  price_cents: number;
  promo_id?: number | null; promo_price_cents?: number | null;
  promo_starts_at?: string | null; promo_ends_at?: string | null;
}
export interface PromoView { promo_active?: boolean; regular_price_cents?: number }

/** "AAAA-MM-DD HH:MM:SS" (horário local, como o app recebe) ou ISO → ms */
export function parseLocalTs(s: string | null | undefined): number {
  if (!s) return NaN;
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? Date.parse(s) : Date.parse(s.replace(' ', 'T'));
}

export function promoActive(p: PromoFields, now = Date.now()): boolean {
  if (p.promo_id == null || p.promo_price_cents == null || p.promo_price_cents <= 0) return false;
  const a = parseLocalTs(p.promo_starts_at); const b = parseLocalTs(p.promo_ends_at);
  return !(a > now) && b > now && p.promo_price_cents < p.price_cents;
}

/** produto com o preço que vale agora: em promoção, price_cents = preço promocional e regular_price_cents = preço normal */
export function withPromo<P extends PromoFields & PromoView>(p: P, now = Date.now()): P {
  const base = p.regular_price_cents != null && p.promo_active ? { ...p, price_cents: p.regular_price_cents } : p;
  if (!promoActive(base, now)) return base.promo_active ? { ...base, promo_active: false, regular_price_cents: undefined } : base;
  return { ...base, promo_active: true, regular_price_cents: base.price_cents, price_cents: base.promo_price_cents! };
}

/** próximo instante (ms) em que alguma promoção começa ou acaba — para o app trocar o preço na hora certa */
export function nextPromoChange(list: PromoFields[], now = Date.now()): number | null {
  let n: number | null = null;
  for (const p of list) for (const t of [parseLocalTs(p.promo_starts_at), parseLocalTs(p.promo_ends_at)])
    if (t > now && (n == null || t < n)) n = t;
  return n;
}

const two = (n: number) => String(n).padStart(2, '0');
export const fmtDayMonth = (ms: number) => { const d = new Date(ms); return `${two(d.getDate())}/${two(d.getMonth() + 1)}`; };
const SMALL = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
export const titleCase = (s: string) => s.trim().toLowerCase().split(/\s+/).map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

export interface PromoLine { icon?: string; name: string; unit: Unit | string; regular_price_cents: number; promo_price_cents: number; ends_until: string }
/** texto pronto para o WhatsApp (formato "🥬 Hortifruti Frutos da Roça — Preços") */
export function promoWhatsText(storeName: string, items: PromoLine[], now = Date.now()): string {
  const un = (u: string) => (u === 'KG' ? 'kg' : UNIT_LABEL[u as Unit] ?? 'un');
  const lines = [...items].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((it) =>
    `${it.icon || '•'} ${it.name}: ~${formatBRL(it.regular_price_cents)}~ *${formatBRL(it.promo_price_cents)}/${un(String(it.unit))}* (até ${fmtDayMonth(parseLocalTs(it.ends_until))})`);
  return [`🥬 *${titleCase(storeName || 'Hortifruti')} — Preços*`, `🔥 Promoções de hoje (${fmtDayMonth(now)})`, '', ...lines, '', 'Válido enquanto durar o estoque. Peça pelo WhatsApp! 🛒'].join('\n');
}
