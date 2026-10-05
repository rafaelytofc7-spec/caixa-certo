// Aplica supabase/sql/*.sql (em ordem) direto no Postgres do projeto Caixa Certo (sem token da Management API).
// Uso: DB_HOST=aws-0-sa-east-1.pooler.supabase.com DB_USER=postgres.<ref> DB_PASSWORD_FILE=.secrets/db.txt node supabase/apply-db.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pg; try { pg = require('pg'); } catch { pg = require('/workspace/pgtest/node_modules/pg'); }
const { DB_HOST, DB_USER, DB_PASSWORD_FILE } = process.env;
if (!DB_HOST || !DB_USER || !DB_PASSWORD_FILE) { console.error('Faltam DB_HOST, DB_USER, DB_PASSWORD_FILE.'); process.exit(1); }
if (/cprtigvovwbmigxbosac/.test(DB_USER + DB_HOST)) { console.error('Recusado: projeto do Folha Caixa.'); process.exit(1); }
const db = new pg.Client({ host: DB_HOST, port: Number(process.env.DB_PORT || 5432), user: DB_USER, database: 'postgres',
  password: fs.readFileSync(DB_PASSWORD_FILE, 'utf8').trim(), ssl: process.env.DB_SSL === '0' ? false : { rejectUnauthorized: false } });
await db.connect();
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'sql');
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  process.stdout.write(`→ ${f} … `);
  try { await db.query(fs.readFileSync(path.join(dir, f), 'utf8')); console.log('ok'); }
  catch (e) { console.log('ERRO'); console.error(e.message, e.where ?? ''); await db.end(); process.exit(1); }
}
await db.end();
