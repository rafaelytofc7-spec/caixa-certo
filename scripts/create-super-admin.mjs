// Cria (ou redefine a senha de) um SUPER ADMIN do painel (admin.html).
// A senha temporária é gerada aqui e gravada SÓ em .secrets/admin.txt (chmod 600) — nunca é impressa.
//
// Uso (projeto real):  SUPABASE_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=... node scripts/create-super-admin.mjs rafael [--reset]
// Uso (local):         SB_URL=... SB_SERVICE=... node scripts/create-super-admin.mjs rafael [--reset]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const FORBIDDEN = ['cprtigvovwbmigxbosac']; // Folha Caixa (dados reais) — nunca
const ADMIN_DOMAIN = 'admin.caixacerto.invalid';
const usuario = (process.argv[2] || '').trim().toLowerCase();
const reset = process.argv.includes('--reset');
if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(usuario)) { console.error('Informe o usuário: node scripts/create-super-admin.mjs rafael'); process.exit(1); }

let URL_ = process.env.SB_URL, SERVICE = process.env.SB_SERVICE;
const REF = process.env.SUPABASE_PROJECT_REF;
if (REF) {
  if (FORBIDDEN.includes(REF)) { console.error('Recusado: projeto do Folha Caixa.'); process.exit(1); }
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } });
  if (!r.ok) { console.error('Não deu para ler as chaves do projeto:', r.status); process.exit(1); }
  const keys = await r.json();
  URL_ = `https://${REF}.supabase.co`; SERVICE = keys.find((k) => k.name === 'service_role' && k.api_key)?.api_key;
}
if (!URL_ || !SERVICE) { console.error('Faltam SB_URL/SB_SERVICE (ou SUPABASE_PROJECT_REF).'); process.exit(1); }

const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const call = async (method, p, body) => {
  const r = await fetch(URL_ + p, { method, headers: { ...H, Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { ok: r.ok, status: r.status, data: j };
};
// senha forte: 20 caracteres sem ambíguos + separadores
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const pass = Array.from({ length: 4 }, () => Array.from(crypto.randomBytes(5), (b) => A[b % A.length]).join('')).join('-');
const email = `${usuario}@${ADMIN_DOMAIN}`;

const existing = await call('GET', `/rest/v1/super_admins?select=user_id&usuario=eq.${encodeURIComponent(usuario)}`);
if (!existing.ok) { console.error('Erro lendo super_admins:', existing.status, JSON.stringify(existing.data).slice(0, 300)); process.exit(1); }
let userId = existing.data[0]?.user_id;
if (userId && !reset) { console.error(`O super admin "${usuario}" já existe. Use --reset para gerar nova senha.`); process.exit(1); }
if (userId) {
  const r = await call('PUT', `/auth/v1/admin/users/${userId}`, { password: pass });
  if (!r.ok) { console.error('Falhou ao trocar a senha:', r.status, JSON.stringify(r.data).slice(0, 300)); process.exit(1); }
} else {
  const r = await call('POST', '/auth/v1/admin/users', { email, password: pass, email_confirm: true, app_metadata: { tipo: 'super_admin' } });
  if (!r.ok) { console.error('Falhou ao criar o login:', r.status, JSON.stringify(r.data).slice(0, 300)); process.exit(1); }
  userId = r.data.id;
  const ins = await call('POST', '/rest/v1/super_admins?select=user_id', { user_id: userId, usuario });
  if (!ins.ok) { await call('DELETE', `/auth/v1/admin/users/${userId}`); console.error('Falhou ao registrar super admin:', ins.status, JSON.stringify(ins.data).slice(0, 300)); process.exit(1); }
}
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.secrets');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, 'admin.txt');
fs.writeFileSync(file, `Painel: https://rafaelytofc7-spec.github.io/caixa-certo/admin.html\nUsuário: ${usuario}\nSenha temporária: ${pass}\n(troque em "Minha senha" no painel e apague este arquivo)\nGerado em: ${new Date().toISOString()}\n`, { mode: 0o600 });
fs.chmodSync(file, 0o600);
console.log(`Super admin "${usuario}" ${reset ? 'com senha nova' : 'criado'}. Senha gravada em ${path.resolve(file)} (chmod 600).`);
