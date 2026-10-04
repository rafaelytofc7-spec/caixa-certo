// Gera os ícones PNG do PWA (folha verde) com o Chrome headless. Uso: node scripts/icons.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'web/public/icons');
fs.mkdirSync(out, { recursive: true });
const exe = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const leaf = (fill, vein) => `<path d="M54 8C30 8 12 20 12 40c0 5 1.5 9.5 4 13l-6 6 3 3 6-6c3.5 2.5 8 4 13 4 20 0 22-28 22-52z" fill="${fill}"/>
  <path d="M19 48C27 37 36 28 46 20" stroke="${vein}" stroke-width="3.5" stroke-linecap="round" fill="none"/>`;
// fundo creme arredondado (any) e verde cheio com margem segura (maskable)
const svgAny = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#F7F4EC"/><g transform="translate(6 6) scale(.8125)">${leaf('#1F7A4D', '#F7F4EC')}</g></svg>`;
const svgMask = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1F7A4D"/><g transform="translate(14 14) scale(.5625)">${leaf('#F7F4EC', '#1F7A4D')}</g></svg>`;
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const ALL = [['icon-192.png', svgAny, 192], ['icon-512.png', svgAny, 512], ['maskable-512.png', svgMask, 512], ['maskable-192.png', svgMask, 192], ['apple-touch-icon.png', svgMask, 180],
  ['icon-96.png', svgAny, 96], ['icon-144.png', svgAny, 144], ['icon-256.png', svgAny, 256], ['icon-384.png', svgAny, 384]];
// node scripts/icons.mjs icon-96.png icon-144.png …  → gera só esses (não mexe nos ícones já instalados)
const only = process.argv.slice(2);
for (const [name, svg, size] of ALL.filter(([n]) => !only.length || only.includes(n))) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(out, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('ícones em', out);
