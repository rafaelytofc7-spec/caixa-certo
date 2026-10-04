// Adaptador do modo online: traduz as rotas REST do servidor local (/api/...) para RPCs/views do Supabase.
// Assim as telas são as mesmas nos dois modos.
import { parseScaleLabel, scaleLabelQty, barcodeCandidates, normalizeScan, buildReceiptDoc, buildSessionReportDoc } from '@folha/shared';
import { ApiError, getToken, getTerminal, notifyUnauthorized } from '../api';
import { sb } from './client';
import { localizeDates } from './dates';
import { enqueue, queue, removeQueued, markError, uuid, cacheKey } from './offline';

const STATUS: Record<string, number> = { SEM_LOGIN: 401, SEM_PIN: 401, PRECISA_GERENTE: 403, SEM_PERMISSAO: 403, NAO_ENCONTRADO: 404 };
const NET_RE = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;
export const isNetErr = (e: any) => (e instanceof ApiError && e.code === 'SEM_INTERNET');

/** avisa a interface se o servidor online respondeu (true) ou se a rede caiu (false) */
let lastNet: boolean | null = null;
const net = (ok: boolean) => { if (ok !== lastNet) { lastNet = ok; window.dispatchEvent(new CustomEvent('cc:net', { detail: ok })); } };
function toErr(error: any): ApiError {
  const msg = String(error?.message ?? error ?? 'Erro');
  if (NET_RE.test(msg) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    net(false);
    return new ApiError(0, 'Sem internet. Confira a conexão e tente de novo.', 'SEM_INTERNET');
  }
  net(true);
  const code = error?.hint && /^[A-Z_]+$/.test(error.hint) ? error.hint : error?.code === 'P0001' ? 'REGRA' : (error?.code || 'ERRO');
  if (code === '42501') return new ApiError(403, 'Sem permissão. Entre com usuário e senha.', 'SEM_LOGIN');
  return new ApiError(STATUS[code] ?? 400, msg, code);
}
function handleAuth(e: ApiError) {
  if (e.code === 'SEM_PIN') notifyUnauthorized('pin');
  if (e.code === 'SEM_LOGIN') notifyUnauthorized('store');
  if (e.code === 'LOJA_BLOQUEADA') notifyUnauthorized('blocked');
}
async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}, silent = false): Promise<T> {
  let res;
  try { res = await sb().rpc(fn, args); } catch (e) { throw toErr(e); }
  if (res.error) { const e = toErr(res.error); if (!silent) handleAuth(e); throw e; }
  net(true);
  return localizeDates(res.data) as T;
}
async function q<T = any>(build: (s: ReturnType<typeof sb>) => any): Promise<T> {
  let res;
  try { res = await build(sb()); } catch (e) { throw toErr(e); }
  if (res.error) { const e = toErr(res.error); handleAuth(e); throw e; }
  net(true);
  return localizeDates(res.data) as T;
}

