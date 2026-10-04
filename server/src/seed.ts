import type { DB } from './db';
import { hashPin } from './auth';
import { ean13Check, Unit } from '@folha/shared';

export const SEED_USERS = [
  { name: 'Admin', role: 'admin', pin: '1234' },
  { name: 'Dona Cida', role: 'gerente', pin: '2580' },
  { name: 'Zé do Caixa', role: 'operador', pin: '1111' },
] as const;

const CATEGORIES = [
  ['Frutas', 'frutas', '#E8A33D', '🍎'], ['Verduras', 'verduras', '#3F9A4E', '🥬'], ['Legumes', 'legumes', '#D4742C', '🥕'],
  ['Temperos', 'temperos', '#7FA83A', '🌿'], ['Ovos', 'ovos', '#C9A46A', '🥚'], ['Grãos', 'graos', '#9A7349', '🫘'],
  ['Frios', 'frios', '#5E8FB8', '🧀'], ['Padaria', 'padaria', '#B9854A', '🥖'], ['Bebidas', 'bebidas', '#3F8FA0', '🥤'],
  ['Outros', 'outros', '#8A8178', '🧺'],
] as const;

// [código, nome, categoria, unidade, preço (centavos por kg ou un), ícone, estoque (milésimos)]
type P = [string, string, string, Unit, number, string, number];
const PRODUCTS: P[] = [
  // 30 hortaliças/frutas a quilo
  ['101', 'Tomate', 'legumes', 'KG', 699, '🍅', 40000],
  ['102', 'Tomate italiano', 'legumes', 'KG', 899, '🍅', 25000],
  ['103', 'Cebola', 'legumes', 'KG', 549, '🧅', 50000],
  ['104', 'Batata', 'legumes', 'KG', 599, '🥔', 60000],
  ['105', 'Cenoura', 'legumes', 'KG', 479, '🥕', 30000],
  ['106', 'Abobrinha', 'legumes', 'KG', 599, '🥒', 15000],
  ['107', 'Pepino', 'legumes', 'KG', 499, '🥒', 15000],
  ['108', 'Pimentão verde', 'legumes', 'KG', 899, '🫑', 10000],
  ['109', 'Berinjela', 'legumes', 'KG', 649, '🍆', 10000],
  ['110', 'Chuchu', 'legumes', 'KG', 399, '🥒', 12000],
  ['111', 'Batata-doce', 'legumes', 'KG', 549, '🍠', 20000],
  ['112', 'Mandioca', 'legumes', 'KG', 699, '🥔', 20000],
  ['113', 'Beterraba', 'legumes', 'KG', 499, '🟣', 15000],
  ['114', 'Abóbora cabotiá', 'legumes', 'KG', 449, '🎃', 20000],
  ['115', 'Alho', 'temperos', 'KG', 3299, '🧄', 5000],
  ['116', 'Gengibre', 'temperos', 'KG', 2490, '🫚', 3000],
  ['117', 'Repolho', 'verduras', 'KG', 399, '🥬', 20000],
  ['118', 'Brócolis', 'verduras', 'KG', 1290, '🥦', 8000],
  ['119', 'Couve-flor', 'verduras', 'KG', 990, '🥦', 8000],
  ['201', 'Banana prata', 'frutas', 'KG', 649, '🍌', 40000],
  ['202', 'Banana nanica', 'frutas', 'KG', 499, '🍌', 30000],
  ['203', 'Maçã gala', 'frutas', 'KG', 999, '🍎', 25000],
  ['204', 'Laranja pera', 'frutas', 'KG', 399, '🍊', 50000],
  ['205', 'Limão taiti', 'frutas', 'KG', 599, '🍋', 20000],
  ['206', 'Mamão formosa', 'frutas', 'KG', 699, '🥭', 20000],
  ['207', 'Manga palmer', 'frutas', 'KG', 799, '🥭', 15000],
  ['208', 'Abacaxi', 'frutas', 'KG', 599, '🍍', 20000],
  ['209', 'Melancia', 'frutas', 'KG', 349, '🍉', 60000],
  ['210', 'Uva niágara', 'frutas', 'KG', 1499, '🍇', 8000],
  ['211', 'Pera', 'frutas', 'KG', 1290, '🍐', 10000],
  // vendidos por unidade/maço/bandeja/dúzia/pacote
  ['301', 'Alface crespa', 'verduras', 'MACO', 350, '🥬', 40000],
  ['302', 'Cheiro-verde', 'temperos', 'MACO', 300, '🌿', 30000],
  ['303', 'Couve manteiga', 'verduras', 'MACO', 400, '🥬', 25000],
  ['304', 'Morango', 'frutas', 'BANDEJA', 990, '🍓', 20000],
  ['401', 'Ovos brancos', 'ovos', 'DUZIA', 1190, '🥚', 30000],
  ['501', 'Feijão carioca 1 kg', 'graos', 'PCT', 899, '🫘', 20000],
  ['601', 'Queijo minas frescal', 'frios', 'KG', 4290, '🧀', 5000],
  ['701', 'Pão francês', 'padaria', 'KG', 1699, '🥖', 8000],
  ['801', 'Água mineral 500 ml', 'bebidas', 'UN', 300, '💧', 48000],
  ['901', 'Sacola retornável', 'outros', 'UN', 500, '🛍️', 50000],
];

