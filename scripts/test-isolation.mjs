// Teste de isolamento entre lojas, bloqueio e painel — direto pela API REST do Supabase (sem a tela).
// Cria lojas de teste A e B + um super admin de teste, confere tudo e APAGA o que criou no fim.
// Tudo que uma loja/visitante faz vai pela API pública (chave anon + login). Só a preparação (criar o super admin de teste,
// tentar burlar o banco) e a limpeza usam SQL direto como postgres.
//
// Uso: SB_URL=https://<ref>.supabase.co SB_ANON=<chave anon> \
//      DB_HOST=aws-0-sa-east-1.pooler.supabase.com DB_USER=postgres.<ref> DB_PASSWORD_FILE=.secrets/db.txt node scripts/test-isolation.mjs
// Local: SB_URL=http://127.0.0.1:54320 SB_ANON=... DB_HOST=127.0.0.1 DB_PORT=54329 DB_USER=postgres DB_PASSWORD_FILE=... DB_SSL=0
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pg; try { pg = require('pg'); } catch { pg = require('/workspace/pgtest/node_modules/pg'); }

const FORBIDDEN = ['cprtigvovwbmigxbosac']; // Folha Caixa (dados reais) — nunca
const URL_ = process.env.SB_URL, ANON = process.env.SB_ANON;
if (!URL_ || !ANON || !process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD_FILE) { console.error('Faltam SB_URL, SB_ANON, DB_HOST, DB_USER, DB_PASSWORD_FILE.'); process.exit(1); }
if (FORBIDDEN.some((f) => URL_.includes(f) || process.env.DB_USER.includes(f))) { console.error('Recusado: projeto do Folha Caixa.'); process.exit(1); }
const db = new pg.Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, database: 'postgres',
  password: fs.readFileSync(process.env.DB_PASSWORD_FILE, 'utf8').trim(), ssl: process.env.DB_SSL === '0' ? false : { rejectUnauthorized: false } });
await db.connect();
const sql = async (q, params = []) => (await db.query(q, params)).rows;
const sqlTry = async (q, params = []) => { try { return { ok: true, rows: await sql(q, params) }; } catch (e) { return { ok: false, error: e.message }; } };
const STORE_DOMAIN = 'lojas.caixacerto.invalid';
const ADMIN_DOMAIN = 'admin.caixacerto.invalid';

