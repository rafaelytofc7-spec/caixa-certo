// Contas do modo online: CPF/CNPJ da loja + usuário + senha. Viram o e-mail interno
// <documento>.<usuario>@lojas.caixacerto.invalid no Supabase Auth (ninguém recebe e-mail).
// Contas são criadas por funções do banco (account_signup, account_user_create…), que conferem quem chama.
import { sb } from './client';
import { ApiError, getToken, getTerminal, setToken } from '../api';
import { STORE_EMAIL_DOMAIN } from '@folha/shared';
import { docDigits } from '../doc';
import { cacheKey } from './offline';

export { USER_RE } from '../text';
export const cleanUsername = (u: string) => u.trim().toLowerCase();
export const toEmail = (doc: string, u: string) => `${docDigits(doc).toLowerCase()}.${cleanUsername(u)}@${STORE_EMAIL_DOMAIN}`;
/** "52998224725.maria@lojas…" → "maria" */
export const usernameOf = (email?: string | null) => (email ?? '').replace(`@${STORE_EMAIL_DOMAIN}`, '').replace(/^[0-9a-z]+\./, '');

const netErr = () => new ApiError(0, 'Sem internet. Conecte para entrar.', 'SEM_INTERNET');

/** chama uma função de conta do banco (sem Edge Function: cada função confere quem chama) */
export async function callRpc(fn: string, args: Record<string, unknown>) {
  let r;
  try { r = await sb().rpc(fn, args); } catch { throw netErr(); }
  if (r.error) {
    if (/fetch|network/i.test(r.error.message)) throw netErr();
    const code = r.error.hint && /^[A-Z_]+$/.test(r.error.hint) ? r.error.hint : 'ERRO';
    throw new ApiError(code === 'PROIBIDO' ? 403 : code === 'SEM_LOGIN' || code === 'SEM_PIN' ? 401 : 400, r.error.message, code);
  }
  return r.data;
}

/** lojas já usadas neste aparelho: documento → nome (para mostrar o nome da loja no login) */
const KNOWN = 'cc.lojas';
export function knownStores(): Record<string, string> { try { return JSON.parse(localStorage.getItem(KNOWN) || '{}'); } catch { return {}; } }
export function rememberStore(doc: string, name: string) {
  try { localStorage.setItem(KNOWN, JSON.stringify({ ...knownStores(), [docDigits(doc)]: name })); localStorage.setItem('cc.lastDoc', docDigits(doc)); } catch { /* */ }
}

/** Entra com CPF/CNPJ + usuário + senha e já abre a sessão do caixa para a pessoa (sem PIN). */
export async function signIn(doc: string, username: string, password: string) {
  const u = cleanUsername(username);
  if (!docDigits(doc)) throw new ApiError(400, 'Digite o CPF ou CNPJ da loja.', 'DADOS');
  if (!u) throw new ApiError(400, 'Digite o usuário.', 'DADOS');
  let res;
  try { res = await sb().auth.signInWithPassword({ email: toEmail(doc, u), password }); } catch { throw netErr(); }
  if (res.error) {
    if (/fetch|network/i.test(res.error.message)) throw netErr();
    throw new ApiError(401, 'CPF/CNPJ, usuário ou senha incorretos.', 'LOGIN_ERRADO');
  }
  const loja = await myStore().catch(async (e) => { await sb().auth.signOut(); throw e; });
  rememberStore(doc, loja.nome);
  if (!loja.liberada) return { user: null, loja };
  const s = await openOwnSession();
  return { ...s, loja };
}

/** situação da loja do login (status, vencimento, liberada…) */
export async function myStore(): Promise<Loja> {
  const r = await sb().rpc('minha_loja');
  if (r.error) {
    if (/fetch|network/i.test(r.error.message)) throw netErr();
    throw new ApiError(401, r.error.message, r.error.hint || 'SEM_LOJA');
  }
  try { localStorage.setItem('cc.loja', JSON.stringify(r.data)); } catch { /* */ }
  return r.data as Loja;
}
export interface Loja {
  id: string; nome: string; documento: string; tipo_documento: 'CPF' | 'CNPJ'; status: 'teste' | 'ativa' | 'bloqueada';
  vencimento: string; dias_restantes: number; liberada: boolean; em_carencia: boolean; bloqueio_em: string; aviso_dias: number;
  plano: string; valor_mensal_cents: number; motivo_bloqueio: string | null; usuario: string; papel: string;
}

export async function openOwnSession() {
  const r = await sb().rpc('self_login', { p_terminal: getTerminal() });
  if (r.error) {
    if (r.error.hint !== 'SENHA_DE_NOVO' && r.error.hint !== 'LOJA_BLOQUEADA') await sb().auth.signOut();
    throw new ApiError(401, r.error.message, r.error.hint || 'SEM_LOGIN');
  }
  setToken(r.data.token);
  try { localStorage.setItem(cacheKey('/api/auth/me'), JSON.stringify({ user: r.data.user, terminal: getTerminal() })); } catch { /* */ }
  return r.data as { token: string; user: { id: number; name: string; role: any; username: string } };
}

export interface SignupForm { loja_nome: string; documento: string; responsavel: string; usuario: string; senha: string; whatsapp: string; pin?: string }
/** "Criar conta da loja": cria a loja (teste grátis) + o login do dono, e já entra. */
export async function signupStore(f: SignupForm) {
  await callRpc('account_signup', { p_data: { ...f, documento: docDigits(f.documento), usuario: cleanUsername(f.usuario) } });
  return signIn(f.documento, f.usuario, f.senha);
}

/** Dono cria funcionário com usuário + senha (+ PIN opcional) — o login usa o CPF/CNPJ da loja */
export const createUser = (f: { name: string; username: string; password: string; role: string; pin?: string }) =>
  callRpc('account_user_create', { p_token: getToken(), p_data: { ...f, username: cleanUsername(f.username) } });

/** Dono define uma nova senha para alguém da loja */
export const setPassword = (userId: number, password: string) => callRpc('account_user_password', { p_token: getToken(), p_user_id: userId, p_password: password });

/** Troca a própria senha (confere a atual antes) */
export async function changeOwnPassword(current: string, next: string) {
  const { data } = await sb().auth.getSession();
  const email = data.session?.user?.email;
  if (!email) throw new ApiError(401, 'Entre com usuário e senha.', 'SEM_LOGIN');
  const chk = await sb().auth.signInWithPassword({ email, password: current });
  if (chk.error) throw new ApiError(400, /fetch/i.test(chk.error.message) ? 'Sem internet.' : 'Senha atual incorreta.', 'SENHA_ERRADA');
  const { error } = await sb().auth.updateUser({ password: next });
  if (error) throw new ApiError(400, error.message, 'AUTH');
}
