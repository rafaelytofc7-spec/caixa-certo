import type { DB } from '../db';
import { bad, conflict, notFound } from '../errors';
import { audit } from '../audit';
import type { AuthUser } from '../auth';
import { PAYMENT_METHODS, PaymentMethod } from '@folha/shared';

export function getOpenSession(db: DB, terminal: string) {
  return db.prepare(`SELECT s.*, u.name AS opened_by_name FROM cash_sessions s JOIN users u ON u.id = s.opened_by
    WHERE s.terminal = ? AND s.status = 'ABERTO'`).get(terminal) as any | undefined;
}

export function requireOpenSession(db: DB, terminal: string) {
  const s = getOpenSession(db, terminal);
  if (!s) throw conflict('Caixa fechado. Abra o caixa para vender.', 'CAIXA_FECHADO');
  return s;
}

export function addCashMovement(db: DB, m: {
  sessionId: number; type: string; method: PaymentMethod; amount: number; userId: number;
  refType?: string; refId?: number; note?: string | null; authorizedBy?: number | null;
}) {
  return Number(db.prepare(`INSERT INTO cash_movements(session_id, type, method, amount_cents, ref_type, ref_id, note, user_id, authorized_by)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(m.sessionId, m.type, m.method, m.amount, m.refType ?? null, m.refId ?? null,
    m.note ?? null, m.userId, m.authorizedBy ?? null).lastInsertRowid);
}

export function openSession(db: DB, user: AuthUser, terminal: string, floatCents: number) {
  if (!Number.isInteger(floatCents) || floatCents < 0) throw bad('Fundo de troco inválido.');
  return db.transaction(() => {
    if (getOpenSession(db, terminal)) throw conflict('Já existe um caixa aberto neste terminal.', 'CAIXA_JA_ABERTO');
    const id = Number(db.prepare('INSERT INTO cash_sessions(terminal, opened_by, opening_float_cents) VALUES (?,?,?)')
      .run(terminal, user.id, floatCents).lastInsertRowid);
    addCashMovement(db, { sessionId: id, type: 'ABERTURA', method: 'dinheiro', amount: floatCents, userId: user.id, note: 'Fundo de troco' });
    audit(db, user.id, 'CAIXA_ABERTURA', 'cash_session', id, { terminal, float: floatCents });
    return sessionSummary(db, id);
  })();
}

export function expectedByMethod(db: DB, sessionId: number): Record<PaymentMethod, number> {
  const rows = db.prepare('SELECT method, SUM(amount_cents) AS total FROM cash_movements WHERE session_id = ? GROUP BY method')
    .all(sessionId) as any[];
  const out = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<PaymentMethod, number>;
  for (const r of rows) out[r.method as PaymentMethod] = r.total ?? 0;
  return out;
}

export function cashMove(db: DB, user: AuthUser, terminal: string, kind: 'SANGRIA' | 'SUPRIMENTO', amount: number, note?: string | null) {
  if (!Number.isInteger(amount) || amount <= 0) throw bad('Valor deve ser maior que zero.');
  return db.transaction(() => {
    const s = requireOpenSession(db, terminal);
    if (kind === 'SANGRIA') {
      const cash = expectedByMethod(db, s.id).dinheiro;
      if (amount > cash) throw bad(`Sangria maior que o dinheiro na gaveta (${(cash / 100).toFixed(2).replace('.', ',')}).`);
    }
    const id = addCashMovement(db, { sessionId: s.id, type: kind, method: 'dinheiro', amount: kind === 'SANGRIA' ? -amount : amount,
      userId: user.id, note: note || null });
    audit(db, user.id, `CAIXA_${kind}`, 'cash_movement', id, { amount, note });
    return sessionSummary(db, s.id);
  })();
}

export function closeSession(db: DB, user: AuthUser, terminal: string, counted: Partial<Record<PaymentMethod, number>>, note?: string | null) {
  return db.transaction(() => {
    const s = requireOpenSession(db, terminal);
    const exp = expectedByMethod(db, s.id);
    const ins = db.prepare('INSERT INTO cash_session_counts(session_id, method, expected_cents, counted_cents) VALUES (?,?,?,?)');
    for (const m of PAYMENT_METHODS) {
      const c = counted[m];
      if (c != null && (!Number.isInteger(c) || c < 0)) throw bad(`Valor contado inválido em ${m}.`);
      ins.run(s.id, m, exp[m], c ?? exp[m]);
    }
    db.prepare(`UPDATE cash_sessions SET status='FECHADO', closed_by=?, closed_at=datetime('now','localtime'), note=? WHERE id=?`)
      .run(user.id, note ?? null, s.id);
    audit(db, user.id, 'CAIXA_FECHAMENTO', 'cash_session', s.id, { expected: exp, counted });
    return sessionSummary(db, s.id);
  })();
}

export function sessionSummary(db: DB, sessionId: number) {
  const s = db.prepare(`SELECT s.*, u.name AS opened_by_name, c.name AS closed_by_name FROM cash_sessions s
    JOIN users u ON u.id = s.opened_by LEFT JOIN users c ON c.id = s.closed_by WHERE s.id = ?`).get(sessionId) as any;
  if (!s) throw notFound('Sessão de caixa não encontrada.');
  const exp = expectedByMethod(db, sessionId);
  const counts = db.prepare('SELECT * FROM cash_session_counts WHERE session_id = ?').all(sessionId) as any[];
  const byMethod = PAYMENT_METHODS.map((m) => {
    const c = counts.find((x) => x.method === m);
    const expected = c ? c.expected_cents : exp[m];
    return { method: m, expected_cents: expected, counted_cents: c ? c.counted_cents : null, diff_cents: c ? c.counted_cents - expected : null };
  });
  const sales = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS total FROM sales WHERE session_id = ? AND status='FINALIZADA'`).get(sessionId) as any;
  const canceled = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS total FROM sales WHERE session_id = ? AND status='CANCELADA'`).get(sessionId) as any;
  const totals = db.prepare(`SELECT type, COALESCE(SUM(amount_cents),0) AS total, COUNT(*) AS n FROM cash_movements WHERE session_id = ? GROUP BY type`).all(sessionId) as any[];
  const t = (k: string) => totals.find((x) => x.type === k)?.total ?? 0;
  const movements = db.prepare(`SELECT m.*, u.name AS user_name FROM cash_movements m JOIN users u ON u.id = m.user_id
    WHERE m.session_id = ? AND m.type IN ('ABERTURA','SANGRIA','SUPRIMENTO','RECEBIMENTO_FIADO','ESTORNO') ORDER BY m.id`).all(sessionId);
  return {
    session: s, by_method: byMethod,
    sales_count: sales.n, sales_total_cents: sales.total, canceled_count: canceled.n, canceled_total_cents: canceled.total,
    ticket_medio_cents: sales.n ? Math.round(sales.total / sales.n) : 0,
    sangria_cents: Math.abs(t('SANGRIA')), suprimento_cents: t('SUPRIMENTO'), recebimento_fiado_cents: t('RECEBIMENTO_FIADO'),
    estorno_cents: Math.abs(t('ESTORNO')), opening_float_cents: s.opening_float_cents,
    expected_total_cents: byMethod.reduce((a, b) => a + b.expected_cents, 0),
    counted_total_cents: counts.length ? byMethod.reduce((a, b) => a + (b.counted_cents ?? 0), 0) : null,
    movements,
  };
}

export function listSessions(db: DB, limit = 30) {
  return db.prepare(`SELECT s.*, u.name AS opened_by_name FROM cash_sessions s JOIN users u ON u.id = s.opened_by
    ORDER BY s.id DESC LIMIT ?`).all(limit);
}
