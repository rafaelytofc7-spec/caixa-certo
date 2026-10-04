import { useEffect, useState } from 'react';
import { Modal } from './Modal';

export function PinPad({ onSubmit, disabled }: { onSubmit: (pin: string) => void; disabled?: boolean }) {
  const [pin, setPin] = useState('');
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (disabled) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); setPin((p) => (p.length < 4 ? p + e.key : p)); }
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [disabled]);
  useEffect(() => { if (pin.length === 4) { const p = pin; setTimeout(() => { onSubmit(p); setPin(''); }, 120); } }, [pin]); // eslint-disable-line
  const press = (d: string) => setPin((p) => (p.length < 4 ? p + d : p));
  return (
    <div>
      <div className="pin-dots" aria-label="PIN">{[0, 1, 2, 3].map((i) => <span key={i} className={i < pin.length ? 'f' : ''} />)}</div>
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" onClick={() => press(d)} disabled={disabled}>{d}</button>)}
        <button type="button" className="alt" onClick={() => setPin('')}>Limpar</button>
        <button type="button" onClick={() => press('0')} disabled={disabled}>0</button>
        <button type="button" className="alt" onClick={() => setPin((p) => p.slice(0, -1))}>⌫</button>
      </div>
    </div>
  );
}

export function PinModal({ title, subtitle, error, onSubmit, onCancel }: {
  title: string; subtitle?: string; error?: string; onSubmit: (p: string) => void; onCancel: () => void;
}) {
  return (
    <Modal title={`🔒 ${title}`} onClose={onCancel} size="sm" z={70}>
      {subtitle && <div className="ok-box" style={{ background: 'var(--ambar-clara)', color: '#7A4E0E' }}>{subtitle}</div>}
      {error && <div className="err">{error}</div>}
      <PinPad onSubmit={onSubmit} />
      <button className="btn" onClick={onCancel}>Voltar</button>
    </Modal>
  );
}
