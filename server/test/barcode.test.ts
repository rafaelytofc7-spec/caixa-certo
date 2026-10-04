// Código de barras: EAN/UPC, etiqueta de balança (EAN-13 com "2"), resolução contra o cadastro e leitor USB (wedge).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import {
  gtinCheckDigit, isValidGtin, upcEtoA, normalizeScan, barcodeCandidates, parseScaleLabel, buildScaleLabel,
  scaleLabelQty, resolveScan, WedgeDetector, sameProductCode, looksLikeCode, ean13Check,
} from '@folha/shared';

const P = [
  { id: 1, code: '101', ean: null, name: 'Tomate', unit: 'KG', price_cents: 699, active: true },
  { id: 2, code: '301', ean: null, name: 'Alface crespa', unit: 'MACO', price_cents: 350, active: true },
  { id: 3, code: '401', ean: '7891000004012', name: 'Ovos brancos', unit: 'DUZIA', price_cents: 1190, active: true },
  { id: 4, code: '0702', ean: '0036000291452', name: 'Produto importado (UPC)', unit: 'UN', price_cents: 1500, active: true },
  { id: 5, code: '950', ean: 'FOLHA-950', name: 'Cesta (Code128)', unit: 'UN', price_cents: 2500, active: true },
];

describe('EAN / UPC', () => {
  it('dígito verificador GTIN (EAN-13, EAN-8, UPC-A)', () => {
    expect(gtinCheckDigit('789100000401')).toBe(2);
    expect(isValidGtin('7891000004012')).toBe(true);
    expect(isValidGtin('7891000004013')).toBe(false);
    expect(isValidGtin('96385074')).toBe(true);      // EAN-8
    expect(isValidGtin('036000291452')).toBe(true);  // UPC-A
    expect(isValidGtin('12345')).toBe(false);
    expect(ean13Check('789100000501')).toBe(9);      // compatível com o seed
  });
  it('UPC-E expande para UPC-A', () => {
    expect(upcEtoA('04252614')).toBe('042100005264');
    expect(upcEtoA('01234565')).toBe('012345000065');
    expect(upcEtoA('99999999')).toBeNull();
  });
  it('limpa o que vem do leitor (Enter, espaços, prefixo AIM)', () => {
    expect(normalizeScan(' 7891000004012\r\n')).toBe('7891000004012');
    expect(normalizeScan(']E07891000004012')).toBe('7891000004012');
    expect(looksLikeCode('7891000004012')).toBe(true);
    expect(looksLikeCode('tomate')).toBe(false);
  });
  it('UPC-A (12) e EAN-13 com zero na frente são o mesmo produto', () => {
    expect(barcodeCandidates('036000291452')).toContain('0036000291452');
    expect(barcodeCandidates('0036000291452')).toContain('036000291452');
  });
});

describe('etiqueta de balança (EAN-13 começando com 2)', () => {
  it('5 dígitos de código + 6 de valor (padrão)', () => {
    const c = buildScaleLabel('101', 1500, 5);
    expect(c).toBe('2001010015006');
    expect(parseScaleLabel(c, 5)).toEqual({ productCode: '101', productCodeRaw: '00101', value: 1500 });
  });
  it('4 dígitos (cobre o layout 2 CCCC 0 VVVVVV D) e 6 dígitos', () => {
    const c4 = buildScaleLabel('101', 1500, 4);
    expect(c4).toMatch(/^20101/);
    expect(parseScaleLabel(c4, 4)).toMatchObject({ productCode: '101', value: 1500 });
    const c6 = buildScaleLabel('101', 1500, 6);
    expect(parseScaleLabel(c6, 6)).toMatchObject({ productCode: '101', value: 1500 });
  });
  it('recusa DV errado, tamanho errado e quem não começa com 2', () => {
    expect(parseScaleLabel('2001010015007', 5)).toBeNull();
    expect(parseScaleLabel('200101001500', 5)).toBeNull();
    expect(parseScaleLabel('7891000004012', 5)).toBeNull();
  });
  it('código do produto sem zeros à esquerda', () => {
    expect(sameProductCode('101', '101')).toBe(true);
    expect(sameProductCode('0101', '101')).toBe(true);
    expect(sameProductCode('1010', '101')).toBe(false);
  });
  it('quantidade: peso em gramas / unidades', () => {
    expect(scaleLabelQty({ unit: 'KG', price_cents: 699 }, 1500, 'peso')).toBe(1500);
    expect(scaleLabelQty({ unit: 'MACO', price_cents: 350 }, 2, 'peso')).toBe(2000);
  });
  it('quantidade: preço na etiqueta vira o peso que dá exatamente esse preço', () => {
    const g = scaleLabelQty({ unit: 'KG', price_cents: 699 }, 1049, 'preco');
    expect(Math.round((699 * g) / 1000)).toBe(1049);
    expect(g).toBe(1501);
    expect(scaleLabelQty({ unit: 'MACO', price_cents: 350 }, 700, 'preco')).toBe(2000);
    expect(scaleLabelQty({ unit: 'KG', price_cents: 0 }, 700, 'preco')).toBe(0);
  });
});

