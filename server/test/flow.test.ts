import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { renderEscPos, buildReceipt, renderText, renderPdf } from '../src/services/receipt';
import { calcSale, parseScaleLabel, ean13Check, parseWeight } from '@folha/shared';

let app: FastifyInstance; let db: any; let dir: string;
const tokens: Record<string, string> = {};
const T = 'CAIXA-TESTE';

async function call(method: string, url: string, who: string, payload?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: payload as any,
    headers: { authorization: `Bearer ${tokens[who]}`, 'x-terminal': T } });
  return { status: res.statusCode, body: res.headers['content-type']?.toString().includes('json') ? res.json() : res.body, raw: res };
}
const productId = (code: string) => (db.prepare('SELECT id FROM products WHERE code = ?').get(code) as any).id;
const stockOf = (code: string) => (db.prepare('SELECT stock_qty FROM products WHERE code = ?').get(code) as any).stock_qty;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folha-'));
  ({ app, db } = buildApp({ dbPath: path.join(dir, 'teste.db') }));
  await app.ready();
  const users = (await app.inject({ method: 'GET', url: '/api/auth/users' })).json() as any[];
  const pins: Record<string, string> = { admin: '1234', gerente: '2580', operador: '1111' };
  for (const u of users) {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { user_id: u.id, pin: pins[u.role] } });
    expect(r.statusCode).toBe(200);
    tokens[u.role] = r.json().token;
  }
});
afterAll(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('regras de cálculo', () => {
  it('linha por peso: round(preço/kg * gramas / 1000)', () => {
    const r = calcSale([{ price_cents: 699, qty: 1250 }]);
    expect(r.total_cents).toBe(874); // 6,99 * 1,25 = 8,7375 -> 8,74
  });
  it('lê peso da balança e digitado', () => {
    expect(parseWeight('1,250')).toBe(1250);
    expect(parseWeight('01.250')).toBe(1250);
    expect(parseWeight('1250')).toBe(1250);
  });
  it('lê etiqueta de balança EAN-13 iniciada em 2', () => {
    const base = '2' + '00101' + '001250';
    const code = base + ean13Check(base);
    expect(parseScaleLabel(code, 5)).toMatchObject({ productCode: '101', value: 1250 });
  });
});

describe('um dia de banca', () => {
  let saleId = 0;
  const tomatoStart = () => 40000;

  it('seed: loja, 3 usuários, cliente fiado, 24 atalhos', async () => {
    const st = await call('GET', '/api/store', 'operador');
    expect(st.body.name).toBe('Banca Demo');
    const sc = await call('GET', '/api/shortcuts', 'operador');
    expect(sc.body.length).toBe(24);
    const kg = db.prepare("SELECT COUNT(*) n FROM products WHERE unit='KG'").get().n;
    expect(kg).toBeGreaterThanOrEqual(30);
  });

  it('não vende com caixa fechado', async () => {
    const r = await call('POST', '/api/sales', 'operador', { items: [{ product_id: productId('101'), qty: 1000 }], payments: [{ method: 'pix', amount_cents: 699 }] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CAIXA_FECHADO');
  });

  it('abre o caixa com fundo de R$ 100,00 (uma sessão por terminal)', async () => {
    const r = await call('POST', '/api/cash/open', 'operador', { opening_float_cents: 10000 });
    expect(r.status).toBe(200);
    expect(r.body.session.status).toBe('ABERTO');
    const again = await call('POST', '/api/cash/open', 'operador', { opening_float_cents: 10000 });
    expect(again.status).toBe(409);
  });

  it('vende 1,250 kg de tomate pago com PIX + dinheiro, com troco', async () => {
    expect(stockOf('101')).toBe(tomatoStart());
    // total = 874; PIX 500 + dinheiro 1000 = 1500 -> troco 626
    const r = await call('POST', '/api/sales', 'operador', {
      items: [{ product_id: productId('101'), qty: 1250 }],
      payments: [{ method: 'pix', amount_cents: 500 }, { method: 'dinheiro', amount_cents: 1000 }],
    });
    expect(r.status).toBe(200);
    saleId = r.body.id;
    expect(r.body.number).toBe(1);
    expect(r.body.total_cents).toBe(874);
    expect(r.body.change_cents).toBe(626);
    expect(r.body.items[0].qty).toBe(1250);
    expect(stockOf('101')).toBe(tomatoStart() - 1250);
    const cur = (await call('GET', '/api/cash/current', 'operador')).body;
    const exp = Object.fromEntries(cur.by_method.map((m: any) => [m.method, m.expected_cents]));
    expect(exp.pix).toBe(500);
    expect(exp.dinheiro).toBe(10000 + 1000 - 626);
    expect(r.body.fiscal.status).toBe('SIMULADO');
  });

  it('troco só em dinheiro: PIX acima do total é recusado', async () => {
    const r = await call('POST', '/api/sales', 'operador', {
      items: [{ product_id: productId('101'), qty: 1000 }], payments: [{ method: 'pix', amount_cents: 1000 }] });
    expect(r.status).toBe(400);
  });

  it('gera cupom 80 mm com "NÃO É DOCUMENTO FISCAL" (texto, ESC/POS e PDF)', async () => {
    const doc = buildReceipt(db, saleId);
    const txt = renderText(doc);
    expect(txt.every((l) => l.length <= 48)).toBe(true);
    expect(txt.join('\n')).toContain('NÃO É DOCUMENTO FISCAL');
    expect(txt.join('\n')).toContain('1,250 kg');
    const bin = renderEscPos(doc);
    expect(bin[0]).toBe(0x1b); expect(bin[1]).toBe(0x40);
    expect(bin.includes(Buffer.from([0x1d, 0x56, 0x42, 0]))).toBe(true);
    const pdf = await renderPdf(doc);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const http = await call('GET', `/api/sales/${saleId}/receipt.bin`, 'operador');
    expect(http.status).toBe(200);
    const pr = await call('POST', `/api/sales/${saleId}/print`, 'operador');
    expect(pr.body.ok).toBe(false); // sem impressora configurada: não derruba
  });

  it('desconto acima do limite exige gerente', async () => {
    const body = { items: [{ product_id: productId('203'), qty: 1000, discount: { type: 'pct', value: 2000 } }],
      payments: [{ method: 'dinheiro', amount_cents: 1000 }] };
    const r = await call('POST', '/api/sales', 'operador', body);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('PRECISA_GERENTE');
    const ok = await call('POST', '/api/sales', 'operador', { ...body, manager_pin: '2580' });
    expect(ok.status).toBe(200);
    expect(ok.body.total_cents).toBe(799); // 9,99 - 20%
    expect(ok.body.discount_authorized_by).toBeTruthy();
  });

  it('lança perda (estragou) com autorização do gerente: baixa estoque e não entra como venda', async () => {
    const before = stockOf('201');
    const salesBefore = db.prepare('SELECT COUNT(*) n FROM sales').get().n;
    const denied = await call('POST', '/api/stock/loss', 'operador', { product_id: productId('201'), qty: 2000, reason: 'estragou' });
    expect(denied.status).toBe(403);
    const r = await call('POST', '/api/stock/loss', 'operador', { product_id: productId('201'), qty: 2000, reason: 'estragou', manager_pin: '2580' });
    expect(r.status).toBe(200);
    expect(stockOf('201')).toBe(before - 2000);
    expect(db.prepare('SELECT COUNT(*) n FROM sales').get().n).toBe(salesBefore);
    const rep = (await call('GET', '/api/reports', 'gerente')).body;
    expect(rep.summary.loss_cost_cents).toBeGreaterThan(0);
    const k = (await call('GET', `/api/stock/kardex/${productId('201')}`, 'gerente')).body;
    expect(k.movements[0].type).toBe('PERDA');
  });

  it('bloqueia estoque negativo por padrão e libera com a flag', async () => {
    const pid = productId('116'); // gengibre 3 kg
    const big = { items: [{ product_id: pid, qty: 5000 }], payments: [{ method: 'dinheiro', amount_cents: 20000 }] };
    const r = await call('POST', '/api/sales', 'operador', big);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('ESTOQUE_INSUFICIENTE');
    await call('PUT', '/api/settings', 'gerente', { allow_negative_stock: true });
    const ok = await call('POST', '/api/sales', 'operador', big);
    expect(ok.status).toBe(200);
    expect(stockOf('116')).toBe(-2000);
    await call('PUT', '/api/settings', 'gerente', { allow_negative_stock: false });
  });

  it('não vende item inativo', async () => {
    db.prepare("UPDATE products SET active = 0 WHERE code = '211'").run();
    const r = await call('POST', '/api/sales', 'operador', { items: [{ product_id: productId('211'), qty: 500 }], payments: [{ method: 'dinheiro', amount_cents: 1000 }] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PRODUTO_INATIVO');
  });

  it('fiado respeita limite e recebimento entra no caixa', async () => {
    const cust = (await call('GET', '/api/customers', 'operador')).body[0];
    expect(cust.name).toBe('Dona Marta');
    const over = await call('POST', '/api/sales', 'operador', { customer_id: cust.id,
      items: [{ product_id: productId('601'), qty: 5000 }], payments: [{ method: 'fiado', amount_cents: 21450 }] });
    expect(over.status).toBe(200); // 214,50 <= 300
    const over2 = await call('POST', '/api/sales', 'operador', { customer_id: cust.id,
      items: [{ product_id: productId('210'), qty: 6000 }], payments: [{ method: 'fiado', amount_cents: 8994 }] });
    expect(over2.status).toBe(400);
    expect(over2.body.code).toBe('LIMITE_FIADO');
    const rec = await call('POST', `/api/customers/${cust.id}/receive`, 'operador', { amount_cents: 5000, method: 'pix' });
    expect(rec.body.balance_cents).toBe(21450 - 5000);
    const st = (await call('GET', `/api/customers/${cust.id}/statement`, 'operador')).body;
    expect(st.entries.length).toBe(2);
  });

  it('sangria e suprimento', async () => {
    const s = await call('POST', '/api/cash/sangria', 'operador', { amount_cents: 5000, note: 'Cofre' });
    expect(s.status).toBe(200);
    const u = await call('POST', '/api/cash/suprimento', 'operador', { amount_cents: 2000 });
    expect(u.body.suprimento_cents).toBe(2000);
    const tooMuch = await call('POST', '/api/cash/sangria', 'operador', { amount_cents: 999999 });
    expect(tooMuch.status).toBe(400);
  });

  it('cancela a venda do tomate (gerente): estorna estoque e caixa', async () => {
    const before = (await call('GET', '/api/cash/current', 'operador')).body;
    const e0 = Object.fromEntries(before.by_method.map((m: any) => [m.method, m.expected_cents]));
    const denied = await call('POST', `/api/sales/${saleId}/cancel`, 'operador', { reason: 'cliente desistiu' });
    expect(denied.status).toBe(403);
    const r = await call('POST', `/api/sales/${saleId}/cancel`, 'operador', { reason: 'cliente desistiu', manager_pin: '2580' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('CANCELADA');
    expect(stockOf('101')).toBe(tomatoStart());
    const after = (await call('GET', '/api/cash/current', 'operador')).body;
    const e1 = Object.fromEntries(after.by_method.map((m: any) => [m.method, m.expected_cents]));
    expect(e1.pix).toBe(e0.pix - 500);
    expect(e1.dinheiro).toBe(e0.dinheiro - (1000 - 626));
    const twice = await call('POST', `/api/sales/${saleId}/cancel`, 'gerente', { reason: 'x' });
    expect(twice.status).toBe(409);
  });

  it('pausa e retoma venda', async () => {
    const h = await call('POST', '/api/held', 'operador', { label: 'Moça do boné', payload: { items: [{ product_id: 1, qty: 500 }] } });
    expect(h.status).toBe(200);
    expect((await call('GET', '/api/held', 'operador')).body.length).toBe(1);
    const r = await call('POST', `/api/held/${h.body.id}/resume`, 'operador');
    expect(r.body.payload.items[0].qty).toBe(500);
    expect((await call('GET', '/api/held', 'operador')).body.length).toBe(0);
  });

  it('fecha o caixa: contado vs esperado por forma', async () => {
    const cur = (await call('GET', '/api/cash/current', 'operador')).body;
    const exp = Object.fromEntries(cur.by_method.map((m: any) => [m.method, m.expected_cents]));
    const counted = { ...exp, dinheiro: exp.dinheiro - 150 }; // faltou R$ 1,50
    const r = await call('POST', '/api/cash/close', 'operador', { counted });
    expect(r.status).toBe(200);
    expect(r.body.session.status).toBe('FECHADO');
    const din = r.body.by_method.find((m: any) => m.method === 'dinheiro');
    expect(din.diff_cents).toBe(-150);
    expect(r.body.counted_total_cents - r.body.expected_total_cents).toBe(-150);
    const rep = await call('GET', `/api/cash/sessions/${r.body.session.id}/report.pdf`, 'gerente');
    expect(rep.status).toBe(200);
    expect((await call('GET', '/api/cash/current', 'operador')).body).toBeNull();
  });

  it('fornecedor + entrada de compra com vários itens e preço do dia em massa', async () => {
    const sups = (await call('GET', '/api/suppliers', 'gerente')).body;
    expect(sups.length).toBe(2);
    expect((await call('POST', '/api/suppliers', 'operador', { name: 'X' })).status).toBe(403);
    const s = (await call('POST', '/api/suppliers', 'gerente', { name: 'Sítio Esperança', phone: '(11) 95555-0000' })).body;
    const tom = stockOf('101'); const ovo = stockOf('401');
    const r = await call('POST', '/api/purchases', 'gerente', { supplier_id: s.id, note: 'NF 123', items: [
      { product_id: productId('101'), qty: 20000, unit_cost_cents: 380 },
      { product_id: productId('401'), qty: 10000, unit_cost_cents: 650, lot_code: 'L-OVO-40', expiry_date: '2099-01-01' }] });
    expect(r.status).toBe(200);
    expect(r.body.items_count).toBe(2);
    expect(r.body.total_cents).toBe(380 * 20 + 650 * 10);
    expect(stockOf('101')).toBe(tom + 20000);
    expect(stockOf('401')).toBe(ovo + 10000);
    const list = (await call('GET', '/api/purchases', 'gerente')).body;
    expect(list[0].supplier_name).toBe('Sítio Esperança');
    expect((await call('GET', `/api/purchases/${r.body.id}/items`, 'gerente')).body.length).toBe(2);
    // compra inválida não deixa nada pela metade
    const bad = await call('POST', '/api/purchases', 'gerente', { supplier_id: s.id, items: [{ product_id: productId('101'), qty: 1000 }, { product_id: 999999, qty: 1000 }] });
    expect(bad.status).toBe(404);
    expect(stockOf('101')).toBe(tom + 20000);
    // preço do dia
    expect((await call('PUT', '/api/prices', 'operador', { items: [] })).status).toBe(403);
    const pr = await call('PUT', '/api/prices', 'gerente', { items: [{ id: productId('209'), price_cents: 299 }, { id: productId('204'), price_cents: 399 }] });
    expect(pr.body.changed).toBe(1);
    expect((db.prepare("SELECT price_cents FROM products WHERE code = '209'").get() as any).price_cents).toBe(299);
  });

  it('relatório do dia e CSV', async () => {
    const rep = (await call('GET', '/api/reports', 'gerente')).body;
    expect(rep.summary.sales_count).toBe(3); // maçã c/ desconto, gengibre, queijo fiado
    expect(rep.summary.canceled_count).toBe(1);
    expect(rep.by_payment.length).toBeGreaterThan(0);
    const csv = await call('GET', '/api/reports/csv?section=produtos', 'gerente');
    expect(csv.status).toBe(200);
    expect(String(csv.body)).toContain('Produto;Unidade');
  });

  it('auditoria registra as ações e backup gera arquivo', async () => {
    const a = (await call('GET', '/api/audit', 'gerente')).body.map((x: any) => x.action);
    for (const k of ['CAIXA_ABERTURA', 'VENDA', 'PERDA', 'VENDA_CANCELADA', 'CAIXA_FECHAMENTO']) expect(a).toContain(k);
    const b = await call('POST', '/api/backup', 'gerente');
    expect(b.status).toBe(200);
    expect(b.body.size).toBeGreaterThan(0);
  });
});
