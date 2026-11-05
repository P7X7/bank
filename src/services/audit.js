import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';

export function logAudit({
  actorType = 'system',
  actorId = null,
  actorName = null,
  action,
  targetType = null,
  targetId = null,
  details = null,
}) {
  try {
    db.prepare(
      `INSERT INTO audit_log (actor_type, actor_id, actor_name, action, target_type, target_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      actorType,
      actorId === null ? null : String(actorId),
      actorName,
      action,
      targetType,
      targetId === null ? null : String(targetId),
      details ? JSON.stringify(details) : null,
    );
  } catch (err) {
    logger.error('فشل تسجيل العملية الإدارية', err);
  }
}

export function listAudit({ page = 1, limit = 50 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(200, Math.max(1, Number(limit) || 50));
  const total = db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
  const items = db
    .prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(l, (p - 1) * l);
  return { items, total, page: p, pages: Math.max(1, Math.ceil(total / l)), limit: l };
}