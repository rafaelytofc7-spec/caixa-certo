// Instalação do app (PWA) e atualização do service worker.
// O Chrome do Android dispara "beforeinstallprompt" quando o app pode ser instalado: guardamos o evento
// para o botão "Instalar app" abrir a janela de instalação na hora.
type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferred: BIP | null = null;
let installed = false;
let waitingSW: ServiceWorker | null = null;
const emit = () => window.dispatchEvent(new Event('cc:pwa'));

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);
const W = () => (typeof window === 'undefined' ? ({} as any) : (window as any));
const mm = (q: string) => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches;
/** v3.6: app Android feito no Median.co (WebView): o Median põe "MedianAndroid/1.0 median" (antigo: "gonative") no user agent */
export const isMedian = () => /median|gonative/i.test(ua()) || !!(W().median || W().gonative);
/** aberto como app instalado (PWA): janela própria, sem barra do navegador */
export const isStandalone = () => typeof window !== 'undefined' &&
  (['standalone', 'minimal-ui', 'window-controls-overlay'].some((m) => mm(`(display-mode: ${m})`)) || (navigator as any).standalone === true);
const runningAsApp = () => isStandalone() || mm('(display-mode: fullscreen)');
export const isIOS = () => /iphone|ipad|ipod/i.test(ua()) || (/macintosh/i.test(ua()) && 'ontouchend' in document);
export const isAndroid = () => /android/i.test(ua());
/** navegador interno de app (WhatsApp, Instagram, Facebook…): não instala PWA. O app do Median também é WebView ("; wv)"), mas é o NOSSO app. */
export const inAppBrowser = () => !isMedian() && !runningAsApp() && /FBAN|FBAV|FB_IAB|Instagram|Line\/|WhatsApp|; wv\)|Snapchat|TikTok|musical_ly|Telegram/i.test(ua());

// "já instalado" fica guardado no aparelho: assim o navegador comum (mesmo Chrome do PWA) também esconde o "Instalar app".
// Se o Chrome voltar a oferecer a instalação (beforeinstallprompt), é porque o app foi desinstalado: o aviso some.
const FLAG = 'cc.installed';
type Flag = { mode: 'apk' | 'pwa'; at: string };
const readFlag = (): Flag | null => { try { const f = JSON.parse(localStorage.getItem(FLAG) || 'null'); return f && (f.mode === 'apk' || f.mode === 'pwa') ? f : null; } catch { return null; } };
const writeFlag = (mode: Flag['mode'] | null) => { try { if (mode) localStorage.setItem(FLAG, JSON.stringify({ mode, at: new Date().toISOString() })); else localStorage.removeItem(FLAG); } catch { /* */ } };
let relatedInstalled = false;
export type InstallMode = 'apk' | 'pwa' | 'browser';
/** onde o app está rodando agora */
export const installMode = (): InstallMode => (isMedian() ? 'apk' : runningAsApp() ? 'pwa' : 'browser');
export const INSTALL_LABEL: Record<InstallMode, string> = { apk: 'App Android (APK)', pwa: 'App instalado pelo Chrome', browser: 'Navegador' };
/** já instalado (neste modo ou guardado de antes) */
export const isInstalled = () => installMode() !== 'browser' || installed || relatedInstalled || !!readFlag();
export const installedFlag = readFlag;
export const isSamsung = () => /SamsungBrowser/i.test(ua());

export function pwaState() {
  return { canPrompt: !!deferred && !isInstalled(), installed: isInstalled(), mode: installMode(), updateReady: !!waitingSW };
}
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const d = deferred; deferred = null; emit();
  await d.prompt();
  const r = await d.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  return r.outcome;
}
/** abre esta página no Chrome (sai do navegador do WhatsApp/Instagram) */
export const chromeIntentUrl = () => `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(location.href)};end`;

let wantReload = false;
export function applyUpdate() {
  if (!waitingSW) { location.reload(); return; }
  wantReload = true;
  waitingSW.postMessage('SKIP_WAITING');
  // se a troca não acontecer (WebView sem controllerchange, SW travado…), recarrega mesmo assim
  setTimeout(() => location.reload(), 4000);
}

