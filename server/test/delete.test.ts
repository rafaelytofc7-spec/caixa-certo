import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

let app: FastifyInstance; let db: any; let dir: string;
const tokens: Record<string, string> = {};
async function call(method: string, url: string, who: string, payload?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: payload as any, headers: { authorization: `Bearer ${tokens[who]}`, 'x-terminal': 'DEL' } });
  return { status: res.statusCode, body: res.json() as any };
}
const base = { category_id: 1, unit: 'UN', price_cents: 500, cost_cents: 0, min_stock: 0, active: true, icon: '🍎' };

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folha-del-'));
  ({ app, db } = buildApp({ dbPath: path.join(dir, 'del.db') }));
  await app.ready();
  const users = (await app.inject({ method: 'GET', url: '/api/auth/users' })).json() as any[];
  const pins: Record<string, string> = { admin: '1234', gerente: '2580', operador: '1111' };
  for (const u of users) tokens[u.role] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { user_id: u.id, pin: pins[u.role] } })).json().token;
});
afterAll(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('apagar produto', () => {
  it('sem histórico: apaga de vez, com atalho e estoque inicial', async () => {
    const p = (await call('POST', '/api/products', 'gerente', { ...base, code: '9001', ean: '7891234567895', name: 'Sem uso', shortcut_pos: 24, initial_stock: 3000 })).body;
    expect((await call('GET', `/api/products/${p.id}/usage`, 'operador')).body).toMatchObject({ has_history: false, sales: 0 });
    const r = await call('DELETE', `/api/products/${p.id}`, 'gerente');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: 'hard', name: 'Sem uso' });
    expect(db.prepare('SELECT COUNT(*) n FROM products WHERE id = ?').get(p.id).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM stock_movements WHERE product_id = ?').get(p.id).n).toBe(0);
    expect((await call('GET', '/api/shortcuts', 'operador')).body.some((s: any) => s.id === p.id)).toBe(false);
    // código e EAN livres
    expect((await call('POST', '/api/products', 'gerente', { ...base, code: '9001', ean: '7891234567895', name: 'Reuso' })).status).toBe(200);
    const audit = db.prepare("SELECT details FROM audit_log WHERE action = 'PRODUTO_APAGADO' AND entity_id = ?").get(p.id);
    expect(JSON.parse(audit.details)).toMatchObject({ name: 'Sem uso', modo: 'apagado de vez' });
  });

  it('com histórico: some das telas, mantém nome nas vendas e libera código/EAN', async () => {
    const p = (await call('POST', '/api/products', 'gerente', { ...base, code: '9002', ean: '7894900011517', name: 'Vendido', shortcut_pos: 23, initial_stock: 10000 })).body;
    expect((await call('POST', '/api/cash/open', 'operador', { opening_float_cents: 0 })).status).toBe(200);
    const sale = await call('POST', '/api/sales', 'operador', { items: [{ product_id: p.id, qty: 1000 }], payments: [{ method: 'pix', amount_cents: 500 }] });
    expect(sale.status).toBe(200);
    expect((await call('GET', `/api/products/${p.id}/usage`, 'operador')).body).toMatchObject({ has_history: true, sales: 1 });

    expect((await call('DELETE', `/api/products/${p.id}`, 'operador')).status).toBe(403);
    const r = await call('DELETE', `/api/products/${p.id}`, 'admin');
    expect(r.body).toMatchObject({ mode: 'soft' });
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(p.id);
    expect(row).toMatchObject({ active: 0, shortcut_pos: null, code: `9002~${p.id}`, ean: `7894900011517~${p.id}` });
    expect(row.deleted_at).toBeTruthy();

    const list = (await call('GET', '/api/products', 'operador')).body as any[];
    expect(list.some((x) => x.id === p.id)).toBe(false);
    expect((await call('GET', '/api/products?q=Vendido', 'operador')).body).toHaveLength(0);
    expect((await call('GET', '/api/products/lookup?code=7894900011517', 'operador')).status).toBe(404);
    expect((await call('GET', '/api/products/lookup?code=9002', 'operador')).status).toBe(404);
    expect((await call('GET', '/api/shortcuts', 'operador')).body.some((s: any) => s.id === p.id)).toBe(false);
    expect((await call('GET', '/api/shortcuts/suggest', 'operador')).body.some((s: any) => s.id === p.id)).toBe(false);
    const del = (await call('GET', '/api/products?deleted=1', 'gerente')).body as any[];
    expect(del.find((x) => x.id === p.id)).toMatchObject({ original_code: '9002', original_ean: '7894900011517' });
    // venda antiga mantém o nome
    const s = (await call('GET', `/api/sales/${sale.body.id}`, 'operador')).body;
    expect(JSON.stringify(s)).toContain('Vendido');
    // não pode editar nem apagar de novo
    expect((await call('PUT', `/api/products/${p.id}`, 'gerente', { ...base, code: '9002x', name: 'X' })).status).toBe(404);
    expect((await call('DELETE', `/api/products/${p.id}`, 'gerente')).status).toBe(404);

    // restaurar: código livre volta; EAN tomado → volta sem EAN
    await call('POST', '/api/products', 'gerente', { ...base, code: '9003', ean: '7894900011517', name: 'Novo com o EAN' });
    expect((await call('POST', `/api/products/${p.id}/restore`, 'operador')).status).toBe(403);
    const back = (await call('POST', `/api/products/${p.id}/restore`, 'gerente')).body;
    expect(back).toMatchObject({ code: '9002', ean: null, active: true, deleted_at: null });
    expect(back.warning).toContain('7894900011517');
    expect((await call('GET', '/api/products/lookup?code=9002', 'operador')).body.product.id).toBe(p.id);
    expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action IN ('PRODUTO_APAGADO','PRODUTO_RESTAURADO') AND entity_id = ?").get(p.id).n).toBe(2);
  });
});
