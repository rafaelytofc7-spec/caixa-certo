-- "Carregar produtos de exemplo": catálogo inicial de hortifruti SEM preço (R$ 0,00) e sem estoque.
-- Só funciona com a loja sem nenhum produto. O dono ajusta os preços em Produtos › Preço do dia.
create or replace function load_sample_products(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; v_n int;
begin
  u := _op(p_token);
  perform _require_role(u, array['admin','gerente']);
  if exists (select 1 from products) then perform _err('A loja já tem produtos: os exemplos só entram no catálogo vazio.', 'CONFLITO'); end if;
  if not exists (select 1 from categories) then perform _seed_categories(current_loja_id()); end if;
  insert into products(code, name, category_id, unit, price_cents, cost_cents, stock_qty, min_stock, shortcut_pos, icon, active, allow_negative)
  select v.code, v.name, c.id, v.unit, 0, 0, 0, 0, v.pos, v.icon, true, true
  from (values
    ('101', 'Tomate', 'legumes', 'KG', 1, '🍅'), ('102', 'Tomate italiano', 'legumes', 'KG', null, '🍅'),
    ('103', 'Cebola', 'legumes', 'KG', 4, '🧅'), ('104', 'Batata', 'legumes', 'KG', 5, '🥔'),
    ('105', 'Cenoura', 'legumes', 'KG', 6, '🥕'), ('106', 'Abobrinha verde', 'legumes', 'KG', 19, '🥒'),
    ('107', 'Pepino', 'legumes', 'KG', null, '🥒'), ('108', 'Pimentão verde', 'legumes', 'KG', 20, '🫑'),
    ('109', 'Berinjela', 'legumes', 'KG', null, '🍆'), ('110', 'Chuchu', 'legumes', 'KG', null, '🥒'),
    ('111', 'Batata doce', 'legumes', 'KG', null, '🍠'), ('112', 'Mandioca', 'legumes', 'KG', null, '🥔'),
    ('113', 'Beterraba', 'legumes', 'KG', null, '🟣'), ('114', 'Abóbora cabotiá', 'legumes', 'KG', null, '🎃'),
    ('115', 'Alho', 'temperos', 'KG', 21, '🧄'), ('116', 'Gengibre', 'temperos', 'KG', null, '🫚'),
    ('117', 'Repolho', 'verduras', 'KG', null, '🥬'), ('118', 'Brócolis', 'verduras', 'UN', null, '🥦'),
    ('201', 'Banana prata', 'frutas', 'KG', 2, '🍌'), ('202', 'Banana nanica', 'frutas', 'KG', 10, '🍌'),
    ('203', 'Maçã', 'frutas', 'KG', 8, '🍎'), ('204', 'Laranja', 'frutas', 'KG', 7, '🍊'),
    ('205', 'Limão', 'frutas', 'KG', 9, '🍋'), ('206', 'Mamão formosa', 'frutas', 'KG', 11, '🥭'),
    ('207', 'Manga', 'frutas', 'KG', 12, '🥭'), ('208', 'Abacaxi', 'frutas', 'UN', 14, '🍍'),
    ('209', 'Melancia', 'frutas', 'KG', 13, '🍉'), ('210', 'Uva', 'frutas', 'KG', 15, '🍇'),
    ('211', 'Abacate', 'frutas', 'KG', null, '🥑'), ('212', 'Maracujá', 'frutas', 'KG', null, '🟡'),
    ('301', 'Alface', 'verduras', 'MACO', 3, '🥬'), ('302', 'Cheiro verde', 'temperos', 'MACO', 17, '🌿'),
    ('303', 'Couve', 'verduras', 'MACO', 18, '🥬'), ('304', 'Morango', 'frutas', 'BANDEJA', 16, '🍓'),
    ('305', 'Rúcula', 'verduras', 'MACO', null, '🥬'), ('306', 'Hortelã', 'temperos', 'MACO', null, '🌿'),
    ('401', 'Ovo branco cartela', 'ovos', 'UN', 22, '🥚'), ('402', 'Ovo caipira cartela', 'ovos', 'UN', null, '🥚'),
    ('601', 'Queijo', 'frios', 'KG', null, '🧀'), ('901', 'Sacola', 'outros', 'UN', 24, '🛍️')
  ) as v(code, name, cat, unit, pos, icon) join categories c on c.slug = v.cat
  order by v.code;
  get diagnostics v_n = row_count;
  perform _audit(u.id, 'PRODUTOS_EXEMPLO', 'products', null, jsonb_build_object('quantidade', v_n));
  return jsonb_build_object('created', v_n);
end $$;
