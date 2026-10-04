// Auditoria de instalação do PWA (Chrome headless + DevTools Protocol).
// Uso: node scripts/pwa-audit.mjs [URL]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const URL_ = (process.argv[2] || 'https://rafaelytofc7-spec.github.io/caixa-certo/').replace(/\/?$/, '/');
const exe = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
import os from 'node:os'; import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-audit-')); // perfil normal (incógnito nunca instala)
const ctx = await chromium.launchPersistentContext(dir, { executablePath: exe, args: ['--no-sandbox'], viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
const page = ctx.pages()[0] ?? await ctx.newPage();
await ctx.addInitScript(() => { window.addEventListener('beforeinstallprompt', () => { window.__bipFired = true; }); });
const bad = [];
page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
await page.goto(URL_, { waitUntil: 'networkidle' });
const swInfo = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, script: r.active?.scriptURL }; });
await page.reload({ waitUntil: 'networkidle' });
const cdp = await ctx.newCDPSession(page);
const errs = await cdp.send('Page.getInstallabilityErrors');
const man = await cdp.send('Page.getAppManifest');
let parsed = null; try { parsed = JSON.parse(man.data); } catch {}
const ctrl = await page.evaluate(() => !!navigator.serviceWorker.controller);
const appId = await cdp.send('Page.getAppId').catch(() => null);
await page.mouse.click(200, 400).catch(() => {}); await new Promise((r) => setTimeout(r, 3000));
const bip = await page.evaluate(() => !!window.__bipFired);
const shots = [];
for (const sc of parsed?.screenshots ?? []) {
  const u = new URL(sc.src, man.url).href; const r = await page.request.get(u);
  shots.push(`${r.status()} ${sc.form_factor ?? '-'} ${sc.sizes} ${sc.src}`);
}
const out = { url: URL_, https: URL_.startsWith('https://'), manifestUrl: man.url, manifestErrors: man.errors, installabilityErrors: errs.installabilityErrors, beforeinstallpromptFired: bip, appId,
  serviceWorker: { ...swInfo, controlsPage: ctrl }, http4xx: bad, manifest: parsed && { id: parsed.id, start_url: parsed.start_url, scope: parsed.scope, display: parsed.display,
    icons: parsed.icons?.map((i) => `${i.sizes} ${i.purpose ?? 'any'} ${i.src}`), screenshots: shots, shortcuts: parsed.shortcuts?.length ?? 0 } };
console.log(JSON.stringify(out, null, 2));
await ctx.close(); fs.rmSync(dir, { recursive: true, force: true });
process.exit(errs.installabilityErrors.length || bad.length ? 1 : 0);