describe('resolveScan (cadastro carregado, funciona offline)', () => {
  it('EAN, código interno, UPC e Code128', () => {
    expect(resolveScan('7891000004012', P)).toMatchObject({ kind: 'product', product: { id: 3 } });
    expect(resolveScan('101', P)).toMatchObject({ kind: 'product', product: { id: 1 }, qty: null });
    expect(resolveScan('036000291452', P)).toMatchObject({ kind: 'product', product: { id: 4 } });
    expect(resolveScan('FOLHA-950', P)).toMatchObject({ kind: 'product', product: { id: 5 } });
  });
  it('etiqueta de balança no modo peso e no modo preço', () => {
    const peso = resolveScan(buildScaleLabel('101', 1250), P, { scale_label_mode: 'peso', scale_code_digits: 5 });
    expect(peso).toMatchObject({ kind: 'label', product: { name: 'Tomate' }, qty: 1250, fromLabel: true });
    const preco = resolveScan(buildScaleLabel('101', 874), P, { scale_label_mode: 'preco', scale_code_digits: 5 });
    expect(preco.kind).toBe('label');
    if (preco.kind === 'label') expect(Math.round((699 * preco.qty) / 1000)).toBe(874);
    const c4 = resolveScan(buildScaleLabel('301', 3, 4), P, { scale_label_mode: 'peso', scale_code_digits: 4 });
    expect(c4).toMatchObject({ kind: 'label', product: { id: 2 }, qty: 3000 });
  });
  it('desconhecido: devolve o código (e o PLU, se for etiqueta) para cadastrar', () => {
    expect(resolveScan('7899999999999', P)).toEqual({ kind: 'unknown', code: '7899999999999', label: null });
    expect(resolveScan(buildScaleLabel('777', 500), P)).toMatchObject({ kind: 'unknown', label: { productCode: '777', value: 500 } });
  });
});

describe('leitor USB em modo teclado (wedge)', () => {
  const feed = (d: WedgeDetector, s: string, t0: number, gap: number) => { let t = t0; for (const ch of s) { d.key(ch, t); t += gap; } return t; };
  it('teclas rápidas + Enter = leitura', () => {
    const d = new WedgeDetector();
    const t = feed(d, '7891000004012', 1000, 8);
    expect(d.enter(t)).toBe('7891000004012');
    expect(d.pending).toBe('');
  });
  it('pessoa digitando devagar não é leitor', () => {
    const d = new WedgeDetector();
    const t = feed(d, '7891000004012', 1000, 140);
    expect(d.enter(t)).toBeNull();
  });
  it('código curto demais não conta', () => {
    const d = new WedgeDetector();
    expect(d.enter(feed(d, '1234', 0, 5))).toBeNull();
  });
  it('o que a pessoa digitou antes não entra na leitura', () => {
    const d = new WedgeDetector();
    feed(d, 'tom', 0, 150);
    expect(d.key('7', 1000).started).toBe(true);
    const t = feed(d, '891000004012', 1008, 8);
    expect(d.enter(t)).toBe('7891000004012');
  });
});

// ---------- servidor local: /api/products/lookup ----------
let app: FastifyInstance; let dir: string; let tok = '';
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folha-bc-'));
  ({ app } = buildApp({ dbPath: path.join(dir, 'bc.db') }));
  await app.ready();
  const users = (await app.inject({ method: 'GET', url: '/api/auth/users' })).json() as any[];
  const admin = users.find((u) => u.role === 'admin');
  tok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { user_id: admin.id, pin: '1234' } })).json().token;
});
afterAll(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const call = async (method: string, url: string, payload?: unknown) => {
  const r = await app.inject({ method: method as any, url, payload: payload as any, headers: { authorization: `Bearer ${tok}`, 'x-terminal': 'BC' } });
  return { status: r.statusCode, body: r.json() };
};

describe('lookup no servidor local', () => {
  it('EAN do seed e etiqueta de peso', async () => {
    const a = await call('GET', '/api/products/lookup?code=7891000004012');
    expect(a.status).toBe(200); expect(a.body.product.name).toBe('Ovos brancos');
    const b = await call('GET', `/api/products/lookup?code=${buildScaleLabel('101', 1500)}`);
    expect(b.body).toMatchObject({ product: { name: 'Tomate' }, qty: 1500, from_label: true });
  });
  it('etiqueta de preço depois de mudar a Config.', async () => {
    const s = (await call('GET', '/api/settings')).body;
    const up = await call('PUT', '/api/settings', { ...s, scale_label_mode: 'preco' });
    expect(up.status).toBe(200);
    const b = await call('GET', `/api/products/lookup?code=${buildScaleLabel('101', 1049)}`);
    expect(b.body.qty).toBe(1501);
    await call('PUT', '/api/settings', { ...s, scale_label_mode: 'peso' });
  });
  it('produto com EAN alfanumérico (Code128) e código desconhecido', async () => {
    const cats = (await call('GET', '/api/categories')).body;
    const novo = await call('POST', '/api/products', { code: '990', ean: 'FOLHA-990-ABC', name: 'Cesta teste', category_id: cats[0].id, unit: 'UN',
      price_cents: 1000, cost_cents: 500, min_stock: 0, active: true, allow_negative: false, shortcut_pos: null, icon: '🧺', ncm: null, cfop: null, cst: null, initial_stock: 0 });
    expect(novo.status).toBe(200);
    const b = await call('GET', '/api/products/lookup?code=FOLHA-990-ABC');
    expect(b.body.product.name).toBe('Cesta teste');
    const c = await call('GET', '/api/products/lookup?code=7899999999999');
    expect(c.status).toBe(404);
  });
});
