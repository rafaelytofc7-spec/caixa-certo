// Bipe (Web Audio, sem arquivo de som) e vibração ao ler um código.
const KEY = 'cc.beep';
export const beepEnabled = () => localStorage.getItem(KEY) !== '0';
export const setBeepEnabled = (on: boolean) => localStorage.setItem(KEY, on ? '1' : '0');

let ac: AudioContext | null = null;
function ctx(): AudioContext | null {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    if (!ac) ac = new AC();
    if (ac!.state === 'suspended') ac!.resume().catch(() => {});
    return ac;
  } catch { return null; }
}
/** chame num toque/clique (o navegador só libera o som depois de um gesto) */
export const unlockAudio = () => { ctx(); };

function tone(freq: number, ms: number, when = 0, vol = 0.18) {
  const a = ctx(); if (!a) return;
  const o = a.createOscillator(); const g = a.createGain();
  o.type = 'square'; o.frequency.value = freq;
  const t = a.currentTime + when;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.setValueAtTime(vol, t + ms / 1000 - 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + ms / 1000 + 0.02);
}
const vibrate = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* */ } };

/** leitura certa: bipe agudo curto + vibração */
export function scanOk() {
  if (beepEnabled()) tone(2400, 90);
  vibrate(60);
}
/** código desconhecido / erro: dois bipes graves + vibração dupla */
export function scanErr() {
  if (beepEnabled()) { tone(420, 120); tone(320, 160, 0.16); }
  vibrate([80, 60, 80]);
}
