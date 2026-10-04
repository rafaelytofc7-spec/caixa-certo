import { build } from 'esbuild';
await build({
  entryPoints: ['src/index.ts', 'src/seed-cli.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: ['better-sqlite3', 'fastify', '@fastify/static', 'pdfkit', 'zod'],
  logLevel: 'info',
});
