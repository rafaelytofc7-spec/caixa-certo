// v3.3: encomendas e comprovante pelo WhatsApp (o app só monta o texto e abre a conversa; quem envia é a pessoa).
import { formatBRL, formatQty } from './format';
import { PAYMENT_LABEL, PaymentMethod, Unit } from './types';
import { titleCase } from './promo';

export const ORDER_STATUS_LABEL: Record<string, string> = {
  AGUARDANDO: 'Aguardando', AVISADA: 'Chegou · avisado', PRONTA: 'Pronta', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada',
};
export const DELIVERY_LABEL: Record<string, string> = { buscar: 'Vai buscar', entrega: 'Entrega', a_combinar: 'A combinar' };

/** só dígitos, sem o 55 do país */
export function phoneDigits(s: string): string {
  let d = String(s ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d.slice(0, 11);
}
/** máscara BR enquanto digita: (11) 98765-4321 · (11) 3333-4444 */
export function maskPhone(s: string): string {
  const d = phoneDigits(s);
  if (d.length <= 2) return d ? `(${d}` : '';
  const ddd = d.slice(0, 2); const r = d.slice(2);
  if (r.length <= 4) return `(${ddd}) ${r}`;
  const cut = r.length === 9 ? 5 : 4;
  return `(${ddd}) ${r.slice(0, cut)}-${r.slice(cut)}`;
}
export const validPhone = (s: string) => [10, 11].includes(phoneDigits(s).length);
/** link do WhatsApp com a mensagem pronta */
export const waLink = (phone: string, text: string) => `https://wa.me/55${phoneDigits(phone)}?text=${encodeURIComponent(text)}`;

export interface OrderItemLike { name: string; unit: string; qty: number | null; line_cents: number | null }
export interface OrderLike { customer_name: string; items: OrderItemLike[]; total_cents: number | null; paid: boolean; delivery: string; address?: string }

const qtyTxt = (it: OrderItemLike) => (it.qty ? (it.unit === 'KG' ? formatQty(it.qty, 'KG').replace(/,000 kg$/, ' kg') : formatQty(it.qty, it.unit as Unit)) : '');
/** "1,500 kg de Tomate LV, 2 un de Ovo e Queijo" */
export function orderItemsText(items: OrderItemLike[]): string {
  const parts = items.map((it) => (it.qty ? `${qtyTxt(it)} de ${it.name}` : it.name));
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}
const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;

/** mensagem de "chegou a encomenda" */
export function orderArrivedText(storeName: string, o: OrderLike): string {
  const loja = titleCase(storeName || 'Hortifruti');
  const total = o.total_cents != null && o.total_cents > 0 ? `Total ${formatBRL(o.total_cents)} (${o.paid ? 'já pago' : 'a pagar'}).` : o.paid ? 'Já está pago.' : 'O valor a gente confirma na hora.';
  const ask = o.delivery === 'entrega' ? `Combinamos a entrega${o.address ? ` em ${o.address}` : ''}?` : o.delivery === 'buscar' ? 'Pode vir buscar quando quiser.' : 'Você vai vir buscar ou prefere entrega?';
  return `Olá ${firstName(o.customer_name)}! Sua encomenda de ${orderItemsText(o.items)} chegou no ${loja} 🥬.\n${ask}\n${total}`;
}

/** comprovante em texto (WhatsApp) */
export function receiptWhatsText(storeName: string, sale: any): string {
  const loja = titleCase(storeName || 'Hortifruti');
  const d = String(sale.created_at ?? '').slice(0, 16).split(' ');
  const when = d[0] ? `${d[0].split('-').reverse().join('/')} ${d[1] ?? ''}`.trim() : '';
  const L = [`🧾 *Comprovante — ${loja}*`, `Venda nº ${sale.number}${when ? ` · ${when}` : ''}`];
  if (sale.order) L.push(`Encomenda de ${sale.order.customer_name}`);
  if (sale.status === 'CANCELADA') L.push('*VENDA CANCELADA*');
  L.push('');
  if (sale.imported) L.push('Venda importada do sistema antigo (só o total).');
  for (const it of sale.items ?? []) {
    const promo = it.promotion_id && it.regular_price_cents > it.unit_price_cents ? ` 🔥 promo (de ${formatBRL(it.regular_price_cents)})` : '';
    L.push(`• ${formatQty(it.qty, it.unit as Unit)} ${it.name} — ${formatBRL(it.total_cents)}${promo}`);
  }
  const disc = (sale.item_discount_cents ?? 0) + (sale.total_discount_cents ?? 0);
  L.push('');
  if (disc > 0) L.push(`Desconto: −${formatBRL(disc)}`);
  L.push(`*Total: ${formatBRL(sale.total_cents)}*`);
  const pays = (sale.payments ?? []).map((p: any) => `${PAYMENT_LABEL[p.method as PaymentMethod] ?? p.method} ${formatBRL(p.amount_cents)}`);
  if (pays.length) L.push(`Pagamento: ${pays.join(' + ')}${sale.change_cents > 0 ? ` · troco ${formatBRL(sale.change_cents)}` : ''}`);
  L.push('', 'Obrigado pela preferência! 🥬', '_Não é documento fiscal._');
  return L.join('\n');
}
