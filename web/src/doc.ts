// CPF / CNPJ: máscara e dígitos verificadores (o banco confere de novo no cadastro).
// CNPJ alfanumérico (a partir de 2026): letras nas 12 primeiras posições valem (código ASCII − 48).
export const docDigits = (v: string) => (v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

export function maskDoc(v: string): string {
  const d = docDigits(v).slice(0, 14);
  const onlyNum = /^\d*$/.test(d);
  if (onlyNum && d.length <= 11) {
    return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return d.replace(/^(\w{2})(\w)/, '$1.$2').replace(/^(\w{2})\.(\w{3})(\w)/, '$1.$2.$3').replace(/\.(\w{3})(\w)/, '.$1/$2').replace(/(\w{4})(\w{1,2})$/, '$1-$2');
}

function cpfOk(d: string) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
function cnpjOk(d: string) {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(d) || /^(.)\1{13}$/.test(d)) return false;
  const v = [...d].map((c) => c.charCodeAt(0) - 48);
  const dv = (n: number) => { const w = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; let s = 0; for (let i = 0; i < n; i++) s += v[i] * w[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === v[12] && dv(13) === v[13];
}
/** 'CPF' | 'CNPJ' se válido; null se não */
export function docType(v: string): 'CPF' | 'CNPJ' | null {
  const d = docDigits(v);
  if (d.length === 11 && cpfOk(d)) return 'CPF';
  if (d.length === 14 && cnpjOk(d)) return 'CNPJ';
  return null;
}
export const maskPhoneBR = (v: string) => {
  const d = (v ?? '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
