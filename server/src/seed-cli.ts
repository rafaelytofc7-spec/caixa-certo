import fs from 'node:fs';
import { openDb } from './db';
import { seed } from './seed';
import { dbPathFromEnv } from './config';

const file = dbPathFromEnv();
if (process.argv.includes('--reset') && fs.existsSync(file)) {
  for (const f of [file, file + '-wal', file + '-shm']) if (fs.existsSync(f)) fs.rmSync(f);
  console.log('Banco apagado:', file);
}
const db = openDb(file);
console.log(seed(db) ? `Seed aplicado em ${file}` : `Banco já tinha dados (${file}). Use --reset para recomeçar.`);
db.close();
