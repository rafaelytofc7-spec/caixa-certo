import { BRAND } from '@folha/shared';

export function Leaf({ size = 32, color = '#1F7A4D', vein = '#F7F4EC' }: { size?: number; color?: string; vein?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <path d="M54 8C30 8 12 20 12 40c0 5 1.5 9.5 4 13l-6 6 3 3 6-6c3.5 2.5 8 4 13 4 20 0 22-28 22-52z" fill={color} />
      <path d="M19 48C27 37 36 28 46 20" stroke={vein} strokeWidth="3.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Folha (verde) + 1ª palavra do nome em peso médio + resto em peso leve (o nome vem de BRAND) */
export function Logo({ size = 30, light = false }: { size?: number; light?: boolean }) {
  const c = light ? '#FFFFFF' : '#1C1917';
  const [first, ...rest] = BRAND.name.split(' ');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.28 }} aria-label={BRAND.name}>
      <span style={{ display: 'inline-flex', background: light ? '#F7F4EC' : 'transparent', borderRadius: size * 0.3, padding: light ? size * 0.1 : 0 }}>
        <Leaf size={light ? size * 0.85 : size} />
      </span>
      <span style={{ fontSize: size * 0.78, letterSpacing: '-.02em', color: c, lineHeight: 1, whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 500 }}>{first}</span>{rest.length > 0 && <span style={{ fontWeight: 300 }}> {rest.join(' ')}</span>}
      </span>
    </div>
  );
}