/** lista grande (o Supabase devolve no máximo 1000 linhas por vez): busca em páginas */
async function qAll<T = any>(build: (s: ReturnType<typeof sb>) => any, page = 1000, max = 20000): Promise<T[]> {
  const out: T[] = [];
  for (let at = 0; at < max; at += page) {
    const rows = await q<T[]>((s) => build(s).range(at, at + page - 1));
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

// ---- cache de leitura para abrir o caixa sem internet (só listas usadas na venda) ----
const CACHEABLE = [/^\/api\/products\?active=1$/, /^\/api\/categories$/, /^\/api\/status$/, /^\/api\/auth\/users$/, /^\/api\/store$/, /^\/api\/auth\/me$/, /^\/api\/customers$/];
const ck = cacheKey;

let settingsCache: { at: number; v: any } | null = null;
async function settings() {
  if (settingsCache && Date.now() - settingsCache.at < 30000) return settingsCache.v;
  const v = (await q((s) => s.from('store_settings').select('*').maybeSingle())) ?? { name: '' };
  settingsCache = { at: Date.now(), v };
  return v;
}
const range = (sp: URLSearchParams) => {
  const re = /^\d{4}-\d{2}-\d{2}$/; const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const from = re.test(sp.get('from') ?? '') ? sp.get('from')! : today;
  const to = re.test(sp.get('to') ?? '') ? sp.get('to')! : from;
  return { from, to };
};
const NO_TCP = 'Impressão direta na térmica de rede (porta 9100) não funciona pelo navegador. Use "Imprimir (80 mm)" com a térmica instalada no aparelho, ou baixe o .bin/PDF.';

export async function sbApi(method: string, url: string, body: any): Promise<any> {
  try {
    const r = await route(method, url, body ?? {});
    if (method === 'GET' && CACHEABLE.some((re) => re.test(url))) { try { localStorage.setItem(ck(url), JSON.stringify(r)); } catch { /* cheio */ } }
    return r;
  } catch (e) {
    if (isNetErr(e) && method === 'GET') {
      const c = localStorage.getItem(ck(url));
      if (c) return JSON.parse(c);
    }
    throw e;
  }
}

async function route(method: string, url: string, b: any): Promise<any> {
  const [path, qs] = url.split('?');
  const sp = new URLSearchParams(qs ?? '');
  const seg = path.replace(/^\/api\//, '').split('/');
  const id = Number(seg[1]);
  const tok = getToken(); const term = getTerminal();
  const R = `${method} ${seg[0]}`;

  switch (R) {
    // ---------- auth / sistema ----------
    case 'GET auth':
      if (seg[1] === 'users') return rpc('pin_users', {});
      if (seg[1] === 'me') return { user: await rpc('op_me', { p_token: tok }), terminal: term };
      break;
    case 'POST auth':
      if (seg[1] === 'login') {
        const r = await rpc('pin_login', { p_user_id: b.user_id, p_pin: b.pin, p_terminal: term });
        if (r?.error) throw new ApiError(401, r.error, r.code ?? 'PIN_ERRADO');
        try { localStorage.setItem(ck('/api/auth/me'), JSON.stringify({ user: r.user, terminal: term })); } catch { /* */ }
        return r;
      }
      if (seg[1] === 'logout') {
        // com vendas na fila offline o token precisa continuar valendo para enviá-las
        if (tok && !queue().length) await rpc('pin_logout', { p_token: tok }).catch(() => {});
        return { ok: true };
      }
      break;
    case 'GET store': return { name: (await settings()).name };
    case 'POST sample-products': return rpc('load_sample_products', { p_token: tok });
    case 'GET status': {
      const st = await rpc('app_status', { p_token: tok, p_terminal: term });
      settingsCache = { at: Date.now(), v: st.store };
      return st;
    }
    case 'GET settings': return settings();
    case 'PUT settings': settingsCache = null; return rpc('settings_update', { p_token: tok, p_data: b });

    // ---------- usuários ----------
    case 'GET users': return rpc('users_list', {});
    case 'POST users': {
      const a = await import('./accounts');
      if (seg[1] && seg[2] === 'password') return a.setPassword(id, b.password);
      return a.createUser(b);
    }
    case 'PUT users': return rpc('user_save', { p_token: tok, p_id: id, p_data: b });

    // ---------- fornecedores / compras / preço do dia ----------
    case 'GET suppliers': return q((s) => s.from('suppliers').select('*').order('active', { ascending: false }).order('name'));
    case 'POST suppliers': return rpc('supplier_save', { p_token: tok, p_id: null, p_data: b });
    case 'PUT suppliers': return rpc('supplier_save', { p_token: tok, p_id: id, p_data: b });
    case 'GET purchases': {
      if (seg[1] && seg[2] === 'items') {
        const rows = await q<any[]>((s) => s.from('v_stock_movements').select('product_id, qty, unit_cost_cents, product_name, product_unit').eq('ref_type', 'compra').eq('ref_id', id).order('id'));
        return rows.map((r) => ({ product_id: r.product_id, qty: r.qty, unit_cost_cents: r.unit_cost_cents, name: r.product_name, unit: r.product_unit }));
      }
      const r = range(sp);
      return q((s) => s.from('v_purchases').select('*').gte('local_date', r.from).lte('local_date', r.to).order('id', { ascending: false }));
    }
    case 'POST purchases': return rpc('purchase_entry', { p_token: tok, p_data: b });
    case 'PUT prices': return rpc('prices_update', { p_token: tok, p_items: b.items });

    // ---------- produtos ----------
    case 'GET categories': return q((s) => s.from('categories').select('*').order('id'));
    case 'GET products': {
      if (seg[1] === 'lookup') return lookup(sp.get('code') ?? '');
      if (seg[1] && seg[2] === 'usage') return rpc('product_usage', { p_id: id });
      if (seg[1]) return q((s) => s.from('v_products').select('*').eq('id', id).single());
      if (sp.get('deleted') === '1') return q((s) => s.from('v_products_deleted').select('*').order('deleted_at', { ascending: false }).limit(500));
      return q((s) => {
        let x = s.from('v_products').select('*');
        const a = sp.get('active'); if (a != null) x = x.eq('active', a === '1' || a === 'true');
        const c = sp.get('category_id'); if (c) x = x.eq('category_id', Number(c));
        const t = sp.get('q')?.trim();
        if (t) { const e = t.replace(/[%,()*]/g, ''); x = x.or(`name.ilike.*${e}*,code.eq.${e},ean.eq.${e}`); }
        return x.order('name').limit(Number(sp.get('limit') ?? 500));
      });
    }
    case 'POST products':
      if (seg[1] && seg[2] === 'restore') return rpc('product_restore', { p_token: tok, p_id: id });
      return rpc('product_save', { p_token: tok, p_id: null, p_data: b });
    case 'PUT products': return rpc('product_save', { p_token: tok, p_id: id, p_data: b });
    case 'DELETE products': return rpc('product_delete', { p_token: tok, p_id: id });
    case 'GET shortcuts':
      if (seg[1] === 'suggest') return rpc('top_sellers', {});
      return q((s) => s.from('v_products').select('*').not('shortcut_pos', 'is', null).order('shortcut_pos'));
    case 'PUT shortcuts':
      await rpc('shortcuts_set', { p_token: tok, p_slots: b.slots });
      return q((s) => s.from('v_products').select('*').not('shortcut_pos', 'is', null).order('shortcut_pos'));

    // ---------- estoque ----------
    case 'POST stock':
      if (seg[1] === 'entry') return rpc('stock_entry', { p_token: tok, p_data: { ...b, expiry_date: b.expiry_date || null } });
      if (seg[1] === 'adjust') return rpc('stock_adjust', { p_token: tok, p_data: b });
      if (seg[1] === 'loss') return rpc('stock_loss', { p_token: tok, p_data: b });
      break;
    case 'GET stock': {
      const pid = Number(seg[2]);
      if (seg[1] === 'kardex') {
        const [product, movements] = await Promise.all([
          q((s) => s.from('v_products').select('*').eq('id', pid).single()),
          q((s) => s.from('v_stock_movements').select('*').eq('product_id', pid).order('id', { ascending: false }).limit(200)),
        ]);
        return { product, movements };
      }
      if (seg[1] === 'expiring') return rpc('expiring_lots', { p_days: sp.get('days') ? Number(sp.get('days')) : null });
      if (seg[1] === 'low') {
        const all = await q<any[]>((s) => s.from('products').select('id, name, unit, stock_qty, min_stock, icon').eq('active', true).order('name'));
        return all.filter((p) => p.stock_qty <= p.min_stock);
      }
      if (seg[1] === 'losses') { const r = range(sp); return q((s) => s.from('v_losses').select('*').gte('local_date', r.from).lte('local_date', r.to).order('id', { ascending: false })); }
      if (seg[1] === 'lots') return q((s) => s.from('lots').select('*').eq('product_id', pid).order('id', { ascending: false }));
      break;
    }

    // ---------- caixa ----------
    case 'GET cash': {
      if (seg[1] === 'current') return (await rpc('app_status', { p_token: tok, p_terminal: term })).session;
      if (seg[1] === 'sessions' && seg[2] && seg[3] === 'report') {
        const [st, r] = await Promise.all([settings(), rpc('session_summary', { p_session_id: Number(seg[2]) })]);
        return buildSessionReportDoc(st, r);
      }
      if (seg[1] === 'sessions' && seg[2]) return rpc('session_summary', { p_session_id: Number(seg[2]) });
      if (seg[1] === 'sessions') return q((s) => s.from('v_cash_sessions').select('*').order('id', { ascending: false }).limit(30));
      if (seg[1] === 'book') {
        const r = range(sp);
        return rpc(seg[2] === 'detail' ? 'cash_book_detail' : 'cash_book_days', { p_from: r.from, p_to: r.to });
      }
      break;
    }
    // ---------- promoções (v3.2) ----------
    case 'GET promotions': return q((s) => s.from('v_promotions').select('*').order('starts_at', { ascending: false }).limit(500));
    case 'POST promotions':
      if (seg[1] && seg[2] === 'end') return rpc('promo_end', { p_token: tok, p_id: id });
      return rpc('promo_save', { p_token: tok, p_data: b });
    // ---------- encomendas (v3.3) ----------
    case 'GET orders':
      if (seg[1]) return q((s) => s.from('v_orders').select('*').eq('id', id).single());
      return q((s) => s.from('v_orders').select('*').order('created_at', { ascending: false }).limit(1000));
    case 'POST orders':
      if (seg[1] && seg[2] === 'notify') return rpc('order_notify', { p_token: tok, p_id: id });
      if (seg[1] && seg[2] === 'ready') return rpc('order_ready', { p_token: tok, p_id: id });
      if (seg[1] && seg[2] === 'cancel') return rpc('order_cancel', { p_token: tok, p_id: id, p_reason: b.reason ?? '', p_manager_pin: b.manager_pin ?? null });
      if (seg[1] && seg[2] === 'conclude') return rpc('order_conclude', { p_token: tok, p_terminal: term, p_id: id, p_data: b });
      return rpc('order_save', { p_token: tok, p_id: null, p_data: b });
    case 'PUT orders': return rpc('order_save', { p_token: tok, p_id: id, p_data: b });
    case 'POST cash': {
      if (seg[1] === 'open') return rpc('cash_open', { p_token: tok, p_terminal: term, p_float: b.opening_float_cents });
      if (seg[1] === 'sangria' || seg[1] === 'suprimento')
        return rpc('cash_move', { p_token: tok, p_terminal: term, p_kind: seg[1].toUpperCase(), p_amount: b.amount_cents, p_note: b.note ?? null });
      if (seg[1] === 'close') {
        const n = queue().length;
        if (n) throw new ApiError(409, `Há ${n} venda(s) feitas sem internet esperando envio. Conecte e envie antes de fechar o caixa.`, 'FILA_OFFLINE');
        return rpc('cash_close', { p_token: tok, p_terminal: term, p_counted: b.counted, p_note: b.note ?? null });
      }
      if (seg[1] === 'sessions' && seg[3] === 'print') return { ok: false, error: NO_TCP };
      break;
    }

    // ---------- vendas ----------
    case 'POST sales': {
      if (seg[1] && seg[2] === 'cancel') return rpc('sale_cancel', { p_token: tok, p_terminal: term, p_id: id, p_reason: b.reason ?? '', p_manager_pin: b.manager_pin ?? null });
      if (seg[1] && seg[2] === 'print') return { ok: false, error: NO_TCP };
      // v3.4: apagar venda (só admin; o banco confere)
      if (seg[1] && seg[2] === 'delete') return rpc('sale_delete', { p_token: tok, p_id: id, p_reason: b.reason ?? '', p_confirm_number: b.confirm_number ?? null });
      return createSale(b, tok, term);
    }
    case 'GET sales': {
      if (seg[1] && seg[2] === 'receipt') {
        const [st, sale] = await Promise.all([settings(), rpc('sale_get', { p_id: id })]);
        return buildReceiptDoc(st, sale, sale.customer_balance_cents ?? 0);
      }
      if (seg[1]) return rpc('sale_get', { p_id: id });
      const r = range(sp);
      return qAll((s) => {
        let x = s.from('v_sales_list').select('*').gte('local_date', r.from).lte('local_date', r.to);
        if (sp.get('terminal')) x = x.eq('terminal', sp.get('terminal'));
        return x.order('created_at', { ascending: false }).order('id', { ascending: false });
      });
    }
    case 'GET held': return q((s) => s.from('v_held_sales').select('*').eq('terminal', term).order('id'));
    case 'POST held':
      if (seg[1] && seg[2] === 'resume') return rpc('held_resume', { p_token: tok, p_id: id });
      return rpc('held_create', { p_token: tok, p_terminal: term, p_label: b.label ?? '', p_payload: b.payload ?? {} });
    case 'POST printer': return { ok: false, error: NO_TCP };

    // ---------- clientes / fiado ----------
    case 'GET customers': {
      if (seg[1] && seg[2] === 'statement') return rpc('customer_statement', { p_id: id });
      const t = (sp.get('q') ?? '').trim().replace(/[%,()*]/g, '');
      return q((s) => {
        let x = s.from('customers').select('*');
        if (t) x = x.or(`name.ilike.*${t}*,phone.ilike.*${t}*,doc.ilike.*${t}*`);
        return x.order('active', { ascending: false }).order('name');
      });
    }
    case 'POST customers':
      if (seg[1] && seg[2] === 'charge') return rpc('customer_charge', { p_token: tok, p_id: id, p_amount: b.amount_cents, p_note: b.note ?? null, p_manager_pin: b.manager_pin ?? null });
      if (seg[1] && seg[2] === 'receive') return rpc('customer_receive', { p_token: tok, p_terminal: term, p_id: id, p_amount: b.amount_cents, p_method: b.method, p_note: b.note ?? null });
      return rpc('customer_save', { p_token: tok, p_id: null, p_data: b });
    case 'PUT customers': return rpc('customer_save', { p_token: tok, p_id: id, p_data: b });

    // ---------- relatórios / auditoria ----------
    case 'GET reports': { const r = range(sp); return rpc('report', { p_from: r.from, p_to: r.to }); }
    case 'GET audit': {
      const rows = await q<any[]>((s) => s.from('v_audit').select('*').order('id', { ascending: false }).limit(Math.min(1000, Number(sp.get('limit') ?? 200))));
      return rows.map((a) => ({ ...a, details: a.details == null ? '' : typeof a.details === 'string' ? a.details : JSON.stringify(a.details) }));
    }
    case 'GET backup': return [];
  }
  throw new ApiError(404, `Função indisponível no modo online (${method} ${path}).`, 'NAO_ENCONTRADO');
}

async function lookup(code: string) {
  const c = normalizeScan(code);
  if (!c) throw new ApiError(404, 'Código não encontrado.', 'NAO_ENCONTRADO');
  const safe = (x: string) => x.replace(/[^0-9A-Za-z\-_./]/g, '');
  const cands = barcodeCandidates(c).map(safe).filter(Boolean);
  const e = safe(c);
  const direct = await q<any[]>((s) => s.from('v_products').select('*').or([`code.eq.${e}`, ...cands.map((x) => `ean.eq.${x}`)].join(',')).limit(5));
  if (direct.length) return { product: direct.find((p) => p.code === c) ?? direct[0], qty: null, from_label: false };
  const st = await settings();
  const lbl = parseScaleLabel(c, st.scale_code_digits);
  if (lbl) {
    const rows = await q<any[]>((s) => s.from('v_products').select('*').in('code', [lbl.productCode, lbl.productCodeRaw]).limit(1));
    const p = rows[0];
    if (p) return { product: p, qty: scaleLabelQty(p, lbl.value, st.scale_label_mode), from_label: true };
  }
  throw new ApiError(404, 'Código não encontrado.', 'NAO_ENCONTRADO');
}

// ---------- venda + fila offline ----------
async function createSale(b: any, tok: string, term: string) {
  const client_uuid = b.client_uuid ?? uuid();
  const data = { ...b, client_uuid };
  try {
    return await rpc('sale_create', { p_token: tok, p_terminal: term, p_data: data });
  } catch (e) {
    if (!isNetErr(e)) throw e;
    if ((b.payments ?? []).some((p: any) => p.method === 'fiado'))
      throw new ApiError(0, 'Sem internet: venda no fiado precisa de conexão (limite do cliente). Use outra forma de pagamento.', 'SEM_INTERNET');
    if (b.manager_pin) throw new ApiError(0, 'Sem internet: desconto que precisa de gerente só com conexão.', 'SEM_INTERNET');
    const total = (b.payments ?? []).reduce((a: number, p: any) => a + p.amount_cents, 0);
    enqueue({ client_uuid, token: tok, terminal: term, body: { ...data, offline: true, sold_at: new Date().toISOString() }, created_at: new Date().toISOString(), total_cents: total });
    return { id: null, number: null, offline: true, change_cents: 0, total_cents: total };
  }
}

let flushing = false;
/** Envia a fila offline. Devolve quantas foram enviadas. */
export async function flushQueue(): Promise<{ sent: number; failed: number }> {
  if (flushing) return { sent: 0, failed: 0 };
  flushing = true; let sent = 0; let failed = 0;
  try {
    for (const s of queue()) {
      try {
        let tok = s.token;
        try { await rpc('sale_create', { p_token: tok, p_terminal: s.terminal, p_data: s.body }, true); }
        catch (e) {
          if (e instanceof ApiError && e.code === 'SEM_PIN' && getToken() && getToken() !== tok) {
            tok = getToken(); await rpc('sale_create', { p_token: tok, p_terminal: s.terminal, p_data: s.body }, true);
          } else throw e;
        }
        removeQueued(s.client_uuid); sent++;
      } catch (e: any) {
        if (isNetErr(e)) break;
        markError(s.client_uuid, e.message ?? String(e)); failed++;
      }
    }
  } finally { flushing = false; }
  return { sent, failed };
}
