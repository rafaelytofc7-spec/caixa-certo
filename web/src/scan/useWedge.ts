// Leitor USB/Bluetooth em modo teclado ("keyboard wedge"): teclas muito rápidas + Enter viram uma leitura,
// mesmo com o foco fora da busca. Teclas de pessoa (lentas) passam normalmente.
import { useEffect, useRef } from 'react';
import { normalizeScan, WedgeDetector } from '@folha/shared';

export function useWedge(onScan: (code: string) => void, opts: { enabled?: boolean; onStart?: () => void } = {}) {
  const cb = useRef(onScan); cb.current = onScan;
  const st = useRef(opts.onStart); st.current = opts.onStart;
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    const det = new WedgeDetector();
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      // janela aberta (pagamento, peso…) usa o teclado; o leitor da câmera (data-scanner) não atrapalha
      if (document.querySelector('.overlay:not([data-scanner])')) { det.reset(); return; }
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && !t?.hasAttribute('data-wedge')) { det.reset(); return; }
      const now = performance.now();
      if (e.key === 'Enter') {
        const code = det.enter(now);
        if (code) { e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation(); cb.current(normalizeScan(code)); }
        return;
      }
      if (e.key.length === 1) { if (det.key(e.key, now).started) st.current?.(); }
      else if (e.key !== 'Shift' && e.key !== 'CapsLock') det.reset();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [enabled]);
}