// ---------------- util ----------------
const results = []; let failures = 0;
const check = (group, name, ok, info = '') => {
  results.push({ group, name, ok: !!ok, info }); if (!ok) failures++;
  console.log(`${ok ? '  ✔' : '  ✘'} [${group}] ${name}${!ok && info ? ' — ' + String(info).slice(0, 300) : ''}`);
};
const rnd = (n) => crypto.randomBytes(n).toString('hex');
function cpf() {
  const n = Array.from({ length: 9 }, () => crypto.randomInt(10));
  const dv = (arr, w) => { const s = arr.reduce((a, d, i) => a + d * (w - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  n.push(dv(n, 10)); n.push(dv(n, 11)); return n.join('');
}
function cnpj() {
  const n = [...Array.from({ length: 8 }, () => crypto.randomInt(10)), 0, 0, 0, 1];
  const dv = (arr) => { const w = arr.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; const s = arr.reduce((a, d, i) => a + d * w[i], 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
  n.push(dv(n)); n.push(dv(n)); return n.join('');
}
async function http(method, path, { jwt = ANON, body, headers = {} } = {}) {
  const r = await fetch(URL_ + path, { method, headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, ok: r.ok, data: j };
}
const rest = (method, table, q = '', opt = {}) => http(method, `/rest/v1/${table}${q ? '?' + q : ''}`, opt);
const rpc = (fn, args, jwt) => http('POST', `/rest/v1/rpc/${fn}`, { jwt, body: args ?? {} });
// as ações de conta (antes numa Edge Function) agora são RPCs do banco; a resposta é normalizada para {ok, data:{code,error}|resultado}
async function fn(body, jwt = ANON) {
  const { action, ...b } = body;
  const call = {
    signup: ['account_signup', { p_data: b }],
    admin_create_loja: ['account_admin_new_loja', { p_data: b }],
    admin_set_password: ['account_admin_password', { p_loja: b.loja_id, p_usuario: b.usuario, p_password: b.password }],
    create_user: ['account_user_create', { p_token: b.token, p_data: { name: b.name, username: b.username, password: b.password, role: b.role, pin: b.pin } }],
    set_password: ['account_user_password', { p_token: b.token, p_user_id: b.user_id, p_password: b.password }],
  }[action];
  const r = await rpc(call[0], call[1], jwt);
  return r.ok ? r : { ...r, data: { code: r.data?.hint || r.data?.code, error: r.data?.message, raw: r.data } };
}
async function login(email, password) {
  const r = await http('POST', '/auth/v1/token?grant_type=password', { body: { email, password } });
  if (!r.ok) throw new Error('login falhou ' + email + ' ' + JSON.stringify(r.data));
  return r.data.access_token;
}
const errCode = (r) => r.data?.hint || r.data?.code || r.data?.error || r.status;
const denied = (r) => !r.ok && (r.status === 401 || r.status === 403 || r.data?.code === '42501');

// ---------------- dados ----------------
const RUN = rnd(3);
const cleanup = { docs: [], authIds: [] };
const store = (label, doc) => ({ label, doc, user: `dono${RUN}`, pass: 'Teste-' + rnd(8), name: `Loja Teste ${label} ${RUN}` });
const A = store('A', cpf()), B = store('B', cnpj());

async function signup(s) {
  const r = await fn({ action: 'signup', loja_nome: s.name, documento: s.doc, responsavel: `Responsável ${s.label}`, usuario: s.user, senha: s.pass, whatsapp: '11999990000' });
  if (r.ok) { cleanup.docs.push(s.doc); s.loja = r.data.loja.loja_id; }
  return r;
}
async function enter(s, user = s.user, pass = s.pass) {
  const jwt = await login(`${s.doc.toLowerCase()}.${user}@${STORE_DOMAIN}`, pass);
  const r = await rpc('self_login', { p_terminal: 'QA-1' }, jwt);
  if (!r.ok) throw new Error('self_login ' + JSON.stringify(r.data));
  return { jwt, token: r.data.token, user: r.data.user };
}

// cria pelo menos uma linha em TODAS as tabelas de negócio da loja (via RPCs do app)
async function populate(s, who) {
  const T = who.token, J = who.jwt; const ids = {};
  const must = async (name, f, a) => { const r = await rpc(f, a, J); if (!r.ok) throw new Error(`${s.label} ${name}: ${JSON.stringify(r.data)}`); return r.data; };
  await must('settings', 'settings_update', { p_token: T, p_data: { address: `Rua Teste ${s.label}, 1`, receipt_footer: 'Obrigado (teste)' } });
  const cats = (await rest('GET', 'categories', 'select=id,slug&order=id', { jwt: J })).data;
  ids.category = cats[0].id;
  const p1 = await must('produto', 'product_save', { p_token: T, p_id: null, p_data: { code: '9001', name: `Tomate QA ${s.label}`, category_id: ids.category, unit: 'KG', price_cents: 800, cost_cents: 400, initial_stock: 50000, shortcut_pos: 1 } });
  const p2 = await must('produto2', 'product_save', { p_token: T, p_id: null, p_data: { code: '9002', name: `Alface QA ${s.label}`, category_id: ids.category, unit: 'UN', price_cents: 300, cost_cents: 100, initial_stock: 20000 } });
  ids.product = p1.id; ids.product2 = p2.id;
  const sup = await must('fornecedor', 'supplier_save', { p_token: T, p_id: null, p_data: { name: `Fornecedor QA ${s.label}` } });
  ids.supplier = sup.id;
  const pur = await must('compra', 'purchase_entry', { p_token: T, p_data: { supplier_id: sup.id, items: [{ product_id: p1.id, qty: 10000, unit_cost_cents: 420, expiry_date: '2030-01-01', lot_code: 'L1' }] } });
  ids.purchase = pur.id;
  const cust = await must('cliente', 'customer_save', { p_token: T, p_id: null, p_data: { name: `Cliente QA ${s.label}`, phone: '11900000000', credit_limit_cents: 100000 } });
  ids.customer = cust.id;
  const promo = await must('promo', 'promo_save', { p_token: T, p_data: { items: [{ product_id: p2.id, promo_price_cents: 250 }], ends_at: new Date(Date.now() + 86400e3).toISOString() } });
  ids.promotion = promo[0].id;
  const ses = await must('abrir caixa', 'cash_open', { p_token: T, p_terminal: 'QA-1', p_float: 5000 });
  ids.session = ses.session.id;
  const sale = await must('venda', 'sale_create', { p_token: T, p_terminal: 'QA-1', p_data: { items: [{ product_id: p1.id, qty: 1500 }, { product_id: p2.id, qty: 1000 }], payments: [{ method: 'dinheiro', amount_cents: 2000 }], client_uuid: crypto.randomUUID() } });
  ids.sale = sale.id; ids.saleNumber = sale.number;
  const sale2 = await must('venda fiado', 'sale_create', { p_token: T, p_terminal: 'QA-1', p_data: { customer_id: cust.id, items: [{ product_id: p1.id, qty: 1000 }], payments: [{ method: 'fiado', amount_cents: 800 }] } });
  ids.sale2 = sale2.id;
  await must('perda', 'stock_loss', { p_token: T, p_data: { product_id: p1.id, qty: 500, reason: 'estragou' } });
  const held = await must('pausar', 'held_create', { p_token: T, p_terminal: 'QA-1', p_label: 'Pausada QA', p_payload: { items: [] } });
  ids.held = held.id;
  const ord = await must('encomenda', 'order_save', { p_token: T, p_id: null, p_data: { customer_name: 'Cliente Encomenda', phone: '11988887777', items: [{ product_id: p1.id, qty: 2000, line_cents: 1600 }] } });
  ids.order = ord.id;
  // caixa 2 aberto e fechado (gera cash_session_counts)
  const ses2 = await rpc('cash_open', { p_token: T, p_terminal: 'QA-2', p_float: 0 }, J);
  await rpc('cash_close', { p_token: T, p_terminal: 'QA-2', p_counted: {} }, J);
  ids.session2 = ses2.data?.session?.id;
  ids.users = (await rest('GET', 'users', 'select=id', { jwt: J })).data.map((u) => u.id);
  return ids;
}

const BIZ = ['store_settings','users','user_pins','op_sessions','categories','products','lots','suppliers','purchases','stock_movements','losses',
  'customers','cash_sessions','cash_session_counts','cash_movements','sales','sale_items','sale_payments','held_sales','customer_ledger',
  'fiscal_documents','audit_log','promotions','orders','order_items'];
const SECRET = ['user_pins', 'op_sessions'];
const VIEWS = ['v_products','v_products_deleted','v_promotions','v_orders','v_cash_sessions','v_sales_list','v_losses','v_stock_movements','v_held_sales','v_audit','v_purchases'];
const PLAT = ['lojas','loja_usuarios','super_admins','pagamentos','loja_eventos','plataforma_config'];
const ADMIN_RPC = [['admin_me', {}], ['admin_lojas', {}], ['admin_loja', { p_loja: '00000000-0000-0000-0000-000000000000' }],
  ['admin_registrar_pagamento', { p_loja: '00000000-0000-0000-0000-000000000000', p_data: { valor_cents: 1 } }],
  ['admin_bloquear', { p_loja: '00000000-0000-0000-0000-000000000000', p_motivo: 'teste' }],
  ['admin_desbloquear', { p_loja: '00000000-0000-0000-0000-000000000000', p_motivo: 'teste' }],
  ['admin_editar_loja', { p_loja: '00000000-0000-0000-0000-000000000000', p_data: {} }], ['admin_config_salvar', { p_data: {} }]];

let adminUser = null;
try {
  console.log(`Caixa Certo — teste de isolamento (${URL_.replace(/^https?:\/\//, '')}) · rodada ${RUN}`);
  // ---------- cadastro ----------
  console.log('\n# Cadastro (Criar conta da loja)');
  let r = await signup(A); check('cadastro', 'loja A (CPF válido) criada em teste', r.ok && r.data.loja.status === 'teste', JSON.stringify(r.data));
  r = await signup(B); check('cadastro', 'loja B (CNPJ válido) criada', r.ok, JSON.stringify(r.data));
  const bad = (d) => fn({ action: 'signup', loja_nome: 'Loja Inválida', documento: d, responsavel: 'Fulano', usuario: 'fulano' + RUN, senha: 'Senha-12345' });
  r = await bad('123.456.789-00'); check('cadastro', 'recusa CPF com dígito errado', !r.ok && r.data?.code === 'DOC_INVALIDO', JSON.stringify(r.data));
  r = await bad('111.111.111-11'); check('cadastro', 'recusa CPF repetido (111…)', !r.ok && r.data?.code === 'DOC_INVALIDO', JSON.stringify(r.data));
  r = await bad('12.345.678/0001-00'); check('cadastro', 'recusa CNPJ com dígito errado', !r.ok && r.data?.code === 'DOC_INVALIDO', JSON.stringify(r.data));
  r = await fn({ action: 'signup', loja_nome: 'Outra', documento: A.doc, responsavel: 'Fulano', usuario: 'outro' + RUN, senha: 'Senha-12345' });
  check('cadastro', 'recusa documento duplicado', !r.ok && r.data?.code === 'DOC_EXISTE', JSON.stringify(r.data));
  r = await fn({ action: 'signup', loja_nome: 'Outra', documento: B.doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'), responsavel: 'Fulano', usuario: 'outro' + RUN, senha: 'Senha-12345' });
  check('cadastro', 'recusa documento duplicado (com máscara)', !r.ok && r.data?.code === 'DOC_EXISTE', JSON.stringify(r.data));
  // cadastro direto no Supabase Auth (fora do app): ou está desligado, ou o login criado não enxerga nada
  // e não consegue "reservar" o CPF/CNPJ + usuário de uma loja de verdade
  const C = store('C', cpf());
  r = await http('POST', '/auth/v1/signup', { body: { email: `${C.doc}.${C.user}@${STORE_DOMAIN}`, password: 'Senha-12345' } });
  if (!r.ok) check('cadastro', 'cadastro público direto no Auth desligado', true);
  else {
    const sj = r.data?.access_token;
    if (sj) {
      const y = await rpc('minha_loja', {}, sj); check('cadastro', 'login criado direto no Auth não é de nenhuma loja', !y.ok && y.data?.hint === 'SEM_LOJA', JSON.stringify(y.data));
      const y2 = await rest('GET', 'products', 'select=id', { jwt: sj }); check('cadastro', 'login criado direto no Auth não lê dados', y2.ok && y2.data.length === 0, JSON.stringify(y2.data).slice(0, 100));
    } else check('cadastro', 'cadastro direto no Auth fica sem confirmação (sem sessão)', true);
    const sq = await signup(C);
    check('cadastro', 'cadastro “solto” no Auth não bloqueia o CPF/CNPJ + usuário da loja de verdade', sq.ok || !!sj, JSON.stringify(sq.data).slice(0, 150));
  }
  const leftover = await sql(`select id from auth.users where email = $1`, [`${C.doc}.${C.user}@${STORE_DOMAIN}`]);
  for (const u of leftover) cleanup.authIds.push(u.id);
  if (!A.loja || !B.loja) throw new Error('sem as lojas de teste, não dá para continuar');

  // ---------- logins ----------
  const a = await enter(A), b = await enter(B);
  r = await fn({ action: 'create_user', token: a.token, name: 'Operador A', username: `op${RUN}`, password: 'OpSenha-123', role: 'operador', pin: '1234' }, a.jwt);
  check('cadastro', 'dono A cria operador na própria loja', r.ok, JSON.stringify(r.data));
  const aop = await enter(A, `op${RUN}`, 'OpSenha-123');
  r = await fn({ action: 'create_user', token: b.token, name: 'Gerente B', username: `ger${RUN}`, password: 'GerSenha-123', role: 'gerente', pin: '4321' }, b.jwt);
  check('cadastro', 'dono B cria gerente', r.ok, JSON.stringify(r.data));
  r = await fn({ action: 'create_user', token: aop.token, name: 'Intruso', username: `x${RUN}`, password: 'Senha-12345', role: 'admin' }, aop.jwt);
  check('cadastro', 'operador não cria usuários', !r.ok && r.data?.code === 'PROIBIDO', JSON.stringify(r.data));
  r = await fn({ action: 'create_user', token: b.token, name: 'Intruso', username: `y${RUN}`, password: 'Senha-12345', role: 'admin' }, a.jwt);
  check('cadastro', 'dono A não usa o token do caixa de B para criar usuário', !r.ok, JSON.stringify(r.data));

  // ---------- dados ----------
  console.log('\n# Populando as duas lojas (todas as tabelas)');
  const idsA = await populate(A, a); const idsB = await populate(B, b);
  check('dados', 'lojas A e B com dados em todas as tabelas', true);
  const bUsers = (await rest('GET', 'users', 'select=id', { jwt: b.jwt })).data.map((u) => u.id);

  // ---------- isolamento: tabelas ----------
  console.log('\n# Isolamento por tabela (A tentando ler/inserir/alterar/apagar dados de B)');
  for (const [who, cli] of [['dono A', a], ['operador A', aop]]) {
    for (const t of BIZ) {
      const all = await rest('GET', t, 'select=*', { jwt: cli.jwt });
      if (SECRET.includes(t)) {
        check('isolamento', `${who} · ${t}: leitura negada (tabela secreta)`, denied(all), JSON.stringify(all.data));
      } else {
        const rows = all.ok ? all.data : null;
        check('isolamento', `${who} · ${t}: lê só a própria loja`, rows && rows.length > 0 && rows.every((x) => x.loja_id === A.loja), JSON.stringify(all.data).slice(0, 200));
        const fb = await rest('GET', t, `select=*&loja_id=eq.${B.loja}`, { jwt: cli.jwt });
        check('isolamento', `${who} · ${t}: filtro loja_id=B volta vazio`, fb.ok && fb.data.length === 0, JSON.stringify(fb.data).slice(0, 200));
      }
      const ins = await rest('POST', t, '', { jwt: cli.jwt, body: { loja_id: B.loja } });
      check('isolamento', `${who} · ${t}: INSERT negado`, denied(ins), JSON.stringify(ins.data));
      const upd = await rest('PATCH', t, `loja_id=eq.${B.loja}`, { jwt: cli.jwt, body: { loja_id: A.loja } });
      check('isolamento', `${who} · ${t}: UPDATE negado`, denied(upd), JSON.stringify(upd.data));
      const del = await rest('DELETE', t, `loja_id=eq.${B.loja}`, { jwt: cli.jwt });
      check('isolamento', `${who} · ${t}: DELETE negado`, denied(del), JSON.stringify(del.data));
    }
  }
  // views (nem todas têm loja_id: confere pelos ids de B)
  const viewHasB = { v_products: (x) => [idsB.product, idsB.product2].includes(x.id), v_promotions: (x) => x.id === idsB.promotion, v_orders: (x) => x.id === idsB.order,
    v_cash_sessions: (x) => [idsB.session, idsB.session2].includes(x.id), v_sales_list: (x) => [idsB.sale, idsB.sale2].includes(x.id),
    v_losses: (x) => x.loja_id === B.loja, v_stock_movements: (x) => x.loja_id === B.loja, v_held_sales: (x) => x.id === idsB.held,
    v_audit: (x) => x.loja_id === B.loja, v_purchases: (x) => x.id === idsB.purchase, v_products_deleted: (x) => x.loja_id === B.loja };
  for (const v of VIEWS) {
    const r2 = await rest('GET', v, 'select=*', { jwt: a.jwt });
    check('isolamento', `dono A · view ${v}: nada de B`, r2.ok && !r2.data.some(viewHasB[v]), JSON.stringify(r2.data).slice(0, 200));
  }

  // ---------- isolamento: RPCs com ids de B ----------
  console.log('\n# RPCs com ids da loja B (chamadas pela loja A)');
  const T = a.token, J = a.jwt;
  const rpcDenied = async (name, f, args) => { const x = await rpc(f, args, J); check('rpc', `A não consegue: ${name}`, !x.ok, JSON.stringify(x.data).slice(0, 200)); };
  await rpcDenied('ver venda de B (sale_get)', 'sale_get', { p_id: idsB.sale });
  await rpcDenied('ver caixa de B (session_summary)', 'session_summary', { p_session_id: idsB.session });
  await rpcDenied('extrato do fiado de B', 'customer_statement', { p_id: idsB.customer });
  await rpcDenied('alterar produto de B', 'product_save', { p_token: T, p_id: idsB.product, p_data: { code: 'X1', name: 'Hack', category_id: idsA.category, unit: 'KG', price_cents: 1, cost_cents: 0 } });
  await rpcDenied('apagar produto de B', 'product_delete', { p_token: T, p_id: idsB.product });
  await rpcDenied('mudar preço de B (preço do dia)', 'prices_update', { p_token: T, p_items: [{ id: idsB.product, price_cents: 1 }] });
  await rpcDenied('entrada de estoque em produto de B', 'stock_entry', { p_token: T, p_data: { product_id: idsB.product, qty: 1000 } });
  await rpcDenied('ajustar estoque de B', 'stock_adjust', { p_token: T, p_data: { product_id: idsB.product, counted_qty: 0 } });
  await rpcDenied('perda em produto de B', 'stock_loss', { p_token: T, p_data: { product_id: idsB.product, qty: 100, reason: 'queda' } });
  await rpcDenied('vender produto de B', 'sale_create', { p_token: T, p_terminal: 'QA-1', p_data: { items: [{ product_id: idsB.product, qty: 1000 }], payments: [{ method: 'dinheiro', amount_cents: 5000 }] } });
  await rpcDenied('venda fiado no cliente de B', 'sale_create', { p_token: T, p_terminal: 'QA-1', p_data: { customer_id: idsB.customer, items: [{ product_id: idsA.product, qty: 1000 }], payments: [{ method: 'fiado', amount_cents: 800 }] } });
  await rpcDenied('cancelar venda de B', 'sale_cancel', { p_token: T, p_terminal: 'QA-1', p_id: idsB.sale, p_reason: 'x' });
  await rpcDenied('apagar venda de B', 'sale_delete', { p_token: T, p_id: idsB.sale, p_reason: 'teste hack', p_confirm_number: idsB.saleNumber });
  await rpcDenied('lançar fiado no cliente de B', 'customer_charge', { p_token: T, p_id: idsB.customer, p_amount: 100 });
  await rpcDenied('receber fiado do cliente de B', 'customer_receive', { p_token: T, p_terminal: 'QA-1', p_id: idsB.customer, p_amount: 100, p_method: 'pix' });
  await rpcDenied('alterar cliente de B', 'customer_save', { p_token: T, p_id: idsB.customer, p_data: { name: 'Hack', credit_limit_cents: 0 } });
  await rpcDenied('alterar fornecedor de B', 'supplier_save', { p_token: T, p_id: idsB.supplier, p_data: { name: 'Hack' } });
  await rpcDenied('compra com fornecedor de B', 'purchase_entry', { p_token: T, p_data: { supplier_id: idsB.supplier, items: [{ product_id: idsA.product, qty: 1000 }] } });
  await rpcDenied('compra de produto de B', 'purchase_entry', { p_token: T, p_data: { items: [{ product_id: idsB.product, qty: 1000 }] } });
  await rpcDenied('promoção em produto de B', 'promo_save', { p_token: T, p_data: { items: [{ product_id: idsB.product, promo_price_cents: 100 }], ends_at: new Date(Date.now() + 86400e3).toISOString() } });
  await rpcDenied('encerrar promoção de B', 'promo_end', { p_token: T, p_id: idsB.promotion });
  await rpcDenied('retomar venda pausada de B', 'held_resume', { p_token: T, p_id: idsB.held });
  await rpcDenied('alterar encomenda de B', 'order_save', { p_token: T, p_id: idsB.order, p_data: { customer_name: 'x', phone: '11999999999', items: [{ name: 'x', qty: 1000 }] } });
  await rpcDenied('avisar encomenda de B', 'order_notify', { p_token: T, p_id: idsB.order });
  await rpcDenied('concluir encomenda de B', 'order_conclude', { p_token: T, p_terminal: 'QA-1', p_id: idsB.order, p_data: { payments: [{ method: 'dinheiro', amount_cents: 1600 }] } });
  await rpcDenied('cancelar encomenda de B', 'order_cancel', { p_token: T, p_id: idsB.order, p_reason: 'x' });
  await rpcDenied('encomenda com produto de B', 'order_save', { p_token: T, p_id: null, p_data: { customer_name: 'x', phone: '11999999999', items: [{ product_id: idsB.product, qty: 1000 }] } });
  await rpcDenied('alterar usuário de B', 'user_save', { p_token: T, p_id: bUsers[0], p_data: { name: 'Hack', role: 'operador', active: false } });
  await rpcDenied('usar o token do caixa de B', 'op_me', { p_token: b.token });
  await rpcDenied('vender com o token do caixa de B', 'sale_create', { p_token: b.token, p_terminal: 'QA-1', p_data: { items: [{ product_id: idsB.product, qty: 1000 }], payments: [{ method: 'dinheiro', amount_cents: 5000 }] } });
  let x = await rpc('pin_login', { p_user_id: bUsers[bUsers.length - 1], p_pin: '4321', p_terminal: 'QA-1' }, J);
  check('rpc', 'A não entra com PIN de usuário de B', x.ok && x.data?.code === 'PIN_ERRADO', JSON.stringify(x.data));
  x = await rpc('product_usage', { p_id: idsB.product }, J);
  check('rpc', 'uso de produto de B não revela vendas de B', x.ok && x.data.sales === 0 && !x.data.has_history, JSON.stringify(x.data));
  await rpc('shortcuts_set', { p_token: T, p_slots: [{ pos: 2, product_id: idsB.product }] }, J);
  x = await rpc('report', { p_from: '2020-01-01', p_to: '2100-01-01' }, J);
  check('rpc', 'relatório de A só soma vendas de A', x.ok && x.data.summary.sales_count === 2, JSON.stringify(x.data?.summary));
  x = await rpc('app_status', { p_token: T, p_terminal: 'QA-1' }, J);
  check('rpc', 'status de A mostra dados da loja A', x.ok && x.data.store.name === A.name, JSON.stringify(x.data?.store));
  // B continua intacta
  const pb = await rest('GET', 'products', `select=id,price_cents,shortcut_pos,name,deleted_at&id=eq.${idsB.product}`, { jwt: b.jwt });
  check('rpc', 'produto de B intacto (preço, atalho, nome)', pb.ok && pb.data[0]?.price_cents === 800 && pb.data[0]?.shortcut_pos === 1 && !pb.data[0]?.deleted_at && pb.data[0]?.name.startsWith('Tomate QA'), JSON.stringify(pb.data));
  const sb = await rest('GET', 'sales', `select=id,status&id=eq.${idsB.sale}`, { jwt: b.jwt });
  check('rpc', 'venda de B intacta', sb.ok && sb.data[0]?.status === 'FINALIZADA', JSON.stringify(sb.data));
  const ub = await rest('GET', 'users', 'select=id,name,active', { jwt: b.jwt });
  check('rpc', 'usuários de B intactos', ub.ok && ub.data.every((u) => u.active && u.name !== 'Hack'), JSON.stringify(ub.data));

  // ---------- anon ----------
  console.log('\n# Anônimo (sem login)');
  for (const t of [...BIZ, ...PLAT, ...VIEWS]) {
    const y = await rest('GET', t, 'select=*', { jwt: ANON });
    check('anon', `anon não lê ${t}`, denied(y) || (y.ok && y.data.length === 0), JSON.stringify(y.data).slice(0, 120));
  }
  for (const f of ['sale_get', 'sale_create', 'self_login', 'minha_loja', 'report', 'app_status', 'users_list', 'current_loja_id', 'loja_liberada', 'admin_lojas', 'account_signup_loja', 'account_create', 'account_signup_check', 'account_user_create', 'account_user_password', 'account_admin_new_loja', 'account_admin_password', '_auth_create_user', '_auth_set_password']) {
    const y = await rpc(f, {}, ANON);
    check('anon', `anon não executa ${f}`, !y.ok && (y.status === 401 || y.status === 403 || y.status === 404 || y.data?.code === '42501'), `${y.status} ${JSON.stringify(y.data).slice(0, 120)}`);
  }

  // ---------- super admin de teste ----------
  console.log('\n# Painel (super admin) e acesso de lojas ao administrador');
  const adminName = `qaadmin${RUN}`, adminPass = 'Adm-' + rnd(10);
  adminUser = (await sql(`select _auth_create_user($1, $2, '{}'::jsonb) id`, [`${adminName}@${ADMIN_DOMAIN}`, adminPass]))[0].id;
  cleanup.authIds.push(adminUser);
  const ins = await sqlTry(`insert into super_admins(user_id, usuario) values ($1, $2)`, [adminUser, adminName]);
  check('admin', 'super admin de teste criado', ins.ok, ins.error);
  const ADM = await login(`${adminName}@${ADMIN_DOMAIN}`, adminPass);
  x = await rpc('admin_lojas', {}, ADM);
  const la = x.ok && x.data.find((l) => l.id === A.loja);
  check('admin', 'super admin lista lojas com vendas e total do mês', !!la && la.vendas_mes === 2 && la.total_mes_cents > 0 && la.status === 'teste', JSON.stringify(la).slice(0, 300));
  for (const [who, jwt] of [['operador A', aop.jwt], ['dono A', a.jwt], ['dono B', b.jwt]]) {
    for (const [f, args] of ADMIN_RPC) {
      const y = await rpc(f, args, jwt);
      check('admin', `${who} não executa ${f}`, !y.ok && (y.data?.hint === 'PROIBIDO' || y.data?.code === '42501'), JSON.stringify(y.data).slice(0, 150));
    }
    for (const t of PLAT) {
      const y = await rest('GET', t, 'select=*', { jwt });
      check('admin', `${who} não lê ${t}`, denied(y) || (y.ok && y.data.length === 0), JSON.stringify(y.data).slice(0, 150));
    }
    const y1 = await fn({ action: 'admin_create_loja', loja_nome: 'Hack', documento: cpf(), responsavel: 'Hack', usuario: 'hack' + RUN, senha: 'Senha-12345' }, jwt);
    check('admin', `${who} não cria loja pelo painel`, !y1.ok && y1.data?.code === 'PROIBIDO', JSON.stringify(y1.data));
    const y2 = await fn({ action: 'admin_set_password', loja_id: B.loja, usuario: B.user, password: 'Senha-12345' }, jwt);
    check('admin', `${who} não troca senha de outra loja pelo painel`, !y2.ok && y2.data?.code === 'PROIBIDO', JSON.stringify(y2.data));
  }
  for (const [who, jwt] of [['operador A', aop.jwt], ['dono A', a.jwt]]) {
    const y = await rpc('_auth_create_user', { p_email: `z${RUN}@${ADMIN_DOMAIN}`, p_password: 'Senha-12345', p_meta: {} }, jwt);
    check('admin', `${who} não cria login direto (_auth_create_user)`, !y.ok, JSON.stringify(y.data).slice(0, 120));
    const y2 = await rpc('_auth_set_password', { p_uid: adminUser, p_password: 'Senha-12345' }, jwt);
    check('admin', `${who} não troca senha direto (_auth_set_password)`, !y2.ok, JSON.stringify(y2.data).slice(0, 120));
  }
  x = await rpc('minha_loja', {}, ADM);
  check('admin', 'super admin não é membro de nenhuma loja', !x.ok && x.data?.hint === 'SEM_LOJA', JSON.stringify(x.data));
  x = await rest('GET', 'sales', 'select=id', { jwt: ADM });
  check('admin', 'super admin não lê tabelas de venda pela API', x.ok && x.data.length === 0, JSON.stringify(x.data).slice(0, 100));
  x = await sqlTry(`insert into loja_usuarios(user_id, loja_id, usuario, papel) values ($1, $2, $3, 'dono')`, [adminUser, A.loja, 'adm' + RUN]);
  check('admin', 'banco recusa colocar super admin dentro de uma loja', !x.ok, x.error);

  // ---------- bloqueio ----------
  console.log('\n# Bloqueio, vencimento, desbloqueio e pagamento');
  const sell = (cli, ids) => rpc('sale_create', { p_token: cli.token, p_terminal: 'QA-1', p_data: { items: [{ product_id: ids.product, qty: 1000 }], payments: [{ method: 'dinheiro', amount_cents: 800 }] } }, cli.jwt);
  x = await rpc('admin_bloquear', { p_loja: B.loja, p_motivo: 'Falta de pagamento (teste)' }, ADM);
  check('bloqueio', 'super admin bloqueia B', x.ok && x.data.status === 'bloqueada', JSON.stringify(x.data).slice(0, 150));
  x = await sell(b, idsB); check('bloqueio', 'B bloqueada não cria venda', !x.ok && x.data?.hint === 'LOJA_BLOQUEADA', JSON.stringify(x.data));
  x = await rest('GET', 'products', 'select=id', { jwt: b.jwt }); check('bloqueio', 'B bloqueada não lê produtos', x.ok && x.data.length === 0, JSON.stringify(x.data));
  x = await rest('GET', 'sales', 'select=id', { jwt: b.jwt }); check('bloqueio', 'B bloqueada não lê vendas', x.ok && x.data.length === 0, JSON.stringify(x.data));
  x = await rpc('minha_loja', {}, b.jwt); check('bloqueio', 'B vê a própria situação (bloqueada + motivo)', x.ok && x.data.liberada === false && x.data.status === 'bloqueada' && !!x.data.motivo_bloqueio, JSON.stringify(x.data));
  x = await rpc('self_login', { p_terminal: 'QA-1' }, b.jwt); check('bloqueio', 'B bloqueada não abre o caixa', !x.ok && x.data?.hint === 'LOJA_BLOQUEADA', JSON.stringify(x.data));
  x = await fn({ action: 'create_user', token: b.token, name: 'Novo', username: `novo${RUN}`, password: 'Senha-12345', role: 'operador' }, b.jwt);
  check('bloqueio', 'B bloqueada não cria usuário', !x.ok && x.data?.code === 'LOJA_BLOQUEADA', JSON.stringify(x.data));
  x = await sell(a, idsA); check('bloqueio', 'A continua vendendo enquanto B está bloqueada', x.ok, JSON.stringify(x.data).slice(0, 150));
  x = await rpc('admin_desbloquear', { p_loja: B.loja, p_motivo: 'Pagou (teste)', p_status: 'ativa' }, ADM);
  check('bloqueio', 'super admin desbloqueia B', x.ok && x.data.status === 'ativa' && x.data.liberada, JSON.stringify(x.data).slice(0, 150));
  x = await sell(b, idsB); check('bloqueio', 'B desbloqueada volta a vender', x.ok, JSON.stringify(x.data).slice(0, 150));
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const day = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  x = await rpc('admin_editar_loja', { p_loja: B.loja, p_data: { vencimento: day(-1) } }, ADM);
  x = await rpc('minha_loja', {}, b.jwt); check('bloqueio', 'B ativa vencida ontem fica na carência (liberada + aviso)', x.ok && x.data.liberada && x.data.em_carencia, JSON.stringify(x.data));
  x = await sell(b, idsB); check('bloqueio', 'B na carência ainda vende', x.ok, JSON.stringify(x.data).slice(0, 150));
  x = await rpc('admin_editar_loja', { p_loja: B.loja, p_data: { vencimento: day(-10) } }, ADM);
  x = await sell(b, idsB); check('bloqueio', 'B vencida há 10 dias (passou a carência) não vende', !x.ok && x.data?.hint === 'LOJA_BLOQUEADA', JSON.stringify(x.data));
  x = await rpc('admin_editar_loja', { p_loja: A.loja, p_data: { vencimento: day(-1) } }, ADM);
  x = await sell(a, idsA); check('bloqueio', 'A em teste vencido (sem carência) não vende', !x.ok && x.data?.hint === 'LOJA_BLOQUEADA', JSON.stringify(x.data));
  x = await rpc('admin_registrar_pagamento', { p_loja: B.loja, p_data: { valor_cents: 4990, observacao: 'PIX teste' } }, ADM);
  check('bloqueio', 'registrar pagamento de B: +30 dias a partir de hoje e status ativa', x.ok && x.data.vencimento === day(30) && x.data.status === 'ativa' && x.data.pagamentos?.length === 1, JSON.stringify(x.data).slice(0, 200));
  x = await sell(b, idsB); check('bloqueio', 'B volta a vender depois do pagamento', x.ok, JSON.stringify(x.data).slice(0, 150));
  x = await rpc('admin_registrar_pagamento', { p_loja: A.loja, p_data: { valor_cents: 4990, novo_vencimento: day(45) } }, ADM);
  check('bloqueio', 'pagamento de A com data escolhida', x.ok && x.data.vencimento === day(45) && x.data.status === 'ativa', JSON.stringify(x.data).slice(0, 200));
  x = await sell(a, idsA); check('bloqueio', 'A volta a vender depois do pagamento', x.ok, JSON.stringify(x.data).slice(0, 150));
  x = await rest('GET', 'pagamentos', 'select=*', { jwt: b.jwt }); check('bloqueio', 'loja não lê a tabela de pagamentos', denied(x) || (x.ok && x.data.length === 0), JSON.stringify(x.data));
} catch (e) {
  check('execução', 'o teste rodou até o fim', false, e.stack || String(e));
} finally {
  // ---------- limpeza ----------
  console.log('\n# Limpeza');
  try {
    for (const d of cleanup.docs) {
      for (const u of await sql(`select lu.user_id from loja_usuarios lu join lojas l on l.id = lu.loja_id where l.documento = $1`, [d])) cleanup.authIds.push(u.user_id);
      const del = await sql(`delete from lojas where documento = $1 returning id`, [d]);
      check('limpeza', `loja de teste ${d.slice(0, 3)}… apagada`, del.length === 1, JSON.stringify(del));
    }
    const ids = [...new Set(cleanup.authIds)];
    if (ids.length) await sql(`delete from auth.users where id = any($1::uuid[])`, [ids]);
    const leftU = await sql(`select count(*)::int n from auth.users where id = any($1::uuid[])`, [ids]);
    check('limpeza', 'logins de teste apagados', leftU[0].n === 0, JSON.stringify(leftU));
    const left = await sql(`select id from lojas where nome like $1`, [`%${RUN}%`]);
    check('limpeza', 'nenhuma loja de teste sobrou', left.length === 0, JSON.stringify(left));
    const leftAdm = await sql(`select usuario from super_admins where usuario like 'qaadmin%'`);
    check('limpeza', 'nenhum super admin de teste sobrou', leftAdm.length === 0, JSON.stringify(leftAdm));
  } catch (e) { check('limpeza', 'limpeza rodou', false, String(e)); }
  const by = {}; for (const r of results) { by[r.group] ??= { ok: 0, fail: 0 }; by[r.group][r.ok ? 'ok' : 'fail']++; }
  console.log('\nResumo:'); for (const [g, v] of Object.entries(by)) console.log(`  ${g.padEnd(12)} ${v.ok} ok${v.fail ? `, ${v.fail} FALHA(S)` : ''}`);
  console.log(failures ? `\n✘ ${failures} falha(s) de ${results.length} verificações` : `\n✔ ${results.length} verificações, todas passaram`);
  if (process.env.RESULTS_JSON) (await import('node:fs')).writeFileSync(process.env.RESULTS_JSON, JSON.stringify(results, null, 1));
  process.exit(failures ? 1 : 0);
}
