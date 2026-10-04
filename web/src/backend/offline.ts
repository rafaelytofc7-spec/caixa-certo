// Fila offline de vendas (modo online). Só aceita vendas sem fiado e sem desconto acima do limite
// (essas precisam do banco na hora). Cada venda leva um client_uuid: reenviar nunca duplica.
// Cada venda guarda a loja (loja_id): se outra loja entrar neste aparelho, a fila da primeira fica guardada
// e só é enviada quando aquela loja entrar de novo — nunca vai para a loja errada.
export interface QueuedSale { client_uuid: string; token: string; terminal: string; body: any; created_at: string; total_cents: number; error?: string; loja_id?: string }
const KEY = 'cc.offline.sales';
type L = () => void;
const listeners = new Set<L>();
export const onQueueChange = (f: L) => { listeners.add(f); return () => { listeners.delete(f); }; };
const emit = () => listeners.forEach((f) => f());
/** id da loja do login atual neste aparelho ('' se ninguém) */
export function currentLojaId(): string { try { return JSON.parse(localStorage.getItem('cc.loja') || 'null')?.id ?? ''; } catch { return ''; } }
/** chave do cache de leitura, separada por loja */
export const cacheKey = (u: string) => `cc.cache.${currentLojaId()}.${u}`;
function all(): QueuedSale[] { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
/** fila só da loja atual */
export function queue(): QueuedSale[] { const l = currentLojaId(); return l ? all().filter((s) => s.loja_id === l) : []; }
function save(q: QueuedSale[]) { localStorage.setItem(KEY, JSON.stringify(q)); emit(); }
export function enqueue(s: QueuedSale) { save([...all(), { ...s, loja_id: currentLojaId() }]); }
export function removeQueued(uuid: string) { save(all().filter((s) => s.client_uuid !== uuid)); }
export function markError(uuid: string, error: string) { save(all().map((s) => (s.client_uuid === uuid ? { ...s, error } : s))); }
export const uuid = () => (crypto as any).randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); });
