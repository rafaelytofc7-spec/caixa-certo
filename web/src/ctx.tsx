import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import type { Role } from '@folha/shared';
import { get, post, setToken, setOnUnauthorized, getToken, ApiError, IS_SB } from './api';
import { PinModal } from './components/PinPad';
import type { Loja, SignupForm } from './backend/accounts';

export interface ToastAction { label: string; onClick: () => void }
export interface Me { id: number; name: string; role: Role; username?: string }
interface Ctx {
  user: Me | null; setUser: (u: Me | null) => void;
  status: any; refreshStatus: () => Promise<void>;
  toast: (msg: string, kind?: 'ok' | 'erro', action?: ToastAction) => void;
  /** Executa fn; se o servidor pedir gerente, pede o PIN e repete. */
  withManager: <T>(fn: (pin?: string) => Promise<T>, why?: string) => Promise<T | null>;
  logout: () => void;
  /** modo online: login (usuário + senha) deste aparelho — 'loading' | 'out' | usuário */
  store: string; storeLogout: () => Promise<void>;
  /** entra com CPF/CNPJ + usuário + senha e já abre o caixa para a pessoa */
  passwordLogin: (doc: string, username: string, password: string) => Promise<void>;
  /** "Criar conta da loja" (teste grátis) e já entra */
  register: (f: SignupForm) => Promise<void>;
  /** situação da assinatura da loja (online) — null enquanto carrega / modo local */
  loja: Loja | null; refreshLoja: () => Promise<void>;
  authBusy: boolean;
  /** volta para a tela de PIN (troca rápida de operador), sem sair do login do aparelho */
  switchOperator: () => void;
  online: boolean; pending: { n: number; errors: number }; flush: () => Promise<void>;
  route: string; go: (r: string) => void;
}
const C = createContext<Ctx>(null as any);
export const useApp = () => useContext(C);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [toastMsg, setToastMsg] = useState<{ m: string; k: 'ok' | 'erro'; a?: ToastAction } | null>(null);
  const [pinAsk, setPinAsk] = useState<{ why: string; error?: string; resolve: (p: string | null) => void } | null>(null);
  const [route, setRoute] = useState(() => location.hash.replace('#/', '') || 'venda');
  const timer = useRef<number>();
  const [store, setStore] = useState<string>(IS_SB ? 'loading' : 'local');
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pending, setPending] = useState({ n: 0, errors: 0 });
  const [authBusy, setAuthBusy] = useState(false);
  const [loja, setLoja] = useState<Loja | null>(() => { if (!IS_SB) return null; try { return JSON.parse(localStorage.getItem('cc.loja') || 'null'); } catch { return null; } });

  // ---- modo online: sessão da conta da loja + fila offline ----
  useEffect(() => {
    if (!IS_SB) return;
    let unsub = () => {};
    (async () => {
      const { sb } = await import('./backend/client');
      const { data } = await sb().auth.getSession();
      const { usernameOf, myStore } = await import('./backend/accounts');
      if (data.session?.user?.email) {
        // confere a loja antes de abrir o app (bloqueio / vencimento). Sem internet: usa a última situação conhecida.
        try { setLoja(await myStore()); } catch (e) {
          if (!(e instanceof ApiError && e.code === 'SEM_INTERNET')) { await sb().auth.signOut(); setLoja(null); }
        }
      }
      setStore(data.session?.user?.email ? usernameOf(data.session.user.email) : 'out');
      const { data: sub } = sb().auth.onAuthStateChange((_e, s) => { setStore(s?.user?.email ? usernameOf(s.user.email) : 'out'); if (!s) setLoja(null); });
      unsub = () => sub.subscription.unsubscribe();
      const off = await import('./backend/offline');
      const upd = () => { const q = off.queue(); setPending({ n: q.length, errors: q.filter((x) => x.error).length }); };
      upd(); const u2 = off.onQueueChange(upd); const prev = unsub; unsub = () => { prev(); u2(); };
    })();
    const on = () => setOnline(true); const offf = () => setOnline(false);
    const netEv = (e: Event) => setOnline(!!(e as CustomEvent).detail && navigator.onLine);
    window.addEventListener('online', on); window.addEventListener('offline', offf); window.addEventListener('cc:net', netEv);
    return () => { unsub(); window.removeEventListener('online', on); window.removeEventListener('offline', offf); window.removeEventListener('cc:net', netEv); };
  }, []);
  const flush = useCallback(async () => {
    if (!IS_SB) return;
    const m = await import('./backend/supabase');
    const r = await m.flushQueue();
    if (r.sent) { setToastMsg({ m: `${r.sent} venda(s) feitas sem internet foram enviadas.`, k: 'ok' }); }
    if (r.failed) { setToastMsg({ m: `${r.failed} venda(s) offline com erro — veja a faixa no topo.`, k: 'erro' }); }
  }, []);
  useEffect(() => {
    if (!IS_SB || store === 'loading' || store === 'out') return;
    if (online) flush();
    // tenta de novo a cada 20 s (também serve para perceber que a rede voltou)
    const i = setInterval(() => { if (navigator.onLine) { flush(); if (getToken()) refreshStatus(); } }, 20000);
    return () => clearInterval(i);
  }, [online, store, flush]); // eslint-disable-line
  const storeLogout = useCallback(async () => {
    const { sb } = await import('./backend/client');
    try { await post('/api/auth/logout'); } catch { /* */ }
    setToken(null); setUser(null); setStatus(null); setLoja(null);
    try { localStorage.removeItem('cc.loja'); } catch { /* */ }
    await sb().auth.signOut();
  }, []);
  const refreshLoja = useCallback(async () => {
    if (!IS_SB) return;
    try {
      const a = await import('./backend/accounts'); const l = await a.myStore(); setLoja(l);
      // acabou de ser liberada (pagamento registrado) e ninguém está no caixa: abre para quem fez o login, se a senha for recente
      if (l.liberada && !getToken()) { try { const r = await a.openOwnSession(); setUser(r.user as Me); } catch { /* cai na tela de PIN */ } }
    } catch { /* sem internet: mantém */ }
  }, []);

  const passwordLogin = useCallback(async (doc: string, username: string, password: string) => {
    setAuthBusy(true);
    try { const a = await import('./backend/accounts'); const r = await a.signIn(doc, username, password); setLoja(r.loja); setUser(r.user as Me | null); }
    finally { setAuthBusy(false); }
  }, []);
  const register = useCallback(async (f: SignupForm) => {
    setAuthBusy(true);
    try { const a = await import('./backend/accounts'); const r = await a.signupStore(f); setLoja(r.loja); setUser(r.user as Me | null); location.hash = '#/config/loja'; }
    finally { setAuthBusy(false); }
  }, []);
  const switchOperator = useCallback(() => { post('/api/auth/logout').catch(() => {}); setToken(null); setUser(null); setStatus(null); }, []);

  useEffect(() => {
    const f = () => setRoute(location.hash.replace('#/', '') || 'venda');
    window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f);
  }, []);
  const go = (r: string) => { location.hash = '#/' + r; };

  const toast = useCallback((m: string, k: 'ok' | 'erro' = 'ok', a?: ToastAction) => {
    setToastMsg({ m, k, a }); window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastMsg(null), a ? 9000 : k === 'erro' ? 5000 : 2600);
  }, []);
  const logout = useCallback(() => { post('/api/auth/logout').catch(() => {}); setToken(null); setUser(null); setStatus(null); }, []);
  useEffect(() => { setOnUnauthorized((kind) => {
    setToken(null); setUser(null);
    if (kind === 'store' && IS_SB) import('./backend/client').then(({ sb }) => sb().auth.signOut());
    if (kind === 'blocked' && IS_SB) refreshLoja();
  }); }, [refreshLoja]);
  // confere a situação da loja de tempos em tempos (pagamento registrado / bloqueio aparecem sem sair)
  useEffect(() => {
    if (!IS_SB || store === 'loading' || store === 'out') return;
    const i = setInterval(() => { if (navigator.onLine) refreshLoja(); }, 10 * 60000);
    return () => clearInterval(i);
  }, [store, refreshLoja]);
  useEffect(() => {
    if (!getToken() || store === 'loading' || store === 'out') return;
    get('/api/auth/me').then((r) => setUser(r.user)).catch((e) => { if (!(e instanceof ApiError && e.code === 'SEM_INTERNET')) setToken(null); });
  }, [store]);
  const refreshStatus = useCallback(async () => { try { setStatus(await get('/api/status')); } catch { /* */ } }, []);
  useEffect(() => { if (user) { refreshStatus(); const i = setInterval(refreshStatus, 60000); return () => clearInterval(i); } }, [user, refreshStatus]);

  const askPin = (why: string, error?: string) => new Promise<string | null>((resolve) => setPinAsk({ why, error, resolve }));
  const withManager = useCallback(async <T,>(fn: (pin?: string) => Promise<T>, why = 'Autorização do gerente'): Promise<T | null> => {
    try { return await fn(undefined); } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'PRECISA_GERENTE') throw e;
      let msg = e.message; let err: string | undefined;
      for (;;) {
        const pin = await askPin(msg || why, err);
        if (!pin) return null;
        try { const r = await fn(pin); setPinAsk(null); return r; } catch (e2) {
          if (e2 instanceof ApiError && e2.code === 'PRECISA_GERENTE') { err = e2.message; continue; }
          setPinAsk(null); throw e2;
        }
      }
    }
  }, []);

  return (
    <C.Provider value={{ user, setUser, status, refreshStatus, toast, withManager, logout, route, go, store, storeLogout, online, pending, flush, passwordLogin, register, authBusy, switchOperator, loja, refreshLoja }}>
      {children}
      {pinAsk && <PinModal title="PIN do gerente" subtitle={pinAsk.why} error={pinAsk.error}
        onCancel={() => { pinAsk.resolve(null); setPinAsk(null); }}
        onSubmit={(p) => { pinAsk.resolve(p); }} />}
      {toastMsg && <div className={`toast ${toastMsg.k} ${toastMsg.a ? 'has-act' : ''}`} role="status"><span>{toastMsg.m}</span>
        {toastMsg.a && <button className="toast-act" onClick={() => { const a = toastMsg.a!; setToastMsg(null); a.onClick(); }}>{toastMsg.a.label}</button>}</div>}
    </C.Provider>
  );
}
