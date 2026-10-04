// O Postgres devolve timestamptz em ISO (UTC). A interface espera "AAAA-MM-DD HH:MM:SS" no horário local.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$/;
const p = (n: number) => String(n).padStart(2, '0');
export function isoToLocal(s: string) {
  const d = new Date(s);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export function localizeDates<T>(v: T): T {
  if (typeof v === 'string') return (ISO.test(v) ? isoToLocal(v) : v) as any;
  if (Array.isArray(v)) return v.map(localizeDates) as any;
  if (v && typeof v === 'object') {
    const o: any = {};
    for (const [k, x] of Object.entries(v)) o[k] = localizeDates(x);
    return o;
  }
  return v;
}
