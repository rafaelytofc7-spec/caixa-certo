// ===================== NOME DO APP (troque aqui para renomear) =====================
// Tudo que aparece para o cliente (título, telas, cupom, manifest do app instalado, PDF) vem daqui.
const NAME = 'Caixa Certo'; // nome do produto (provisório)
export const BRAND = {
  name: NAME,
  /** nome curto do ícone instalado */
  shortName: NAME,
  /** frase curta das telas de entrada */
  tagline: 'O caixa certo da sua banca.',
  /** descrição para o app instalado / buscadores */
  description: 'Caixa (PDV) online para hortifruti e mercadinho: venda por peso, leitor de código de barras, estoque, fiado, encomendas e fechamento.',
  /** dias do teste grátis mostrados nas telas (o valor que vale está em plataforma_config.dias_teste no banco) */
  trialDays: 7,
  /** endereço público (GitHub Pages) */
  url: 'https://rafaelytofc7-spec.github.io/caixa-certo/',
  /** WhatsApp do suporte (só dígitos, com 55 + DDD). ⚠️ PLACEHOLDER — troque pelo número real do suporte. */
  supportWhatsapp: '5500000000000',
  /** mensagem pronta do botão "Falar com o suporte" */
  supportMessage: `Olá! Preciso de ajuda com o ${NAME}.`,
} as const;

export const SUPPORT_IS_PLACEHOLDER = /^550{9,}$/.test(BRAND.supportWhatsapp);
export const supportLink = (extra = '') =>
  `https://wa.me/${BRAND.supportWhatsapp}?text=${encodeURIComponent(BRAND.supportMessage + (extra ? '\n' + extra : ''))}`;

// e-mails internos do login (ninguém recebe e-mail). NÃO mude depois que houver lojas cadastradas:
// os logins já criados usam esses domínios (o mesmo valor está na Edge Function supabase/functions/accounts).
export const STORE_EMAIL_DOMAIN = 'lojas.caixacerto.invalid';
export const ADMIN_EMAIL_DOMAIN = 'admin.caixacerto.invalid';
