/**
 * Fotos dos produtos (v3.5): uma foto real por produto, embutida no app (funciona sem internet).
 * Arquivos em src/assets/produtos/<nome-do-produto>.webp — o nome do arquivo é o nome do produto
 * sem acento, minúsculo, com hífens (ex.: “Banana prata” → banana-prata.webp).
 * Produto sem foto (ou criado depois com outro nome) continua com o ícone (emoji) de sempre.
 * Créditos/licenças: docs/creditos-imagens.md (e Config. → Créditos das imagens).
 */
const files = import.meta.glob('./assets/produtos/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export const photoSlug = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const BY_SLUG: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) BY_SLUG[path.split('/').pop()!.replace(/\.webp$/, '')] = url;

export function photoFor(name?: string | null): string | undefined {
  return name ? BY_SLUG[photoSlug(name)] : undefined;
}

export const photoCount = () => Object.keys(BY_SLUG).length;

/** Ícone do produto: a foto quando existe; senão o emoji cadastrado. Tamanho = 1 “em” do lugar onde está. */
export function PIcon({ p, fallback = '🧺' }: { p: { name?: string | null; icon?: string | null; product_name?: string | null; product_icon?: string | null } | null | undefined; fallback?: string }) {
  if (!p) return null;
  const name = p.name ?? p.product_name;
  const url = photoFor(name);
  let icon = p.icon ?? p.product_icon ?? fallback;
  if (!url && (!icon || icon === '🧺') && name) icon = /livro/i.test(name) ? '📖' : /tempero/i.test(name) ? '🧂' : icon;
  if (!url) return <>{icon || fallback}</>;
  return <img className="pimg" src={url} alt="" aria-hidden="true" draggable={false} loading="lazy" decoding="async" data-testid="pimg" />;
}
