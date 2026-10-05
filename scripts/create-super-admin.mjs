// Cria (ou redefine a senha de) um SUPER ADMIN do painel (admin.html), direto no banco (sem service_role).
// A senha temporária é gerada aqui e gravada SÓ em .secrets/admin.txt (chmod 600) — nunca é impressa.
//
// Uso: DB_HOST=aws-0-sa-east-1.pooler.supabase.com DB_USER=postgres.<ref> DB_PASSWORD_FILE=.secrets/db.txt \
//      node scripts/create-super-admin.mjs rafael [--reset]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pg; try { pg = require('pg'); } catch { pg = require('/workspace/pgtest/node_modules/pg'); }

const FORBIDDEN = ['cprtigvovwbmigxbosac']; // Folha Caixa (dados reais) — nunca
const ADMIN_DOMAIN = 'admin.caixacerto.invalid';
const usuario = (process.argv[2] || '').trim().toLowerCase();
const reset = process.argv.includes('--reset');
if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(usuario)) { console.error('Informe o usuário: node scripts/create-super-admin.mjs rafael'); process.exit(1); }
const { DB_HOST, DB_USER, DB_PASSWORD_FILE } = process.env;
if (!DB_HOST || !DB_USER || !DB_PASSWORD_FILE) { console.error('Faltam DB_HOST, DB_USER, DB_PASSWORD_FILE.'); process.exit(1); }
if (FORBIDDEN.some((f) => DB_USER.includes(f) || DB_HOST.includes(f))) { console.error('Recusado: projeto do Folha Caixa.'); process.exit(1); }
const db = new pg.Client({ host: DB_HOST, port: Number(process.env.DB_PORT || 5432), user: DB_USER, database: 'postgres',
  password: fs.readFileSync(DB_PASSWORD_FILE, 'utf8').trim(), ssl: process.env.DB_SSL === '0' ? false : { rejectUnauthorized: false } });
await db.connect();

// senha forte: 4 blocos de 5 caracteres sem ambíguos
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const pass = Array.from({ length: 4 }, () => Array.from(crypto.randomBytes(5), (b) => A[b % A.length]).join('')).join('-');
const email = `${usuario}@${ADMIN_DOMAIN}`;
try {
  await db.query('begin');
  const ex = (await db.query('select user_id from super_admins where usuario = $1', [usuario])).rows[0];
  if (ex && !reset) throw new Error(`O super admin "${usuario}" já existe. Use --reset para gerar nova senha.`);
  if (ex) await db.query('select _auth_set_password($1, $2)', [ex.user_id, pass]);
  else {
    const id = (await db.query(`select _auth_create_user($1, $2, '{"tipo":"super_admin"}'::jsonb) id`, [email, pass])).rows[0].id;
    await db.query('insert into super_admins(user_id, usuario) values ($1, $2)', [id, usuario]);
  }
  await db.query('commit');
} catch (e) { await db.query('rollback'); console.error('Falhou:', e.message); process.exit(1); }
finally { await db.end(); }

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.secrets');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, 'admin.txt');
fs.writeFileSync(file, `Painel: https://rafaelytofc7-spec.github.io/caixa-certo/admin.html\nUsuário: ${usuario}\nSenha temporária: ${pass}\n(troque em "Minha senha" no painel e apague este arquivo)\nGerado em: ${new Date().toISOString()}\n`, { mode: 0o600 });
fs.chmodSync(file, 0o600);
console.log(`Super admin "${usuario}" ${reset ? 'com senha nova' : 'criado'}. Senha gravada em ${path.resolve(file)} (chmod 600).`);
