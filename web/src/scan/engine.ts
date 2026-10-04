// Motor de leitura pela câmera: BarcodeDetector (nativo, Android/ChromeOS/macOS) quando existe e lê EAN;
// senão a biblioteca ZXing (carregada só quando abre a câmera) — Chrome do Windows e alguns Android não têm o nativo.
import { isValidGtin, upcEtoA, BRAND } from '@folha/shared';
import { isMedian } from '../pwa';

export interface Hit { code: string; format: string }
export interface Engine { name: 'nativo' | 'zxing'; detect: (v: HTMLVideoElement) => Promise<Hit | null> }

const NATIVE = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'];
/** ?zxing=1 na URL (ou localStorage folha.scan.engine=zxing) força a biblioteca, para testar */
const forceZxing = () => /[?&]zxing=1/.test(location.search) || localStorage.getItem('cc.scan.engine') === 'zxing';

/** descarta leitura com dígito verificador errado (EAN/UPC) */
export function validHit(h: Hit | null): Hit | null {
  if (!h || !h.code) return null;
  const f = h.format.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (f === 'ean13' || f === 'ean8' || f === 'upca') return isValidGtin(h.code) ? h : null;
  if (f === 'upce') return h.code.length === 8 ? (upcEtoA(h.code) ? h : null) : h.code.length >= 6 ? h : null;
  return h;
}

let cached: Promise<Engine> | null = null;
export function getEngine(): Promise<Engine> {
  if (!cached) cached = make().catch((e) => { cached = null; throw e; });
  return cached;
}

async function make(): Promise<Engine> {
  const BD = (window as any).BarcodeDetector;
  if (BD && !forceZxing()) {
    try {
      const sup: string[] = await BD.getSupportedFormats();
      const formats = NATIVE.filter((f) => sup.includes(f));
      if (formats.includes('ean_13')) {
        const d = new BD({ formats });
        return {
          name: 'nativo',
          async detect(v) {
            if (!v.videoWidth) return null;
            const r = await d.detect(v);
            for (const x of r) { const h = validHit({ code: x.rawValue, format: x.format }); if (h) return h; }
            return null;
          },
        };
      }
    } catch { /* cai na biblioteca */ }
  }
  const [{ BrowserMultiFormatReader }, lib] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
  const F = lib.BarcodeFormat;
  const hints = new Map<any, any>();
  hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.QR_CODE]);
  hints.set(lib.DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints);
  const canvas = document.createElement('canvas');
  const c2d = canvas.getContext('2d', { willReadFrequently: true })!;
  return {
    name: 'zxing',
    async detect(v) {
      const w = v.videoWidth; const h = v.videoHeight;
      if (!w || !h) return null;
      const s = Math.min(1, 1024 / w);
      canvas.width = Math.round(w * s); canvas.height = Math.round(h * s);
      c2d.drawImage(v, 0, 0, canvas.width, canvas.height);
      try {
        const r = reader.decodeFromCanvas(canvas);
        return validHit({ code: r.getText(), format: String(F[r.getBarcodeFormat()]) });
      } catch { return null; }
    },
  };
}

/** mensagem em português para cada erro da câmera */
export function cameraError(e: any): { title: string; help: string; retry: boolean } {
  const n = String(e?.name || '');
  const android = /android/i.test(navigator.userAgent);
  if (!window.isSecureContext) return { title: 'A câmera só funciona em endereço seguro (https).', help: 'Abra pelo link ' + BRAND.url + ' (ou pelo app instalado).', retry: false };
  if (!navigator.mediaDevices?.getUserMedia) return { title: 'Este navegador não deixa usar a câmera.', help: 'Use o Chrome (ou Edge) atualizado. Você ainda pode digitar o código abaixo ou usar um leitor USB.', retry: false };
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError')
    return { title: 'Sem permissão para usar a câmera.', retry: true,
      help: isMedian()
        ? `No app ${BRAND.name}: toque em “Configurações do app” › Permissões › Câmera › Permitir (ou segure o ícone do app › Informações do app). Depois volte e toque em “Tentar de novo”.`
        : android
        ? `Toque no cadeado (ou ⓘ) ao lado do endereço › Permissões › Câmera › Permitir. No app instalado: segure o ícone do ${BRAND.name} › Informações do app › Permissões › Câmera › Permitir. Depois toque em “Tentar de novo”.`
        : 'Clique no cadeado ao lado do endereço (no app instalado: ⋮ › Configurações do site) › Câmera › Permitir. No Windows confira também Configurações › Privacidade › Câmera. Depois clique em “Tentar de novo”.' };
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError')
    return { title: 'Nenhuma câmera encontrada neste aparelho.', help: 'Ligue uma webcam ou use um leitor USB. Também dá para digitar o código abaixo.', retry: true };
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError')
    return { title: 'A câmera está ocupada.', help: 'Feche outro app que esteja usando a câmera (WhatsApp, Meet, Câmera…) e tente de novo.', retry: true };
  return { title: 'Não deu para abrir a câmera.', help: String(e?.message || e || ''), retry: true };
}
