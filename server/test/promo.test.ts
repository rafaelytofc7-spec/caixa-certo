// Promoções (v3.2): preço vigente pelo relógio, volta sozinho ao normal, texto do WhatsApp.
import { describe, it, expect } from 'vitest';
import { promoActive, withPromo, nextPromoChange, parseLocalTs, promoWhatsText, titleCase } from '@folha/shared';

const base = { id: 1, name: 'Tomate LV', unit: 'KG', price_cents: 799, promo_id: 5, promo_price_cents: 599,
  promo_starts_at: '2026-10-02 08:00:00', promo_ends_at: '2026-10-04 20:00:00' };
const at = (s: string) => parseLocalTs(s);

describe('promoções', () => {
  it('vale só dentro do horário', () => {
    expect(promoActive(base, at('2026-10-02 07:59:59'))).toBe(false);
    expect(promoActive(base, at('2026-10-02 08:00:00'))).toBe(true);
    expect(promoActive(base, at('2026-10-04 19:59:00'))).toBe(true);
    expect(promoActive(base, at('2026-10-04 20:00:00'))).toBe(false);
  });
  it('withPromo troca o preço e volta ao normal quando acaba', () => {
    const on: any = withPromo(base, at('2026-10-03 10:00:00'));
    expect(on.price_cents).toBe(599); expect(on.regular_price_cents).toBe(799); expect(on.promo_active).toBe(true);
    const again: any = withPromo(on, at('2026-10-03 11:00:00')); // idempotente
    expect(again.price_cents).toBe(599); expect(again.regular_price_cents).toBe(799);
    const off: any = withPromo(on, at('2026-10-05 09:00:00'));
    expect(off.price_cents).toBe(799); expect(off.promo_active).toBe(false);
  });
  it('ignora promoção com preço maior ou igual ao normal, ou sem promoção', () => {
    expect(promoActive({ ...base, promo_price_cents: 799 }, at('2026-10-03 10:00:00'))).toBe(false);
    expect(promoActive({ ...base, promo_id: null }, at('2026-10-03 10:00:00'))).toBe(false);
    const p = { ...base, promo_id: null }; expect(withPromo(p, at('2026-10-03 10:00:00'))).toBe(p);
  });
  it('nextPromoChange aponta o próximo início/fim', () => {
    expect(nextPromoChange([base], at('2026-10-01 00:00:00'))).toBe(at('2026-10-02 08:00:00'));
    expect(nextPromoChange([base], at('2026-10-03 00:00:00'))).toBe(at('2026-10-04 20:00:00'));
    expect(nextPromoChange([base], at('2026-10-05 00:00:00'))).toBeNull();
  });
  it('texto do WhatsApp no formato da loja', () => {
    expect(titleCase('Hortifruti frutos da roça ')).toBe('Hortifruti Frutos da Roça');
    const t = promoWhatsText('Hortifruti frutos da roça ', [
      { icon: '🍅', name: 'Tomate LV', unit: 'KG', regular_price_cents: 799, promo_price_cents: 599, ends_until: '2026-10-04 20:00:00' },
      { icon: '🍌', name: 'Banana prata', unit: 'KG', regular_price_cents: 650, promo_price_cents: 499, ends_until: '2026-10-03 20:00:00' }], at('2026-10-02 10:00:00'));
    const l = t.split('\n');
    expect(l[0]).toBe('🥬 *Hortifruti Frutos da Roça — Preços*');
    expect(l[1]).toContain('02/10');
    expect(l[3]).toMatch(/^🍌 Banana prata: ~R\$\s?6,50~ \*R\$\s?4,99\/kg\* \(até 03\/10\)$/);
    expect(l[4]).toContain('Tomate LV');
  });
});
