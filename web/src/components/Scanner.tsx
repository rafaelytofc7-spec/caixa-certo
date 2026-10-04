// Janela do leitor de código de barras pela câmera (EAN-13, EAN-8, UPC, Code128, QR).
import { ReactNode, useEffect, useRef, useState } from 'react';
import { cameraError, Engine, getEngine } from '../scan/engine';
import { unlockAudio } from '../scan/feedback';
import { isMedian, openAppSettings } from '../pwa';

export interface ScanReply { close?: boolean; ok?: boolean; msg?: string }
const CAM_KEY = 'cc.scan.cam';

export function Scanner({ title = 'Ler código de barras', onDetected, onClose, continuous = false, hint }: {
  title?: string; continuous?: boolean; hint?: ReactNode;
  onDetected: (code: string, format: string) => Promise<ScanReply | void> | ScanReply | void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cbRef = useRef(onDetected); cbRef.current = onDetected;
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const busy = useRef(false);
  const last = useRef({ code: '', at: 0 });
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(() => localStorage.getItem(CAM_KEY));
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'abrindo' | 'lendo' | 'erro'>('abrindo');
  const [err, setErr] = useState<{ title: string; help: string; retry: boolean } | null>(null);
  const [engine, setEngine] = useState<Engine['name'] | null>(null);
  const [torchOk, setTorchOk] = useState(false);
  const [torch, setTorch] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean; n: number } | null>(null);
  const [manual, setManual] = useState(false);
  const [typed, setTyped] = useState('');
  const [flash, setFlash] = useState(0);

  const deliver = async (code: string, format: string) => {
    busy.current = true; setFlash((f) => f + 1);
    let r: ScanReply | void;
    try { r = await cbRef.current(code, format); } catch (e: any) { r = { ok: false, msg: e?.message ?? String(e) }; }
    if (r?.msg) setMsg({ t: r.msg, ok: r.ok !== false, n: Date.now() });
    if (r?.close || (!continuous && r?.ok !== false)) { closeRef.current(); return; }
    setTimeout(() => { busy.current = false; }, 900);
  };

  useEffect(() => {
    let alive = true; let timer = 0; let stream: MediaStream | null = null;
    setPhase('abrindo'); setErr(null); setTorch(false); setTorchOk(false);
    (async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insegura'), { name: 'Insecure' });
        const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: 'environment' }, ...size } });
        } catch (e: any) {
          if (deviceId && (e?.name === 'OverconstrainedError' || e?.name === 'NotFoundError')) { localStorage.removeItem(CAM_KEY); setDeviceId(null); return; }
          throw e;
        }
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = videoRef.current!;
        v.srcObject = stream; v.muted = true; v.setAttribute('playsinline', '');
        await v.play().catch(() => {});
        const track = stream.getVideoTracks()[0]; trackRef.current = track;
        const caps: any = track.getCapabilities?.() ?? {};
        setTorchOk(!!caps.torch);
        if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }).catch(() => {});
        navigator.mediaDevices.enumerateDevices().then((ds) => alive && setCams(ds.filter((d) => d.kind === 'videoinput'))).catch(() => {});
        const eng = await getEngine();
        if (!alive) return;
        setEngine(eng.name); setPhase('lendo');
        const tick = async () => {
          if (!alive) return;
          if (!busy.current && v.readyState >= 2) {
            const hit = await eng.detect(v).catch(() => null);
            if (hit && alive) {
              const now = Date.now();
              const same = hit.code === last.current.code && now - last.current.at < 2500;
              last.current = { code: hit.code, at: now }; // enquanto o mesmo código fica na frente, não soma de novo
              if (!same) await deliver(hit.code, hit.format);
            }
          }
          if (alive) timer = window.setTimeout(tick, eng.name === 'nativo' ? 120 : 160);
        };
        tick();
      } catch (e: any) {
        if (!alive) return;
        setErr(cameraError(e)); setPhase('erro'); setManual(true);
      }
    })();
    return () => { alive = false; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); trackRef.current = null; };
  }, [deviceId, attempt]); // eslint-disable-line

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    window.addEventListener('keydown', h, true); return () => window.removeEventListener('keydown', h, true);
  }, []);

  const switchCam = () => {
    if (cams.length < 2) return;
    const cur = trackRef.current?.getSettings?.().deviceId ?? deviceId;
    const i = cams.findIndex((c) => c.deviceId === cur);
    const next = cams[(i + 1) % cams.length].deviceId;
    localStorage.setItem(CAM_KEY, next); setDeviceId(next);
  };
  const toggleTorch = async () => {
    const t = trackRef.current; if (!t) return;
    try { await t.applyConstraints({ advanced: [{ torch: !torch } as any] }); setTorch(!torch); } catch { setTorchOk(false); }
  };
  const sendTyped = () => { const c = typed.trim(); if (!c) return; setTyped(''); deliver(c, 'digitado'); };

  return (
    <div className="overlay scanner-overlay" data-scanner role="dialog" aria-modal aria-label={title} onMouseDown={(e) => { unlockAudio(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="scanner">
        <div className="scanner-h">
          <b className="grow">📷 {title}</b>
          <button className="x" onClick={onClose} aria-label="Fechar leitor">×</button>
        </div>
        <div className={`scanner-view ${phase}`}>
          <video ref={videoRef} playsInline muted autoPlay />
          {phase !== 'erro' && <div className="scan-frame" key={flash}><span className="laser" /><i /><i /><i /><i /></div>}
          {phase === 'abrindo' && <div className="scan-state">Abrindo a câmera…<small>Se o navegador perguntar, toque em <b>Permitir</b>.</small></div>}
          {phase === 'erro' && err && <div className="scan-state err" role="alert">
            <span className="em">🚫</span><b>{err.title}</b><small>{err.help}</small>
            {err.retry && <button className="btn btn-primary" onClick={() => setAttempt((a) => a + 1)}>Tentar de novo</button>}
            {isMedian() && /permissão/i.test(err.title) && <button className="btn" onClick={() => openAppSettings()} data-testid="scan-app-settings">⚙️ Configurações do app</button>}
          </div>}
        </div>
        <div className="scanner-f">
          {msg ? <div key={msg.n} className={`scan-msg ${msg.ok ? 'ok' : 'erro'}`} role="status">{msg.t}</div>
            : <div className="scan-msg">{phase === 'lendo' ? 'Aponte para o código de barras, a um palmo de distância.' : hint ?? ' '}</div>}
          {manual && <div className="row">
            <input className="input grow" inputMode="numeric" autoFocus={phase === 'erro'} placeholder="Digite o código (EAN) e toque em OK" value={typed}
              onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); sendTyped(); } }} aria-label="Código digitado" />
            <button className="btn btn-primary" onClick={sendTyped} disabled={!typed.trim()}>OK</button>
          </div>}
          <div className="row wrap scan-tools">
            {torchOk && <button className={`btn btn-sm ${torch ? 'btn-lima' : ''}`} onClick={toggleTorch}>🔦 Lanterna</button>}
            {cams.length > 1 && <button className="btn btn-sm" onClick={switchCam}>🔄 Trocar câmera</button>}
            {!manual && <button className="btn btn-sm" onClick={() => setManual(true)}>⌨ Digitar código</button>}
            <span className="spacer" />
            {engine && <span className="small muted">{continuous ? 'leitura contínua · ' : ''}{engine === 'nativo' ? 'leitor do aparelho' : 'leitor ZXing'}</span>}
            <button className="btn btn-sm" onClick={onClose}>{continuous ? 'Concluir' : 'Fechar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