// 24 atalhos (a grade inteira da venda)
const SHORTCUTS: Record<string, number> = { '101': 1, '201': 2, '301': 3, '103': 4, '104': 5, '105': 6, '204': 7, '203': 8, '205': 9, '202': 10,
  '206': 11, '207': 12, '209': 13, '208': 14, '210': 15, '304': 16, '302': 17, '303': 18, '106': 19, '108': 20, '115': 21, '401': 22, '701': 23, '901': 24 };
const EAN_PREFIX: Record<string, string> = { '401': '789100000401', '501': '789100000501', '801': '789100000801', '901': '789100000901' };

export function isSeeded(db: DB) {
  return ((db.prepare('SELECT COUNT(*) AS n FROM users').get() as any).n ?? 0) > 0;
}

export function seed(db: DB) {
  if (isSeeded(db)) return false;
  db.transaction(() => {
    db.prepare(`INSERT INTO store_settings(id, name, legal_name, cnpj, address, phone, receipt_footer)
      VALUES (1, 'Banca Demo', 'Banca Demo Hortifruti', '00.000.000/0001-00', 'Rua da Feira, 100 — Box 12 — Centro', '(11) 90000-0000',
      'Obrigado pela preferência! Fruta boa é na Banca Demo.')`).run();
    for (const u of SEED_USERS) db.prepare('INSERT INTO users(name, role, pin_hash) VALUES (?,?,?)').run(u.name, u.role, hashPin(u.pin));
    const catId: Record<string, number> = {};
    for (const [name, slug, color, icon] of CATEGORIES)
      catId[slug] = Number(db.prepare('INSERT INTO categories(name, slug, color, icon) VALUES (?,?,?,?)').run(name, slug, color, icon).lastInsertRowid);
    const ins = db.prepare(`INSERT INTO products(code, ean, name, category_id, unit, price_cents, cost_cents, stock_qty, min_stock, shortcut_pos, icon, ncm, cfop, cst)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const mov = db.prepare(`INSERT INTO stock_movements(product_id, type, qty, balance_after, unit_cost_cents, note) VALUES (?, 'INICIAL', ?, ?, ?, 'Estoque inicial (seed)')`);
    for (const [code, name, cat, unit, price, icon, stock] of PRODUCTS) {
      const ean = EAN_PREFIX[code] ? EAN_PREFIX[code] + ean13Check(EAN_PREFIX[code]) : null;
      const cost = Math.round(price * 0.58);
      const min = unit === 'KG' ? 3000 : 5000;
      const id = Number(ins.run(code, ean, name, catId[cat], unit, price, cost, stock, min, SHORTCUTS[code] ?? null, icon,
        cat === 'frutas' || cat === 'legumes' || cat === 'verduras' ? '07099990' : null, '5102', '102').lastInsertRowid);
      mov.run(id, stock, stock, cost);
    }
    // lotes com validade para o alerta "vencendo em 2 dias"
    const lot = db.prepare(`INSERT INTO lots(product_id, lot_code, expiry_date, qty_initial, qty_left) VALUES
      ((SELECT id FROM products WHERE code = ?), ?, date('now','localtime', ?), ?, ?)`);
    lot.run('304', 'L-MOR-01', '+1 days', 20000, 20000);
    lot.run('601', 'L-QMF-07', '+2 days', 5000, 5000);
    lot.run('401', 'L-OVO-33', '+12 days', 30000, 30000);
    db.prepare(`INSERT INTO suppliers(name, phone, note) VALUES ('Ceasa — Box do Seu Antônio', '(11) 97777-1010', 'Frutas e legumes, entrega terça e sexta.'),
      ('Granja Boa Vista', '(11) 96666-2020', 'Ovos, pedido semanal.')`).run();
    db.prepare(`INSERT INTO customers(name, phone, credit_limit_cents, note) VALUES ('Dona Marta', '(11) 98888-1234', 30000, 'Cliente antiga, paga toda sexta.')`).run();
    db.prepare(`INSERT INTO audit_log(action, entity, details) VALUES ('SEED', 'sistema', '{"loja":"Banca Demo"}')`).run();
  })();
  return true;
}
