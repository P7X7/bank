import express from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../../db/index.js';
import { verifyPassword } from '../../utils/crypto.js';
import { createSession, destroySession, requireAuth } from '../auth.js';
import { logAudit } from '../../services/audit.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'عدد محاولات الدخول كبير، حاول لاحقاً' },
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور' });

  const staff = db.prepare('SELECT * FROM staff WHERE username = ? AND active = 1').get(String(username).trim());
  if (!staff || !verifyPassword(password, staff.password_hash)) {
    logAudit({ actorType: 'anonymous', actorName: String(username).slice(0, 64), action: 'login_failed' });
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }

  db.prepare("UPDATE staff SET last_login_at = datetime('now') WHERE id = ?").run(staff.id);
  const { csrf } = createSession(staff.id, res);

  logAudit({ actorType: 'staff', actorId: staff.id, actorName: staff.username, action: 'login_success' });

  res.json({
    user: { id: staff.id, username: staff.username, role: staff.role },
    csrfToken: csrf,
  });
});

router.post('/logout', requireAuth, (req, res) => {
  destroySession(req, res);
  logAudit({ actorType: 'staff', actorId: req.staff.id, actorName: req.staff.username, action: 'logout' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.staff, csrfToken: req.sessionCsrf });
});

export default router;