export function initPwa() {
  const m = installMode();
  if (m !== 'browser') writeFlag(m);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferred = e as BIP;
    if (readFlag()?.mode === 'pwa' && installMode() === 'browser') writeFlag(null); // o Chrome oferece instalar = não está mais instalado
    emit();
  });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; writeFlag('pwa'); emit(); });
  for (const q of ['standalone', 'minimal-ui', 'window-controls-overlay']) {
    window.matchMedia?.(`(display-mode: ${q})`).addEventListener?.('change', (e) => { if (e.matches) writeFlag('pwa'); emit(); });
  }
  // Chrome (Android): o PWA declarado em related_applications aparece aqui quando já está instalado
  const gira = (navigator as any).getInstalledRelatedApps;
  if (m === 'browser' && typeof gira === 'function') {
    gira.call(navigator).then((apps: any[]) => { if (apps?.length) { relatedInstalled = true; emit(); } }).catch(() => {});
  }
  if (m === 'apk') initMedian();
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  // Só recarrega quando NÓS pedimos a troca de versão (applyUpdate). Na 1ª visita o SW novo assume a página
  // (clients.claim) e dispara controllerchange: recarregar ali apagaria o que a pessoa está digitando.
  let reloading = false;
  const startedControlled = !!navigator.serviceWorker.controller; // já tinha SW = é troca de versão, não a 1ª instalação
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading || !(wantReload || startedControlled)) return; reloading = true; location.reload(); });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
      const hadController = !!navigator.serviceWorker.controller;
      const track = (sw: ServiceWorker | null) => {
        if (!sw) return;
        const done = () => { if (sw.state === 'installed' && navigator.serviceWorker.controller) { waitingSW = sw; emit(); } };
        done(); sw.addEventListener('statechange', done);
      };
      // abriu o app e já tinha versão nova esperando: ainda não começou a venda, então atualiza na hora
      if (reg.waiting && hadController) { waitingSW = reg.waiting; applyUpdate(); return; }
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
      // confere atualização a cada 30 min e quando o app volta para a frente
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    } catch { /* sem SW: o app funciona, só não abre offline */ }
  });
}

// ---------- v3.6: dentro do app do Median (WebView) ----------
/** manda um comando para o app nativo (mesmo formato da biblioteca median-js-bridge) */
export function medianCommand(command: string, data?: Record<string, unknown>): boolean {
  const w = W();
  if (!isMedian()) return false;
  const payload = data ? { medianCommand: command, data } : command;
  try {
    if (w.JSBridge?.postMessage) { w.JSBridge.postMessage(typeof payload === 'string' ? payload : JSON.stringify(payload)); return true; }
    if (w.webkit?.messageHandlers?.JSBridge?.postMessage) { w.webkit.messageHandlers.JSBridge.postMessage(payload); return true; }
    location.href = command + (data ? '?' + new URLSearchParams(Object.entries(data).map(([k, v]) => [k, String(v)])).toString() : '');
    return true;
  } catch { return false; }
}
/** WhatsApp e outros apps: no app do Median abre FORA (no app do WhatsApp), não no navegador interno */
const EXTERNAL = /^(https?:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|web\.whatsapp\.com)\/|whatsapp:)/i;
export function openExternal(url: string) {
  if (isMedian()) {
    const w = W();
    const lib = w.median?.window?.open ?? w.gonative?.window?.open;
    if (typeof lib === 'function') { try { lib(url, 'external'); return; } catch { /* */ } }
    if (medianCommand('median://window/open', { url, mode: 'external' })) return;
  }
  window.open(url, '_blank', 'noopener');
}
export const openAppSettings = () => medianCommand('median://open/app-settings');
function initMedian() {
  document.documentElement.classList.add('in-apk');
  // depois do React (fase de "bolha" na janela): se o próprio botão cancelou (telefone inválido), não abre nada
  window.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || !EXTERNAL.test(a.href)) return;
    e.preventDefault();
    openExternal(a.href);
  });
}
