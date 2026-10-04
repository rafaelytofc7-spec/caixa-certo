// v3.3: digitação esperta de peso/valor e mensagens de encomenda/comprovante.
import { describe, it, expect } from 'vitest';
import { parseKgEntry, kgEntryHint, isGramEntry, parseUnitEntry, parseMoneyEntry, kgForValue, lineValue, qtyToEntry,
  maskPhone, phoneDigits, validPhone, waLink, orderItemsText, orderArrivedText, receiptWhatsText } from '@folha/shared';

describe('peso digitado (kg × gramas)', () => {
  it('interpreta gramas, kg e vírgula', () => {
    expect(parseKgEntry('350')).toBe(350);
    expect(parseKgEntry('1250')).toBe(1250);
    expect(parseKgEntry('1,5')).toBe(1500);
    expect(parseKgEntry('1.5')).toBe(1500);
    expect(parseKgEntry(',350')).toBe(350);
    expect(parseKgEntry('0,75')).toBe(750);
    expect(parseKgEntry('2')).toBe(2000);
    expect(parseKgEntry('12')).toBe(12000);
    expect(parseKgEntry('050')).toBe(50);
    expect(parseKgEntry('')).toBe(0);
    expect(parseKgEntry(',')).toBe(0);
    expect(parseKgEntry('1,2345')).toBe(1234);
  });
  it('mostra como entendeu', () => {
    expect(kgEntryHint('350')).toBe('350 g = 0,350 kg');
    expect(isGramEntry('350')).toBe(true); expect(isGramEntry('050')).toBe(true); expect(isGramEntry('12')).toBe(false); expect(isGramEntry('1,5')).toBe(false);
    expect(kgEntryHint('2')).toBe('2 = 2 kg');
    expect(kgEntryHint('1,5')).toBe('1,500 kg');
  });
  it('unidades, dinheiro e valor→peso', () => {
    expect(parseUnitEntry('3')).toBe(3000);
    expect(parseUnitEntry('2,5')).toBe(25000);
    expect(parseMoneyEntry('5,00')).toBe(500);
    expect(parseMoneyEntry('5,5')).toBe(550);
    expect(parseMoneyEntry('500')).toBe(500);
    expect(parseMoneyEntry('12')).toBe(12);
    expect(kgForValue(500, 599)).toBe(835);
    expect(lineValue(350, 599)).toBe(210);
    expect(lineValue(835, 599)).toBe(500);
    expect(qtyToEntry(1500, true)).toBe('1,500');
    expect(qtyToEntry(3000, false)).toBe('3');
  });
});

describe('telefone e WhatsApp', () => {
  it('máscara e validação', () => {
    expect(maskPhone('11987654321')).toBe('(11) 98765-4321');
    expect(maskPhone('1133334444')).toBe('(11) 3333-4444');
    expect(maskPhone('5511987654321')).toBe('(11) 98765-4321');
    expect(maskPhone('119')).toBe('(11) 9');
    expect(phoneDigits('+55 (11) 98765-4321')).toBe('11987654321');
    expect(validPhone('(11) 98765-4321')).toBe(true);
    expect(validPhone('98765-4321')).toBe(false);
    expect(waLink('(11) 98765-4321', 'Olá & tchau')).toBe('https://wa.me/5511987654321?text=Ol%C3%A1%20%26%20tchau');
  });
  it('mensagem de encomenda chegou', () => {
    const items = [{ name: 'Tomate LV', unit: 'KG', qty: 1500, line_cents: 898 }, { name: 'Ovo', unit: 'UN', qty: 12000, line_cents: 1200 }, { name: 'Queijo', unit: 'UN', qty: null, line_cents: null }];
    expect(orderItemsText(items)).toBe('1,500 kg de Tomate LV, 12 un de Ovo e Queijo');
    const t = orderArrivedText('HORTIFRUTI FRUTOS DA ROÇA', { customer_name: 'Maria Souza', items: items.slice(0, 1), total_cents: 898, paid: false, delivery: 'a_combinar' });
    expect(t).toBe('Olá Maria! Sua encomenda de 1,500 kg de Tomate LV chegou no Hortifruti Frutos da Roça 🥬.\nVocê vai vir buscar ou prefere entrega?\nTotal R$ 8,98 (a pagar).');
    const p = orderArrivedText('Loja', { customer_name: 'Zé', items: [{ name: 'Queijo', unit: 'UN', qty: null, line_cents: 3500 }], total_cents: 3500, paid: true, delivery: 'entrega', address: 'Rua A, 10' });
    expect(p).toContain('Combinamos a entrega em Rua A, 10?');
    expect(p).toContain('Total R$ 35,00 (já pago).');
  });
  it('comprovante em texto', () => {
    const s = receiptWhatsText('HORTIFRUTI FRUTOS DA ROÇA', {
      number: 42, created_at: '2026-10-02 18:30:12', status: 'CONCLUIDA', total_cents: 1210, change_cents: 790, item_discount_cents: 0, total_discount_cents: 0,
      items: [{ name: 'Tomate LV', unit: 'KG', qty: 350, unit_price_cents: 599, regular_price_cents: 799, promotion_id: 1, total_cents: 210 }, { name: 'Alface', unit: 'UN', qty: 2000, unit_price_cents: 500, regular_price_cents: 500, total_cents: 1000 }],
      payments: [{ method: 'dinheiro', amount_cents: 2000 }], order: { customer_name: 'Maria' },
    });
    expect(s).toContain('Comprovante — Hortifruti Frutos da Roça');
    expect(s).toContain('Venda nº 42 · 02/10/2026 18:30');
    expect(s).toContain('Encomenda de Maria');
    expect(s).toContain('0,350 kg Tomate LV — R$ 2,10 🔥 promo (de R$ 7,99)');
    expect(s).toContain('*Total: R$ 12,10*');
    expect(s).toMatch(/troco R\$ 7,90/);
    expect(s).toContain('Não é documento fiscal');
  });
});
