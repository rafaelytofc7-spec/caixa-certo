// Configura o Auth do projeto Caixa Certo: cadastro público desligado (contas só pela Edge Function),
// sem login anônimo, sem confirmação de e-mail (os e-mails são internos .invalid), senha mínima 8.
// Uso: SUPABASE_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=... node supabase/auth-config.mjs
const REF = process.env.SUPABASE_PROJECT_REF, TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !TOKEN) { console.error('Defina SUPABASE_PROJECT_REF e SUPABASE_ACCESS_TOKEN.'); process.exit(1); }
if (REF === 'cprtigvovwbmigxbosac') { console.error('Recusado: projeto do Folha Caixa.'); process.exit(1); }
const body = {
  disable_signup: true,
  external_anonymous_users_enabled: false,
  external_email_enabled: true,
  mailer_autoconfirm: true,
  password_min_length: 8,
  site_url: 'https://rafaelytofc7-spec.github.io/caixa-certo/',
  uri_allow_list: 'https://rafaelytofc7-spec.github.io/caixa-certo/**',
};
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, { method: 'PATCH',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
if (!r.ok) { console.error('Falhou:', r.status, (await r.text()).slice(0, 500)); process.exit(1); }
console.log('Auth configurado:', Object.keys(body).join(', '));
