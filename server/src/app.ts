import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { z, ZodError } from 'zod';
import { openDb, DB } from './db';
import { seed } from './seed';
import { AppError, bad, forbidden } from './errors';
import { AuthUser, login, userFromToken, requireRole, hashPin, authorizeManager } from './auth';
import { audit } from './audit';
import { getSettings, updateSettings } from './settings';
import * as products from './services/products';
import * as stock from './services/stock';
import * as cash from './services/cash';
import * as sales from './services/sales';
import * as customers from './services/customers';
import * as reports from './services/reports';
import * as receipt from './services/receipt';
import * as purchases from './services/purchases';
import { PAYMENT_METHODS, LOSS_REASONS, UNITS, ROLES, BRAND } from '@folha/shared';

declare module 'fastify' {
  interface FastifyRequest { user: AuthUser; terminal: string }
}

export interface AppOptions { dbPath: string; webDist?: string | null; logger?: boolean; seed?: boolean; backupDir?: string }

const money = z.number().int();
const discount = z.object({ type: z.enum(['pct', 'valor']), value: z.number().int().min(0) }).nullable().optional();
const pin = z.string().regex(/^\d{4}$/, 'PIN deve ter 4 dígitos');
const optPin = z.string().optional().nullable();
const today = () => {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const dateRange = (q: any) => {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const from = re.test(q?.from ?? '') ? q.from : today();
  const to = re.test(q?.to ?? '') ? q.to : from;
  return { from, to };
};
function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> { return schema.parse(data ?? {}); }
const idParam = (req: FastifyRequest) => {
  const id = Number((req.params as any).id);
  if (!Number.isInteger(id) || id <= 0) throw bad('Id inválido.');
  return id;
};

export function buildApp(opts: AppOptions): { app: FastifyInstance; db: DB } {
  const db = openDb(opts.dbPath);
  if (opts.seed !== false) seed(db);
  const app = Fastify({ logger: opts.logger ? { level: 'info' } : false, bodyLimit: 5 * 1024 * 1024 });
  const backupDir = opts.backupDir ?? path.join(path.dirname(opts.dbPath === ':memory:' ? process.cwd() + '/x' : opts.dbPath), 'backups');

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.message, code: err.code });
    if (err instanceof ZodError) {
      const i = err.issues[0];
      return reply.status(400).send({ error: `${i.path.join('.') || 'dados'}: ${i.message}`, code: 'VALIDACAO' });
    }
    const e = err as any;
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.message, code: 'REQUISICAO' });
    app.log.error(err);
    return reply.status(500).send({ error: 'Erro interno: ' + e.message, code: 'INTERNO' });
  });

  const PUBLIC = new Set(['/api/health', '/api/auth/users', '/api/auth/login', '/api/store']);
  app.addHook('onRequest', async (req) => {
    req.terminal = String(req.headers['x-terminal'] ?? 'CAIXA-01').slice(0, 30) || 'CAIXA-01';
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/') || PUBLIC.has(url)) return;
    const h = req.headers.authorization;
    const token = h?.startsWith('Bearer ') ? h.slice(7) : (req.query as any)?.token;
    const u = userFromToken(db, token);
    if (!u) throw new AppError(401, 'Entre com seu PIN.', 'SEM_LOGIN');
    req.user = u;
  });
  const mgr = (req: FastifyRequest) => requireRole(req.user, ['admin', 'gerente']);
  const admin = (req: FastifyRequest) => requireRole(req.user, ['admin']);

  // ---------- sistema / auth ----------
  app.get('/api/health', async () => ({ ok: true, app: BRAND.name, time: new Date().toISOString() }));
  app.get('/api/store', async () => { const s = getSettings(db); return { name: s.name }; });
  app.get('/api/auth/users', async () => db.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY id').all());
  app.post('/api/auth/login', async (req) => {
    const b = parse(z.object({ user_id: z.number().int(), pin: z.string() }), req.body);
    const r = login(db, b.user_id, b.pin);
    if (!r) { audit(db, b.user_id, 'LOGIN_FALHOU', 'user', b.user_id); throw new AppError(401, 'PIN errado. Tente de novo.', 'PIN_ERRADO'); }
    audit(db, r.user.id, 'LOGIN', 'user', r.user.id, { terminal: req.terminal });
    return r;
  });
  app.post('/api/auth/logout', async (req) => {
    const h = req.headers.authorization?.slice(7);
    if (h) db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(h);
    return { ok: true };
  });
  app.get('/api/auth/me', async (req) => ({ user: req.user, terminal: req.terminal }));
  app.post('/api/auth/check-manager', async (req) => {
    const b = parse(z.object({ pin: z.string() }), req.body);
    const by = authorizeManager(db, { ...req.user, role: 'operador' }, b.pin, 'Autorização');
    const u = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(by);
    return { ok: true, user: u };
  });

  // ---------- painel / alertas ----------
  app.get('/api/status', async (req) => {
    const s = cash.getOpenSession(db, req.terminal);
    return {
      store: getSettings(db), terminal: req.terminal, user: req.user,
      session: s ? cash.sessionSummary(db, s.id) : null,
      alerts: { expiring: stock.expiringLots(db), low_stock: stock.lowStock(db) },
      held_count: (db.prepare('SELECT COUNT(*) AS n FROM held_sales WHERE terminal = ?').get(req.terminal) as any).n,
    };
  });

  // ---------- configurações ----------
  app.get('/api/settings', async () => getSettings(db));
  app.put('/api/settings', async (req) => {
    mgr(req);
    const b = parse(z.object({
      name: z.string().min(1), legal_name: z.string(), cnpj: z.string(), address: z.string(), phone: z.string(),
      receipt_footer: z.string(), discount_limit_pct: z.number().int().min(0).max(10000), allow_negative_stock: z.boolean(),
      expiry_alert_days: z.number().int().min(0).max(60), printer_host: z.string(), printer_port: z.number().int().min(1).max(65535),
      scale_label_mode: z.enum(['peso', 'preco']), scale_code_digits: z.number().int().min(4).max(6),
    }).partial(), req.body);
    const s = updateSettings(db, b);
    audit(db, req.user.id, 'CONFIG_ALTERADA', 'store_settings', 1, b);
    return s;
  });

  // ---------- usuários ----------
  app.get('/api/users', async (req) => { mgr(req); return db.prepare('SELECT id, name, role, active, created_at FROM users ORDER BY id').all(); });
  const userBody = z.object({ name: z.string().min(1), role: z.enum(ROLES), pin: pin.optional(), active: z.boolean().optional() });
  app.post('/api/users', async (req) => {
    admin(req);
    const b = parse(userBody, req.body);
    if (!b.pin) throw bad('Informe o PIN de 4 dígitos.');
    const id = Number(db.prepare('INSERT INTO users(name, role, pin_hash, active) VALUES (?,?,?,?)').run(b.name, b.role, hashPin(b.pin), b.active === false ? 0 : 1).lastInsertRowid);
    audit(db, req.user.id, 'USUARIO_CRIADO', 'user', id, { name: b.name, role: b.role });
    return { id };
  });
  app.put('/api/users/:id', async (req) => {
    admin(req);
    const id = idParam(req); const b = parse(userBody, req.body);
    if (id === req.user.id && (b.active === false || b.role !== 'admin')) throw bad('Você não pode tirar o próprio acesso de admin.');
    db.prepare('UPDATE users SET name=?, role=?, active=? WHERE id=?').run(b.name, b.role, b.active === false ? 0 : 1, id);
    if (b.pin) db.prepare('UPDATE users SET pin_hash=? WHERE id=?').run(hashPin(b.pin), id);
    if (b.active === false) db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(id);
    audit(db, req.user.id, 'USUARIO_ALTERADO', 'user', id, { name: b.name, role: b.role, active: b.active, pin_changed: !!b.pin });
    return { ok: true };
  });

  // ---------- produtos ----------
  app.get('/api/categories', async () => products.listCategories(db));
  app.get('/api/products', async (req) => {
    const q = req.query as any;
    return products.listProducts(db, { q: q.q, active: q.active === undefined ? undefined : q.active === '1' || q.active === 'true',
      category_id: q.category_id ? Number(q.category_id) : undefined, limit: q.limit ? Number(q.limit) : undefined,
      deleted: q.deleted === '1' || q.deleted === 'true' });
  });
  app.get('/api/products/lookup', async (req) => {
    const r = products.lookupCode(db, String((req.query as any).code ?? ''));
    if (!r) throw new AppError(404, 'Código não encontrado.', 'NAO_ENCONTRADO');
    return r;
  });
  app.get('/api/products/:id', async (req) => products.getProduct(db, idParam(req)));
  app.get('/api/products/:id/usage', async (req) => { products.getProduct(db, idParam(req)); return products.productUsage(db, idParam(req)); });
  app.delete('/api/products/:id', async (req) => { mgr(req); return products.deleteProduct(db, req.user, idParam(req)); });
  app.post('/api/products/:id/restore', async (req) => { mgr(req); return products.restoreProduct(db, req.user, idParam(req)); });
  const productBody = z.object({
    code: z.string().min(1).max(20), ean: z.string().max(64).nullable().optional(), name: z.string().min(1).max(80),
    category_id: z.number().int(), unit: z.enum(UNITS), price_cents: money.min(0), cost_cents: money.min(0),
    min_stock: z.number().int().min(0), active: z.boolean(), allow_negative: z.boolean().optional(),
    shortcut_pos: z.number().int().min(1).max(24).nullable().optional(), icon: z.string().max(16).optional(),
    ncm: z.string().max(10).nullable().optional(), cfop: z.string().max(5).nullable().optional(), cst: z.string().max(4).nullable().optional(),
    initial_stock: z.number().int().min(0).optional(),
  });
  app.post('/api/products', async (req) => { mgr(req); return products.saveProduct(db, req.user, null, parse(productBody, req.body)); });
  app.put('/api/products/:id', async (req) => { mgr(req); return products.saveProduct(db, req.user, idParam(req), parse(productBody, req.body)); });
  app.get('/api/shortcuts', async () => products.shortcuts(db));
  app.put('/api/shortcuts', async (req) => {
    mgr(req);
    const b = parse(z.object({ slots: z.array(z.object({ pos: z.number().int().min(1).max(24), product_id: z.number().int().nullable() })) }), req.body);
    return products.setShortcuts(db, req.user, b.slots);
  });
  app.get('/api/shortcuts/suggest', async () => products.topSellers(db));

  // ---------- estoque ----------
  app.post('/api/stock/entry', async (req) => {
    mgr(req);
    const b = parse(z.object({ product_id: z.number().int(), qty: z.number().int().positive(), unit_cost_cents: money.min(0).optional(),
      lot_code: z.string().max(30).nullable().optional(), expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')),
      note: z.string().max(200).nullable().optional() }), req.body);
    return stock.stockEntry(db, req.user, { ...b, expiry_date: b.expiry_date || null });
  });
  app.post('/api/stock/adjust', async (req) => {
    const b = parse(z.object({ product_id: z.number().int(), counted_qty: z.number().int(), note: z.string().max(200).nullable().optional(), manager_pin: optPin }), req.body);
    return stock.stockAdjust(db, req.user, b);
  });
  app.post('/api/stock/loss', async (req) => {
    const b = parse(z.object({ product_id: z.number().int(), qty: z.number().int().positive(), reason: z.enum(LOSS_REASONS),
      note: z.string().max(200).nullable().optional(), manager_pin: optPin }), req.body);
    return stock.registerLoss(db, req.user, b);
  });
  app.get('/api/stock/kardex/:id', async (req) => ({ product: products.getProduct(db, idParam(req)), movements: stock.kardex(db, idParam(req)) }));
  app.get('/api/stock/expiring', async (req) => stock.expiringLots(db, (req.query as any).days ? Number((req.query as any).days) : undefined));
  app.get('/api/stock/low', async () => stock.lowStock(db));
  app.get('/api/stock/losses', async (req) => { const r = dateRange(req.query); return stock.listLosses(db, r.from, r.to); });
  app.get('/api/stock/lots/:id', async (req) => db.prepare('SELECT * FROM lots WHERE product_id = ? ORDER BY id DESC').all(idParam(req)));

  // ---------- fornecedores / compras / preço do dia ----------
  const supBody = z.object({ name: z.string().min(1).max(80), phone: z.string().max(40).optional(), doc: z.string().max(30).optional(),
    note: z.string().max(200).optional(), active: z.boolean().optional() });
  app.get('/api/suppliers', async () => purchases.listSuppliers(db));
  app.post('/api/suppliers', async (req) => { mgr(req); return purchases.saveSupplier(db, req.user, null, parse(supBody, req.body)); });
  app.put('/api/suppliers/:id', async (req) => { mgr(req); return purchases.saveSupplier(db, req.user, idParam(req), parse(supBody, req.body)); });
  app.get('/api/purchases', async (req) => { const r = dateRange(req.query); return purchases.listPurchases(db, r.from, r.to); });
  app.get('/api/purchases/:id/items', async (req) => purchases.purchaseItems(db, idParam(req)));
  app.post('/api/purchases', async (req) => {
    mgr(req);
    const b = parse(z.object({ supplier_id: z.number().int().nullable().optional(), note: z.string().max(200).nullable().optional(),
      items: z.array(z.object({ product_id: z.number().int(), qty: z.number().int().positive(), unit_cost_cents: money.min(0).nullable().optional(),
        lot_code: z.string().max(30).nullable().optional(), expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')) })).min(1).max(200) }), req.body);
    return purchases.purchaseEntry(db, req.user, { ...b, items: b.items.map((i) => ({ ...i, expiry_date: i.expiry_date || null })) });
  });
  app.put('/api/prices', async (req) => {
    mgr(req);
    const b = parse(z.object({ items: z.array(z.object({ id: z.number().int(), price_cents: money.min(0) })).max(1000) }), req.body);
    return purchases.pricesUpdate(db, req.user, b.items);
  });

  // ---------- caixa ----------
  app.get('/api/cash/current', async (req) => {
    const s = cash.getOpenSession(db, req.terminal);
    return s ? cash.sessionSummary(db, s.id) : null;
  });
  app.post('/api/cash/open', async (req) => {
    const b = parse(z.object({ opening_float_cents: money.min(0) }), req.body);
    return cash.openSession(db, req.user, req.terminal, b.opening_float_cents);
  });
  app.post('/api/cash/sangria', async (req) => {
    const b = parse(z.object({ amount_cents: money.positive(), note: z.string().max(200).nullable().optional() }), req.body);
    return cash.cashMove(db, req.user, req.terminal, 'SANGRIA', b.amount_cents, b.note);
  });
  app.post('/api/cash/suprimento', async (req) => {
    const b = parse(z.object({ amount_cents: money.positive(), note: z.string().max(200).nullable().optional() }), req.body);
    return cash.cashMove(db, req.user, req.terminal, 'SUPRIMENTO', b.amount_cents, b.note);
  });
  app.post('/api/cash/close', async (req) => {
    const b = parse(z.object({ counted: z.record(z.enum(PAYMENT_METHODS), money.min(0)), note: z.string().max(300).nullable().optional() }), req.body);
    return cash.closeSession(db, req.user, req.terminal, b.counted, b.note);
  });
  app.get('/api/cash/sessions', async () => cash.listSessions(db));
  app.get('/api/cash/sessions/:id', async (req) => cash.sessionSummary(db, idParam(req)));

  // ---------- vendas ----------
  const saleBody = z.object({
    items: z.array(z.object({ product_id: z.number().int(), qty: z.number().int().positive(), discount })).min(1),
    total_discount: discount,
    payments: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amount_cents: money.positive() })).min(1),
    customer_id: z.number().int().nullable().optional(), manager_pin: optPin,
  });
  app.post('/api/sales', async (req) => sales.createSale(db, req.user, req.terminal, parse(saleBody, req.body)));
  app.get('/api/sales', async (req) => { const r = dateRange(req.query); return sales.listSales(db, r.from, r.to, (req.query as any).terminal); });
  app.get('/api/sales/:id', async (req) => sales.getSale(db, idParam(req)));
  app.post('/api/sales/:id/cancel', async (req) => {
    const b = parse(z.object({ reason: z.string().max(200).default(''), manager_pin: optPin }), req.body);
    return sales.cancelSale(db, req.user, req.terminal, idParam(req), b.reason, b.manager_pin);
  });
  app.get('/api/held', async (req) => sales.listHeld(db, req.terminal));
  app.post('/api/held', async (req) => {
    const b = parse(z.object({ label: z.string().max(60).default(''), payload: z.any() }), req.body);
    return sales.holdSale(db, req.user, req.terminal, b.label, b.payload);
  });
  app.post('/api/held/:id/resume', async (req) => sales.resumeHeld(db, req.user, idParam(req)));

  // ---------- cupom ----------
  app.get('/api/sales/:id/receipt', async (req) => receipt.buildReceipt(db, idParam(req)));
  app.get('/api/sales/:id/receipt.txt', async (req, reply) =>
    reply.type('text/plain; charset=utf-8').send(receipt.renderText(receipt.buildReceipt(db, idParam(req))).join('\n')));
  app.get('/api/sales/:id/receipt.html', async (req, reply) =>
    reply.type('text/html; charset=utf-8').send(receipt.renderHtml(receipt.buildReceipt(db, idParam(req)), (req.query as any).print === '1')));
  app.get('/api/sales/:id/receipt.pdf', async (req, reply) => {
    const doc = receipt.buildReceipt(db, idParam(req));
    const buf = await receipt.renderPdf(doc);
    return reply.type('application/pdf').header('content-disposition', `inline; filename="cupom-${idParam(req)}.pdf"`).send(buf);
  });
  app.get('/api/sales/:id/receipt.bin', async (req, reply) => {
    const buf = receipt.renderEscPos(receipt.buildReceipt(db, idParam(req)));
    return reply.type('application/octet-stream').header('content-disposition', `attachment; filename="cupom-${idParam(req)}.bin"`).send(buf);
  });
  app.post('/api/sales/:id/print', async (req) => {
    const s = getSettings(db);
    return receipt.sendToPrinter(s.printer_host, s.printer_port, receipt.renderEscPos(receipt.buildReceipt(db, idParam(req))));
  });
  app.get('/api/cash/sessions/:id/report', async (req) => receipt.buildSessionReport(db, idParam(req)));
  app.get('/api/cash/sessions/:id/report.html', async (req, reply) =>
    reply.type('text/html; charset=utf-8').send(receipt.renderHtml(receipt.buildSessionReport(db, idParam(req)), (req.query as any).print === '1')));
  app.get('/api/cash/sessions/:id/report.pdf', async (req, reply) =>
    reply.type('application/pdf').send(await receipt.renderPdf(receipt.buildSessionReport(db, idParam(req)))));
  app.get('/api/cash/sessions/:id/report.bin', async (req, reply) =>
    reply.type('application/octet-stream').header('content-disposition', `attachment; filename="fechamento-${idParam(req)}.bin"`)
      .send(receipt.renderEscPos(receipt.buildSessionReport(db, idParam(req)), { drawer: false })));
  app.post('/api/cash/sessions/:id/print', async (req) => {
    const s = getSettings(db);
    return receipt.sendToPrinter(s.printer_host, s.printer_port, receipt.renderEscPos(receipt.buildSessionReport(db, idParam(req)), { drawer: false }));
  });
  app.post('/api/printer/test', async (req) => {
    const s = getSettings(db);
    const doc: receipt.ReceiptDoc = { title: 'Teste', lines: [{ k: 'title', text: s.name.toUpperCase() }, { k: 'center', text: 'Teste de impressão — ' + BRAND.name },
      { k: 'center', text: 'Acentuação: ÃÕÇÉÊÍÓÚ ãõçéêíóú' }, { k: 'hr' }] };
    return receipt.sendToPrinter(s.printer_host, s.printer_port, receipt.renderEscPos(doc, { drawer: false }));
  });

  // ---------- clientes / fiado ----------
  app.get('/api/customers', async (req) => customers.listCustomers(db, (req.query as any).q));
  const custBody = z.object({ name: z.string().min(1).max(80), phone: z.string().max(30).optional(), doc: z.string().max(20).optional(),
    credit_limit_cents: money.min(0), active: z.boolean().optional(), note: z.string().max(300).optional() });
  app.post('/api/customers', async (req) => { mgr(req); return customers.saveCustomer(db, req.user, null, parse(custBody, req.body)); });
  app.put('/api/customers/:id', async (req) => { mgr(req); return customers.saveCustomer(db, req.user, idParam(req), parse(custBody, req.body)); });
  app.get('/api/customers/:id/statement', async (req) => customers.customerStatement(db, idParam(req)));
  app.post('/api/customers/:id/charge', async (req) => {
    const b = parse(z.object({ amount_cents: money.positive(), note: z.string().max(200).nullable().optional(), manager_pin: optPin }), req.body);
    return customers.chargeCustomer(db, req.user, idParam(req), b.amount_cents, b.note ?? null, b.manager_pin);
  });
  app.post('/api/customers/:id/receive', async (req) => {
    const b = parse(z.object({ amount_cents: money.positive(), method: z.enum(PAYMENT_METHODS), note: z.string().max(200).nullable().optional() }), req.body);
    return customers.receiveCustomer(db, req.user, req.terminal, idParam(req), b.amount_cents, b.method, b.note);
  });

  // ---------- relatórios ----------
  app.get('/api/reports', async (req) => { const r = dateRange(req.query); return reports.report(db, r.from, r.to); });
  app.get('/api/reports/csv', async (req, reply) => {
    const r = dateRange(req.query);
    const out = reports.reportCsv(db, String((req.query as any).section ?? 'resumo'), r.from, r.to);
    return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${out.filename}"`).send(out.csv);
  });

  // ---------- auditoria / backup ----------
  app.get('/api/audit', async (req) => {
    mgr(req);
    return db.prepare(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`)
      .all(Math.min(1000, Number((req.query as any).limit ?? 200)));
  });
  app.post('/api/backup', async (req) => {
    mgr(req);
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const file = path.join(backupDir, `folha-${stamp}.db`);
    await db.backup(file);
    audit(db, req.user.id, 'BACKUP', 'sistema', null, { file: path.basename(file) });
    return { file: path.basename(file), size: fs.statSync(file).size };
  });
  app.get('/api/backup', async (req) => {
    mgr(req);
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir).filter((f) => f.endsWith('.db')).sort().reverse()
      .map((f) => ({ file: f, size: fs.statSync(path.join(backupDir, f)).size, created_at: fs.statSync(path.join(backupDir, f)).mtime }));
  });
  app.get('/api/backup/:file', async (req, reply) => {
    mgr(req);
    const f = path.basename(String((req.params as any).file));
    const full = path.join(backupDir, f);
    if (!f.endsWith('.db') || !fs.existsSync(full)) throw new AppError(404, 'Backup não encontrado.');
    return reply.type('application/octet-stream').header('content-disposition', `attachment; filename="${f}"`).send(fs.createReadStream(full));
  });

  // ---------- web (produção) ----------
  if (opts.webDist && fs.existsSync(path.join(opts.webDist, 'index.html'))) {
    app.register(fastifyStatic, { root: opts.webDist, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Rota não encontrada.' });
      return reply.type('text/html').sendFile('index.html');
    });
  } else {
    app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8')
      .send('<h1>' + BRAND.name + '</h1><p>Interface não compilada. Rode <code>npm run build</code>.</p>'));
  }
  app.addHook('onClose', async () => { db.close(); });
  return { app, db };
}
