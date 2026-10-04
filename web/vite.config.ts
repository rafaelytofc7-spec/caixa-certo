import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { BRAND } from '../shared/src/brand';

/** versão do app: package.json da raiz (aparece em Config. e no nome do cache do service worker) */
const APP_VERSION: string = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
/** prefixo dos caches do service worker — próprio deste app (outro app no mesmo domínio github.io não é afetado) */
const CACHE_PREFIX = 'caixacerto-';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** manifest do app instalado, gerado a partir de BRAND (trocar o nome = trocar shared/src/brand.ts) */
function manifest(base: string) {
  const ic = (f: string, s: number, purpose = 'any') => ({ src: `icons/${f}`, sizes: `${s}x${s}`, type: 'image/png', purpose });
  return JSON.stringify({
    id: base, name: BRAND.name, short_name: BRAND.shortName, description: BRAND.description, lang: 'pt-BR', dir: 'ltr',
    start_url: './', scope: './', display: 'standalone', display_override: ['standalone', 'minimal-ui'], orientation: 'any',
    background_color: '#F7F4EC', theme_color: '#1F7A4D', categories: ['business', 'finance', 'productivity'], prefer_related_applications: false,
    icons: [ic('icon-96.png', 96), ic('icon-144.png', 144), ic('icon-192.png', 192), ic('icon-256.png', 256), ic('icon-384.png', 384), ic('icon-512.png', 512),
      ic('maskable-192.png', 192, 'maskable'), ic('maskable-512.png', 512, 'maskable')],
    shortcuts: [{ name: 'Nova venda', short_name: 'Venda', url: './#/venda', icons: [{ src: 'icons/icon-96.png', sizes: '96x96', type: 'image/png' }] },
      { name: 'Resumo de hoje', short_name: 'Hoje', url: './#/hoje', icons: [{ src: 'icons/icon-96.png', sizes: '96x96', type: 'image/png' }] }],
  }, null, 1);
}

function brand(): Plugin {
  let base = '/';
  return {
    name: 'brand',
    configResolved(c) { base = c.base; },
    transformIndexHtml(html) { return html.replace(/__BRAND_NAME__/g, esc(BRAND.name)).replace(/__BRAND_DESC__/g, esc(BRAND.description)); },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.endsWith('/manifest.webmanifest')) { res.setHeader('Content-Type', 'application/manifest+json'); res.end(manifest(base)); return; }
        next();
      });
    },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest(base) }); },
  };
}

/** Gera o service worker (sw.js) com a lista de arquivos do build para o app abrir sem internet.
 *  O painel do administrador (admin.html) fica de fora: sempre vem da rede e nunca é guardado. */
function serviceWorker(): Plugin {
  return {
    name: 'caixacerto-sw',
    apply: 'build',
    generateBundle(_o, bundle) {
      const isAdmin = (f: string) => f === 'admin.html' || /(^|\/)admin[-.]/.test(f);
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && !isAdmin(f) && f !== 'manifest.webmanifest');
      const icons = fs.readdirSync(new URL('./public/icons', import.meta.url)).filter((f) => f.endsWith('.png')).map((f) => 'icons/' + f);
      const extra = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', ...icons];
      // versão = hash do conteúdo (build igual → sw.js igual → ninguém vê "Nova versão" à toa)
      const h = createHash('sha256');
      for (const f of Object.keys(bundle).sort()) { const b: any = bundle[f]; h.update(f); h.update(b.type === 'chunk' ? b.code : typeof b.source === 'string' ? b.source : Buffer.from(b.source)); }
      const pub = new URL('./public/', import.meta.url);
      for (const f of ['icon.svg', ...icons]) { try { h.update(fs.readFileSync(new URL(f, pub))); } catch { /* */ } }
      const version = h.digest('hex').slice(0, 10);
      const list = JSON.stringify([...new Set([...extra, ...files.filter((f) => f !== 'index.html')])]);
      const code = `// ${BRAND.name} — service worker (gerado no build)
const VERSION = '${APP_VERSION}';
const PREFIX = '${CACHE_PREFIX}';
const CACHE = PREFIX + 'v${APP_VERSION}-${version}';
const FILES = ${list};
// Versão nova NÃO assume sozinha no meio de uma venda: o app mostra "Nova versão — Atualizar" e manda SKIP_WAITING.
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); });
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
// só apaga caches DESTE app (prefixo próprio) — outros apps no mesmo domínio ficam intactos
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
const scopePath = new URL(self.registration.scope).pathname;
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return; // dados nunca vêm do cache do SW
  if (/\\/admin(\\.html)?$/.test(url.pathname) || /\\/assets\\/admin[-.]/.test(url.pathname)) return; // painel: só rede
  if (req.mode === 'navigate') {
    const isApp = url.pathname === scopePath || url.pathname === scopePath + 'index.html';
    if (!isApp) return;
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put('index.html', c)); } return r; })
      .catch(() => caches.match('index.html', { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return r; })));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // GitHub Pages serve em /caixa-certo/ (modo "supabase"); servidor local serve na raiz
  base: process.env.VITE_BASE ?? (mode === 'supabase' ? '/caixa-certo/' : '/'),
  plugins: [react(), brand(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:5170' } },
  build: {
    outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900,
    rollupOptions: { input: { index: new URL('./index.html', import.meta.url).pathname, admin: new URL('./admin.html', import.meta.url).pathname } },
  },
}));
