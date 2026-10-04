import { buildApp } from './app';
import { PORT, HOST, dbPathFromEnv, webDist } from './config';
import { BRAND } from '@folha/shared';

const { app } = buildApp({ dbPath: dbPathFromEnv(), webDist: webDist(), logger: process.env.LOG === '1' });
app.listen({ port: PORT, host: HOST }).then(() => {
  console.log(`\n🍃 ${BRAND.name} — ${BRAND.tagline}\n   Abra http://localhost:${PORT} no navegador do balcão.\n   Banco: ${dbPathFromEnv()}\n`);
}).catch((e) => { console.error(e); process.exit(1); });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { app.close().then(() => process.exit(0)); });
