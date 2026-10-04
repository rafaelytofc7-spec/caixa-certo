/** Modo do backend: 'local' (servidor Fastify na banca) ou 'supabase' (online, GitHub Pages). */
export const IS_SB = import.meta.env.VITE_BACKEND === 'supabase';
