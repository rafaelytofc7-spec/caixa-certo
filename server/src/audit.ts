import type { DB } from './db';
export function audit(db: DB, userId: number | null, action: string, entity: string | null, entityId: number | null, details?: unknown) {
  db.prepare('INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)')
    .run(userId, action, entity, entityId, details === undefined ? null : JSON.stringify(details));
}
