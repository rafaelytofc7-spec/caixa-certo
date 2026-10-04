// Tipos compartilhados entre servidor e tela.
// Dinheiro SEMPRE em centavos (inteiro). Quantidade SEMPRE em milésimos (inteiro):
//  - para KG: gramas (1250 = 1,250 kg)
//  - para UN/BANDEJA/MAÇO/DÚZIA/PCT: unidade x 1000 (2000 = 2 un)

export const UNITS = ['KG', 'UN', 'BANDEJA', 'MACO', 'DUZIA', 'PCT'] as const;
export type Unit = (typeof UNITS)[number];
export const UNIT_LABEL: Record<Unit, string> = {
  KG: 'kg', UN: 'un', BANDEJA: 'bdj', MACO: 'maço', DUZIA: 'dz', PCT: 'pct',
};
export const UNIT_NAME: Record<Unit, string> = {
  KG: 'Quilo (KG)', UN: 'Unidade (UN)', BANDEJA: 'Bandeja', MACO: 'Maço', DUZIA: 'Dúzia', PCT: 'Pacote (PCT)',
};

export const ROLES = ['admin', 'gerente', 'operador'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', gerente: 'Gerente', operador: 'Operador' };

export const PAYMENT_METHODS = ['dinheiro', 'pix', 'debito', 'credito', 'voucher', 'fiado'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** inclui "nao_informado" (vendas importadas do sistema antigo), que não aparece como opção na hora de pagar */
export const PAYMENT_LABEL: Record<PaymentMethod | 'nao_informado', string> = {
  dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito', voucher: 'Voucher', fiado: 'Fiado', nao_informado: 'Não informado',
};

export const LOSS_REASONS = ['amadureceu', 'estragou', 'queda', 'consumo_interno'] as const;
export type LossReason = (typeof LOSS_REASONS)[number];
export const LOSS_LABEL: Record<LossReason, string> = {
  amadureceu: 'Amadureceu', estragou: 'Estragou', queda: 'Queda', consumo_interno: 'Consumo interno',
};

export type DiscountType = 'pct' | 'valor';
export interface Discount {
  type: DiscountType;
  /** pct: em centésimos de % (1000 = 10,00%); valor: centavos */
  value: number;
}

export interface User { id: number; name: string; role: Role; active: boolean }

export interface Category { id: number; name: string; slug: string; color: string; icon: string }

export interface Product {
  id: number; code: string; ean: string | null; name: string;
  category_id: number; category_name?: string; category_color?: string;
  unit: Unit; price_cents: number; cost_cents: number;
  stock_qty: number; min_stock: number; active: boolean; allow_negative: boolean;
  shortcut_pos: number | null; icon: string;
  ncm: string | null; cfop: string | null; cst: string | null;
  /** v3.1: preenchido quando o produto foi apagado mas tem histórico (fica só nos relatórios) */
  deleted_at?: string | null;
  /** v3.2: promoção vigente ou próxima (do banco) e, depois de withPromo(), se vale agora */
  promo_id?: number | null; promo_price_cents?: number | null; promo_starts_at?: string | null; promo_ends_at?: string | null;
  promo_active?: boolean; regular_price_cents?: number;
}

export interface CartItemInput {
  product_id: number;
  qty: number; // milésimos
  discount?: Discount | null;
}

export interface PaymentInput { method: PaymentMethod; amount_cents: number }

export interface CashSession {
  id: number; terminal: string; status: 'ABERTO' | 'FECHADO';
  opened_by: number; opened_by_name?: string; opened_at: string;
  opening_float_cents: number; closed_at: string | null; closed_by: number | null;
}

export interface ExpectedByMethod { method: PaymentMethod; expected_cents: number; counted_cents?: number; diff_cents?: number }

export interface StoreSettings {
  name: string; legal_name: string; cnpj: string; address: string; phone: string;
  receipt_footer: string; discount_limit_pct: number; allow_negative_stock: boolean;
  expiry_alert_days: number; printer_host: string; printer_port: number;
  scale_label_mode: 'peso' | 'preco'; scale_code_digits: number;
}
