// v3.3: teclado de quantidade/peso — grande no celular, rápido no PC, difícil de errar.
//  kg: 350 = 0,350 kg · 1,5 = 1,500 kg · 2 = 2 kg · +100 g/+250 g/+500 g/+1 kg · modo "valor em R$" (calcula o peso)
//  unidade: − / + e 1 · 2 · 3 · 6 · 12
// v3.4: o modo (⚖ Peso ou R$ Valor) fica travado no que o operador escolheu (por aparelho e por operador), até ele trocar.
import { useEffect, useMemo, useState } from 'react';
import { formatBRL, formatKg, formatQty, isGramEntry, kgEntryHint, kgForValue, lineValue, parseKgEntry, parseMoneyEntry, parseUnitEntry, Product, qtyToEntry, UNIT_LABEL } from '@folha/shared';
import { useApp } from '../ctx';

export type QtyMode = 'peso' | 'valor';
const modeKey = (userId: number | string | undefined) => `cc.qtyMode.${userId ?? 'anon'}`;
export function savedQtyMode(userId: number | string | undefined): QtyMode {
  try { return localStorage.getItem(modeKey(userId)) === 'valor' ? 'valor' : 'peso'; } catch { return 'peso'; }
}
function saveQtyMode(userId: number | string | undefined, m: QtyMode) { try { localStorage.setItem(modeKey(userId), m); } catch { /* sem localStorage */ } }

