/** busca sem acento e sem maiúscula: "maca" acha "Maçã", "LIMAO" acha "Limão" */
export const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const matchProduct = (p: { name: string; code?: string | null; ean?: string | null }, q: string) => {
  const t = norm(q);
  if (!t) return true;
  return norm(p.name).includes(t) || p.code === q.trim() || p.ean === q.trim();
};
export const USER_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
