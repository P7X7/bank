import { db } from '../db/index.js';
import { config } from '../config.js';
import { randomToken } from '../utils/crypto.js';
import { logAudit } from '../services/audit.js';

export function parseCookies(req, _res, next) {
  const header = req.headers.cookie || '';
  req.cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) req.cookies[k] = decodeURIComponent(v);
  }
  next();
}

export function createSession(staffId, res) {
  const id = randomToken(32);
  const csrf = randomToken(24);
  const expires = new Date(Date.now() + config.session.ttlHours * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, staff_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').run(
    id,
    staffId,
    csrf,
    expires,
  );
  res.cookie(config.session.cookieName, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.session.secure,
    maxAge: config.session.ttlHours * 3600 * 1000,
    path: '/',
  });
  res.cookie(config.session.csrfCookieName, csrf, {
    httpOnly: false,
    sameSite: 'lax',
    secure: config.session.secure,
    maxAge: config.session.ttlHours * 3600 * 1000,
    path: '/',
  });
  return { id, csrf, expires };
}

export function destroySession(req, res) {
  const sid = req.cookies?.[config.session.cookieName];
  if (sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
  res.clearCookie(config.session.cookieName, { path: '/' });
  res.clearCookie(config.session.csrfCookieName, { path: '/' });
}

export function loadSession(req, _res, next) {
  const sid = req.cookies?.[config.session.cookieName];
  if (!sid) return next();
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.csrf_token, s.expires_at, st.id, st.username, st.role, st.active
       FROM sessions s JOIN staff st ON st.id = s.staff_id
       WHERE s.id = ?`,
    )
    .get(sid);
  if (!row || new Date(row.expires_at).getTime() < Date.now() || !row.active) return next();
  req.staff = { id: row.id, username: row.username, role: row.role };
  req.sessionCsrf = row.csrf_token;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.staff) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.staff) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  if (req.staff.role !== 'admin') return res.status(403).json({ error: 'هذه العملية تتطلب صلاحية مدير' });
  next();
}

export function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const provided = req.headers['x-csrf-token'];
  if (!req.sessionCsrf || provided !== req.sessionCsrf) {
    return res.status(403).json({ error: 'رمز الحماية CSRF غير صالح' });
  }
  next();
}

export function purgeExpiredSessions() {
  const res = db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  if (res.changes) logAudit({ actorType: 'system', action: 'purge_sessions', details: { count: res.changes } });
  return res.changes;
}