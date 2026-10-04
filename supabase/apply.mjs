// Aplica os arquivos SQL (supabase/sql em ordem) no projeto Supabase do Caixa Certo pela Management API.
// Uso: SUPABASE_PROJECT_REF=<ref do projeto Caixa Certo> SUPABASE_ACCESS_TOKEN=... node supabase/apply.mjs [arquivo.sql ...]
//      node supabase/apply.mjs --query "select 1"
// Segurança: NÃO existe ref padrão — o comando recusa rodar sem SUPABASE_PROJECT_REF e recusa o projeto do Folha Caixa.
import fs from 'node:fs';
import path from 'node:path';
const REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const FORBIDDEN = ['cprtigvovwbmigxbosac']; // Folha Caixa (dados reais) — nunca mexer
if (!REF) { console.error('Defina SUPABASE_PROJECT_REF (ref do projeto do Caixa Certo).'); process.exit(1); }
if (FORBIDDEN.includes(REF)) { console.error('Recusado: esse é o projeto do Folha Caixa (dados reais).'); process.exit(1); }
if (!TOKEN) { console.error('Defina SUPABASE_ACCESS_TOKEN.'); process.exit(1); }
export async function runSql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`SQL falhou (${r.status}): ${txt.slice(0, 2000)}`);
  return txt ? JSON.parse(txt) : null;
}
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = process.argv.slice(2);
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'sql');
  if (args[0] === '--query') { console.log(JSON.stringify(await runSql(args[1]), null, 1)); process.exit(0); }
  const files = args.length ? args : fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(dir, f));
  for (const f of files) {
    process.stdout.write(`→ ${path.basename(f)} … `);
    await runSql(fs.readFileSync(f, 'utf8'));
    console.log('ok');
  }
}
