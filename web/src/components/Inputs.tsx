import { forwardRef, InputHTMLAttributes, useRef } from 'react';
import { formatMoney, formatKg } from '@folha/shared';

type Base = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;

/** Dinheiro estilo maquininha: digita 1250 -> 12,50 */
export const MoneyInput = forwardRef<HTMLInputElement, Base & { value: number; onChange: (c: number) => void; big?: boolean }>(
  function MoneyInput({ value, onChange, big, className, ...rest }, ref) {
    return <input ref={ref} {...rest} inputMode="numeric" className={`input num ${big ? 'big' : ''} ${className ?? ''}`}
      value={'R$ ' + formatMoney(value)} onFocus={(e) => e.target.select()}
      onChange={(e) => { const d = e.target.value.replace(/\D/g, ''); onChange(Math.min(99999999, parseInt(d || '0', 10))); }} />;
  });

/** Peso/quantidade em milésimos: digita 1250 -> 1,250 */
export const QtyInput = forwardRef<HTMLInputElement, Base & { value: number; onChange: (q: number) => void; kg: boolean; big?: boolean }>(
  function QtyInput({ value, onChange, kg, big, className, ...rest }, ref) {
    const fresh = useRef(true);
    if (!kg) return <input ref={ref} {...rest} inputMode="numeric" className={`input num ${big ? 'big' : ''} ${className ?? ''}`}
      value={String(Math.round(value / 1000))} onFocus={(e) => e.target.select()}
      onChange={(e) => onChange(parseInt(e.target.value.replace(/\D/g, '') || '0', 10) * 1000)} />;
    return <input ref={ref} {...rest} inputMode="numeric" className={`input num ${big ? 'big' : ''} ${className ?? ''}`}
      value={formatKg(value)} onFocus={(e) => { fresh.current = true; e.target.select(); }}
      onChange={(e) => { const d = e.target.value.replace(/\D/g, ''); fresh.current = false; onChange(Math.min(9999999, parseInt(d || '0', 10))); }} />;
  });
