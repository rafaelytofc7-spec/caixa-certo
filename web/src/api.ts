export class ApiError extends Error {
  constructor(public status: number, message: string, public code: string) { super(message); }
}

const TOKEN_KEY = 'cc.token';
const TERMINAL_KEY = 'cc.terminal';
export const getToken = () => localStorage.getItem(TOKEN_KEY) ?? '';
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
export const getTerminal = () => localStorage.getItem(TERMINAL_KEY) || 'CAIXA-01';
export const setTerminal = (t: string) => localStorage.setItem(TERMINAL_KEY, t.trim().toUpperCase() || 'CAIXA-01');

import { IS_SB } from './backend/mode';
export { IS_SB };

/** 'pin' = token do operador inválido (volta ao PIN); 'store' = conta da loja saiu (volta ao e-mail/senha) */
let onUnauthorized: (kind: 'pin' | 'store' | 'blocked') => void = () => {};
export const setOnUnauthorized = (f: (kind: 'pin' | 'store' | 'blocked') => void) => { onUnauthorized = f; };
export const notifyUnauthorized = (kind: 'pin' | 'store' | 'blocked') => onUnauthorized(kind);

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  if (IS_SB) { const m = await import('./backend/supabase'); return m.sbApi(method, url, body) as Promise<T>; }
  const headers: Record<string, string> = { 'x-terminal': getTerminal() };
  const t = getToken(); if (t) headers.authorization = `Bearer ${t}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor local do caixa. Ele está ligado?', 'SEM_SERVIDOR');
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && data?.code === 'SEM_LOGIN') onUnauthorized('pin');
    throw new ApiError(res.status, data?.error ?? `Erro ${res.status}`, data?.code ?? 'ERRO');
  }
  return data as T;
}
export const get = <T = any>(u: string) => api<T>('GET', u);
export const post = <T = any>(u: string, b?: unknown) => api<T>('POST', u, b ?? {});
export const put = <T = any>(u: string, b?: unknown) => api<T>('PUT', u, b ?? {});
export const del = <T = any>(u: string) => api<T>('DELETE', u);

/** URL autenticada para abrir em nova aba (PDF, HTML, CSV, .bin) */
export const authUrl = (u: string) => `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken())}`;

export const todayISO = () => {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const isoDaysAgo = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n); const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const fmtDateTime = (s: string) => {
  if (!s) return '';
  const [d, t] = s.split(' '); const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}${t ? ' ' + t.slice(0, 5) : ''}`;
};
export const fmtDate = (s: string) => { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
