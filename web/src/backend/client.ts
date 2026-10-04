import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_KEY as string; // chave pública (publishable/anon) — a segurança está no RLS + RPCs

export const SB_URL = URL;
export const SB_KEY = KEY;

let _sb: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!_sb) _sb = createClient(URL, KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cc.sb.auth' },
    // sem novas tentativas automáticas: sem rede, o app cai logo no cache/fila em vez de esperar ~7 s
    db: { retry: false } as any,
  });
  return _sb;
}
