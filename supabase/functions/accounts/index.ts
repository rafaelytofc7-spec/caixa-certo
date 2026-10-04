// Edge Function "accounts": única porta para criar logins (CPF/CNPJ + usuário + senha) no Caixa Certo.
// - signup:            "Criar conta da loja" (público) → loja em TESTE + usuário DONO.
// - create_user / set_password: só o dono (admin) da loja, sempre dentro da PRÓPRIA loja (JWT + token do caixa).
// - admin_create_loja / admin_set_password: só super admin (painel).
// O cadastro público do Supabase Auth fica DESLIGADO; a chave service_role existe só aqui, no servidor.
import { createClient } from 'npm:@supabase/supabase-js@2';

// e-mail interno (ninguém recebe e-mail). NÃO mude depois que houver lojas cadastradas (os logins usam esse domínio).
const STORE_DOMAIN = 'lojas.caixacerto.invalid';
const storeEmail = (doc: string, user: string) => `${doc.toLowerCase()}.${user}@${STORE_DOMAIN}`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, error: string) => json(status, { error, code });

const USER_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const str = (v: unknown) => String(v ?? '').trim();
const checkCommon = (b: Record<string, unknown>) => {
  const name = str(b.name);
  const username = str(b.username).toLowerCase();
  const password = String(b.password ?? '');
  const pin = b.pin == null || b.pin === '' ? null : String(b.pin);
  if (!name || name.length > 60) return { err: 'Informe o nome (até 60 letras).' };
  if (!USER_RE.test(username)) return { err: 'Usuário: 3 a 30 letras minúsculas, números, ponto, hífen ou _ (sem espaço e sem acento).' };
  if (password.length < 8 || password.length > 72) return { err: 'A senha precisa ter pelo menos 8 caracteres.' };
  if (pin !== null && !/^\d{4}$/.test(pin)) return { err: 'O PIN precisa ter 4 dígitos.' };
  return { name, username, password, pin };
};
const STATUS: Record<string, number> = { PROIBIDO: 403, LOJA_BLOQUEADA: 403, SEM_PIN: 401, SEM_LOGIN: 401, USUARIO_EXISTE: 409, DOC_EXISTE: 409 };
const pgErr = (e: { message?: string; hint?: string } | null) => {
  const code = e?.hint || 'ERRO';
  return fail(STATUS[code] ?? 400, code, e?.message || 'Erro');
};
const authErr = (e: { message?: string } | null) => {
  const exists = /already|registered|exists/i.test(e?.message || '');
  return exists ? fail(409, 'USUARIO_EXISTE', 'Esse usuário já existe.') : fail(400, 'AUTH', e?.message || 'Não deu para criar o login.');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'METODO', 'Use POST.');
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail(400, 'JSON', 'Corpo inválido.'); }
  const action = String(b.action ?? '');

  const caller = async () => {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return null;
    const { data, error } = await admin.auth.getUser(jwt);
    return error ? null : data.user;
  };

  // ---------- auto cadastro da loja ----------
  if (action === 'signup' || action === 'admin_create_loja') {
    let me = null;
    if (action === 'admin_create_loja') {
      me = await caller();
      if (!me) return fail(401, 'SEM_LOGIN', 'Entre com usuário e senha.');
      const { data: ok, error } = await admin.rpc('account_admin_check', { p_caller: me.id });
      if (error) return pgErr(error);
      if (!ok) return fail(403, 'PROIBIDO', 'Acesso negado.');
    }
    const c = checkCommon({ name: b.responsavel, username: b.usuario, password: b.senha, pin: b.pin });
    if ('err' in c) return fail(400, 'DADOS', c.err!);
    const nome = str(b.loja_nome);
    if (nome.length < 2 || nome.length > 80) return fail(400, 'DADOS', 'Informe o nome da loja.');
    // confere CPF/CNPJ (dígitos) e se já existe ANTES de criar o login
    const { data: chk, error: e0 } = await admin.rpc('account_signup_check', { p_documento: str(b.documento), p_usuario: c.username });
    if (e0) return pgErr(e0);
    const doc = String(chk.documento);
    const { data: created, error: e1 } = await admin.auth.admin.createUser({
      email: storeEmail(doc, c.username), password: c.password, email_confirm: true,
      user_metadata: { username: c.username, name: c.name, documento: doc },
    });
    if (e1 || !created.user) return authErr(e1);
    const payload = { nome, documento: doc, responsavel: c.name, usuario: c.username, telefone: str(b.whatsapp), pin: c.pin,
      ...(action === 'admin_create_loja' ? { status: b.status, vencimento: b.vencimento, plano: b.plano, valor_mensal_cents: b.valor_mensal_cents, observacao: b.observacao } : {}) };
    const { data, error } = action === 'signup'
      ? await admin.rpc('account_signup_loja', { p_auth_uid: created.user.id, p_data: payload })
      : await admin.rpc('account_admin_create_loja', { p_caller: me!.id, p_auth_uid: created.user.id, p_data: payload });
    if (error) { await admin.auth.admin.deleteUser(created.user.id); return pgErr(error); }
    return json(200, { ok: true, loja: data });
  }

  // ---------- super admin: nova senha para usuário de uma loja ----------
  if (action === 'admin_set_password') {
    const me = await caller();
    if (!me) return fail(401, 'SEM_LOGIN', 'Entre com usuário e senha.');
    const password = String(b.password ?? '');
    if (password.length < 8 || password.length > 72) return fail(400, 'DADOS', 'A senha precisa ter pelo menos 8 caracteres.');
    const { data: target, error } = await admin.rpc('account_admin_target', { p_caller: me.id, p_loja: str(b.loja_id), p_usuario: str(b.usuario) });
    if (error) return pgErr(error);
    const { error: e2 } = await admin.auth.admin.updateUserById(String(target), { password });
    if (e2) return fail(400, 'AUTH', e2.message);
    return json(200, { ok: true });
  }

  // ---------- dono da loja: funcionários ----------
  if (action === 'create_user' || action === 'set_password') {
    const me = await caller();
    if (!me) return fail(401, 'SEM_LOGIN', 'Entre com usuário e senha.');
    const token = String(b.token ?? '');
    if (action === 'create_user') {
      const c = checkCommon(b);
      if ('err' in c) return fail(400, 'DADOS', c.err!);
      const role = String(b.role ?? 'operador');
      if (!['admin', 'gerente', 'operador'].includes(role)) return fail(400, 'DADOS', 'Papel inválido.');
      // confere admin ANTES de criar qualquer login (e pega o documento da loja dele)
      const { data: who, error: ePre } = await admin.rpc('account_check_admin', { p_token: token, p_caller: me.id });
      if (ePre) return pgErr(ePre);
      const { data: created, error: e1 } = await admin.auth.admin.createUser({
        email: storeEmail(String(who.documento), c.username), password: c.password, email_confirm: true,
        user_metadata: { username: c.username, name: c.name, documento: who.documento },
      });
      if (e1 || !created.user) return authErr(e1);
      const { data, error } = await admin.rpc('account_create', {
        p_token: token, p_caller: me.id, p_auth_uid: created.user.id, p_name: c.name, p_username: c.username, p_role: role, p_pin: c.pin,
      });
      if (error) { await admin.auth.admin.deleteUser(created.user.id); return pgErr(error); }
      return json(200, { ok: true, user: data });
    }
    const password = String(b.password ?? '');
    if (password.length < 8 || password.length > 72) return fail(400, 'DADOS', 'A senha precisa ter pelo menos 8 caracteres.');
    const { data: target, error } = await admin.rpc('account_target', { p_token: token, p_caller: me.id, p_user_id: Number(b.user_id) });
    if (error) return pgErr(error);
    const { error: e2 } = await admin.auth.admin.updateUserById(String(target), { password });
    if (e2) return fail(400, 'AUTH', e2.message);
    return json(200, { ok: true });
  }

  return fail(400, 'ACAO', 'Ação desconhecida.');
});
