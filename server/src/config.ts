import path from 'node:path';
export const PORT = Number(process.env.PORT ?? 5170);
export const HOST = process.env.HOST ?? '127.0.0.1';
export function serverRoot() {
  // dist/index.js ou src/index.ts -> raiz do pacote server
  return path.resolve(__dirname, '..');
}
export function dbPathFromEnv() {
  return process.env.FOLHA_DB ?? path.join(serverRoot(), 'data', 'folha.db');
}
export function webDist() {
  return process.env.FOLHA_WEB ?? path.resolve(serverRoot(), '../web/dist');
}
