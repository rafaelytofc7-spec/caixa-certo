// Cliente do painel: sessão própria (storageKey separado do app das lojas) e só RPCs admin_* (o banco recusa quem não é super admin).
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL_DOMAIN } from '@folha/shared';

const URL = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_KEY as string;
export const CONFIGURED = !!URL && !!KEY;

let _sb: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!_sb) _sb = createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cc.admin.auth' } });
  return _sb;
}
export const adminEmail = (u: string) => `${u.trim().toLowerCase()}@${ADMIN_EMAIL_DOMAIN}`;

export class AdminError extends Error { constructor(msg: string, public code = 'ERRO') { super(msg); } }

export async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let r;
  try { r = await sb().rpc(fn, args); } catch { throw new AdminError('Sem internet.', 'SEM_INTERNET'); }
  if (r.error) throw new AdminError(r.error.message, r.error.hint || r.error.code || 'ERRO');
  return r.data as T;
}

export async function fn(body: Record<string, unknown>) {
  const { data } = await sb().auth.getSession();
  if (!data.session) throw new AdminError('Entre de novo.', 'SEM_LOGIN');
  let r: Response;
  try {
    r = await fetch(`${URL}/functions/v1/accounts`, { method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw new AdminError('Sem internet.', 'SEM_INTERNET'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new AdminError(j.error || `Erro ${r.status}`, j.code || 'ERRO');
  return j;
}

export async function signIn(usuario: string, senha: string) {
  const { error } = await sb().auth.signInWithPassword({ email: adminEmail(usuario), password: senha });
  if (error) throw new AdminError(/fetch/i.test(error.message) ? 'Sem internet.' : 'Usuário ou senha incorretos.', 'LOGIN');
  try { return await rpc<{ usuario: string; config: Config }>('admin_me'); }
  catch (e) { await sb().auth.signOut(); throw new AdminError('Acesso negado.', 'PROIBIDO'); }
}

export async function changePassword(usuario: string, atual: string, nova: string) {
  const chk = await sb().auth.signInWithPassword({ email: adminEmail(usuario), password: atual });
  if (chk.error) throw new AdminError('Senha atual incorreta.', 'SENHA');
  const { error } = await sb().auth.updateUser({ password: nova });
  if (error) throw new AdminError(error.message, 'AUTH');
}

export interface Config { carencia_dias: number; dias_teste: number; aviso_dias: number }
export interface LojaAdm {
  id: string; nome: string; documento: string; tipo_documento: 'CPF' | 'CNPJ'; responsavel: string; telefone: string;
  status: 'teste' | 'ativa' | 'bloqueada'; vencimento: string; plano: string; valor_mensal_cents: number; observacao: string;
  motivo_bloqueio: string | null; criado_em: string; ultimo_acesso: string | null;
  dias_restantes: number; liberada: boolean; situacao: 'teste' | 'ativa' | 'carencia' | 'vencida' | 'bloqueada';
  vendas_total: number; vendas_mes: number; total_mes_cents: number; usuarios: number; dono_usuario: string | null;
  ultimo_pagamento: { pago_em: string; valor_cents: number } | null;
  pagamentos?: any[]; eventos?: any[]; equipe?: { usuario: string; nome: string; papel: string; ativo: boolean }[];
}
