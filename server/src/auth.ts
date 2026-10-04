import crypto from 'node:crypto';
import type { DB } from './db';
import type { Role } from '@folha/shared';
import { forbidden, needManager } from './errors';

export interface AuthUser { id: number; name: string; role: Role }

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${h}`;
}
export function verifyPin(pin: string, stored: string): boolean {
  const [salt, h] = stored.split(':');
  if (!salt || !h) return false;
  const calc = crypto.scryptSync(pin, salt, 32);
  const buf = Buffer.from(h, 'hex');
  return buf.length === calc.length && crypto.timingSafeEqual(buf, calc);
}

export function login(db: DB, userId: number, pin: string): { token: string; user: AuthUser } | null {
  const u = db.prepare('SELECT id, name, role, pin_hash FROM users WHERE id = ? AND active = 1').get(userId) as any;
  if (!u || !verifyPin(pin, u.pin_hash)) return null;
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO auth_tokens(token, user_id) VALUES (?,?)').run(token, u.id);
  return { token, user: { id: u.id, name: u.name, role: u.role } };
}

export function userFromToken(db: DB, token: string | undefined): AuthUser | null {
  if (!token) return null;
  const u = db.prepare(`SELECT u.id, u.name, u.role FROM auth_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token = ? AND u.active = 1`).get(token) as AuthUser | undefined;
  return u ?? null;
}

export const isManager = (r: Role) => r === 'gerente' || r === 'admin';

/**
 * Autorização de gerente: se o próprio usuário é gerente/admin, passa.
 * Senão exige PIN de um gerente/admin ativo. Retorna o id de quem autorizou.
 */
export function authorizeManager(db: DB, user: AuthUser, managerPin: string | undefined | null, what: string): number {
  if (isManager(user.role)) return user.id;
  if (!managerPin) throw needManager(`${what}: precisa de autorização do gerente.`);
  const managers = db.prepare(`SELECT id, pin_hash FROM users WHERE active = 1 AND role IN ('gerente','admin')`).all() as any[];
  for (const m of managers) if (verifyPin(managerPin, m.pin_hash)) return m.id;
  throw needManager('PIN de gerente inválido.');
}

export function requireRole(user: AuthUser, roles: Role[]) {
  if (!roles.includes(user.role)) throw forbidden('Seu usuário não tem permissão para isso.');
}