export function QtyPad({ product, initial, onChange, onEnter, autoKeys = true }: {
  product: Pick<Product, 'unit' | 'price_cents' | 'name'> & { promo_active?: boolean; regular_price_cents?: number } | null;
  initial: number; onChange: (qty: number) => void; onEnter?: (qty: number) => void; autoKeys?: boolean;
}) {
  const { user } = useApp();
  const kg = !product || product.unit === 'KG';
  const price = product?.price_cents ?? 0;
  // "valor em R$" só faz sentido em produto por kg com preço (peso manual sem produto fica sempre em peso)
  const canValor = kg && !!product && price > 0;
  const [mode, setModeState] = useState<QtyMode>(() => (canValor ? savedQtyMode(user?.id) : 'peso'));
  const startEntry = () => (initial > 0 ? (mode === 'valor' && canValor ? String(lineValue(initial, price)) : qtyToEntry(initial, kg)) : '');
  const [entry, setEntry] = useState(startEntry);
  const [fresh, setFresh] = useState(initial > 0); // 1ª tecla substitui o valor que já estava
  const [untouched, setUntouched] = useState(initial > 0); // sem mexer: mantém a quantidade original (sem arredondar pelo valor)
  const valor = mode === 'valor' && canValor;
  const qty = useMemo(() => {
    if (untouched) return initial;
    if (!kg) return parseUnitEntry(entry);
    if (valor) return kgForValue(parseMoneyEntry(entry), price);
    return Math.min(99999, parseKgEntry(entry));
  }, [entry, kg, valor, price, untouched, initial]);
  useEffect(() => { onChange(qty); }, [qty]); // eslint-disable-line

  const touch = () => { setUntouched(false); setFresh(false); };
  const type = (k: string) => {
    setEntry((e) => {
      const base = fresh ? '' : e;
      if (k === ',') return kg && !base.includes(',') ? (base || '0') + ',' : base;
      if (kg && !valor && base.includes(',') && base.split(',')[1].length >= 3) return base;
      if (valor && base.includes(',') && base.split(',')[1].length >= 2) return base;
      const n = base + k;
      return n.replace(/^0+(?=\d)/, '').slice(0, 9);
    });
    touch();
  };
  const back = () => { setEntry((e) => (fresh ? '' : e.slice(0, -1))); touch(); };
  /** botões rápidos: no modo R$ somam em reais; no peso somam gramas */
  const setQty = (q: number) => { setUntouched(false); setFresh(true); setEntry(q > 0 ? qtyToEntry(q, kg) : ''); };
  const addMoney = (c: number) => { const cur = untouched ? lineValue(initial, price) : parseMoneyEntry(entry); setUntouched(false); setFresh(true); setEntry(String(cur + c)); };
  const switchMode = (m: QtyMode) => {
    if (!canValor) return;
    saveQtyMode(user?.id, m); // trava no que o operador escolheu
    if (m === mode) return;
    // troca sem perder o que já estava: converte a quantidade atual para o outro modo
    const q = qty;
    setModeState(m); setUntouched(false); setFresh(q > 0);
    setEntry(q > 0 ? (m === 'valor' ? String(lineValue(q, price)) : qtyToEntry(q, true)) : '');
  };

  useEffect(() => {
    if (!autoKeys) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); type(e.key); }
      else if (e.key === ',' || e.key === '.') { e.preventDefault(); type(','); }
      else if (e.key === 'Backspace') { e.preventDefault(); back(); }
      else if (e.key === '+' && !kg) { e.preventDefault(); setQty(qty + 1000); }
      else if (e.key === '-' && !kg) { e.preventDefault(); setQty(Math.max(1000, qty - 1000)); }
      else if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(qty); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  const unitLbl = kg ? 'kg' : UNIT_LABEL[product!.unit];
  const money = untouched ? lineValue(initial, price) : parseMoneyEntry(entry);
  const shown = !kg ? String(qty / 1000) : valor ? formatBRL(money) : formatKg(qty);
  // campo: quando "fresco" mostra o valor formatado (selecionado); ao digitar no teclado do celular vale só o que foi digitado
  const onInput = (raw: string) => {
    let v = raw;
    if (fresh && raw.startsWith(shown)) v = raw.slice(shown.length);
    // R$: estilo maquininha — os dígitos entram pela direita (5 → 0,05 · 50 → 0,50 · 500 → 5,00)
    if (valor) { setEntry(String(Math.min(99999999, parseInt(v.replace(/\D/g, '') || '0', 10)))); touch(); return; }
    v = v.replace(/R\$\s?/g, '').replace(/[^\d,.]/g, '').replace('.', ',');
    if (v.split(',').length > 2) v = v.slice(0, v.lastIndexOf(','));
    setEntry(v); touch();
  };
  const value = lineValue(qty, price);
  const placeholder = !kg ? '0' : valor ? 'R$ 0,00' : '0,000';
  return (
    <div className={`qpad ${valor ? 'mode-valor' : 'mode-peso'}`} data-testid="qtypad" data-mode={kg ? (valor ? 'valor' : 'peso') : 'un'}>
      {canValor && (
        <div className="tabs qpad-mode" role="tablist" aria-label="Como digitar">
          <button role="tab" aria-selected={!valor} className={!valor ? 'on' : ''} onClick={() => switchMode('peso')} data-testid="qpad-peso">{!valor && '✓ '}⚖ Peso (kg)</button>
          <button role="tab" aria-selected={valor} className={valor ? 'on' : ''} onClick={() => switchMode('valor')} data-testid="qpad-valor">{valor && '✓ '}R$ Valor</button>
        </div>
      )}
      <div className={`qpad-display ${fresh ? 'fresh' : ''}`} data-testid="qpad-display">
        {kg && <span className="qpad-badge" data-testid="qpad-badge">{valor ? 'R$ VALOR' : 'PESO'}</span>}
        <input className="qpad-in" inputMode="decimal" aria-label={kg ? (valor ? 'Valor em reais' : 'Peso em kg') : 'Quantidade'}
          value={fresh || (valor && entry) ? shown : entry} placeholder={placeholder} onFocus={(e) => e.target.select()}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(qty); } }} />
        <span className="u">{valor ? '' : kg && !fresh && isGramEntry(entry) ? 'g' : unitLbl}</span>
      </div>
      <div className="qpad-hint small" data-testid="qpad-hint">
        {!kg ? `${formatQty(qty, product!.unit)}`
          : valor ? (entry || untouched ? `${formatBRL(money)} = ${formatKg(qty)} kg` : 'Valor em R$: 5,00 ou 500 = R$ 5,00')
          : fresh ? 'digite para trocar' : kgEntryHint(entry)}
      </div>
      {product && qty > 0 && (
        <div className="qpad-preview num" data-testid="qpad-preview">
          {kg ? `${formatKg(qty)} kg` : formatQty(qty, product.unit)} × {formatBRL(price)}/{unitLbl}{product.promo_active ? ' (PROMO)' : ''} = <b>{formatBRL(value)}</b>
        </div>
      )}
      <div className="qpad-quick">
        {kg ? (valor ? <>
          {[100, 200, 500, 1000].map((c) => <button key={c} className="btn" onClick={() => addMoney(c)}>+{formatBRL(c).replace(',00', '')}</button>)}
        </> : <>
          {[100, 250, 500].map((g) => <button key={g} className="btn" onClick={() => setQty((untouched ? initial : qty) + g)}>+{g} g</button>)}
          <button className="btn" onClick={() => setQty(qty + 1000)}>+1 kg</button>
        </>) : <>
          <button className="btn qstep" onClick={() => setQty(Math.max(1000, qty - 1000))} aria-label="Menos um">−</button>
          {[1, 2, 3, 6, 12].map((n) => <button key={n} className={`btn ${qty === n * 1000 ? 'on' : ''}`} onClick={() => setQty(n * 1000)}>{n}</button>)}
          <button className="btn qstep" onClick={() => setQty(qty + 1000)} aria-label="Mais um">+</button>
        </>}
      </div>
      <div className="pinpad qpad-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} onClick={() => type(d)}>{d}</button>)}
        {kg ? <button className="alt" onClick={() => type(',')}>,</button> : <button className="alt" onClick={() => setQty(0)}>Zerar</button>}
        <button onClick={() => type('0')}>0</button>
        <button className="alt" onClick={back} aria-label="Apagar">⌫</button>
      </div>
    </div>
  );
}
