import express from 'express';
import { db } from '../../db/index.js';
import { hashPassword } from '../../utils/crypto.js';
import { requireAdmin } from '../auth.js';
import { logAudit } from '../../services/audit.js';

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get(
  '/',
  requireAdmin,
  wrap((_req, res) => {
    const items = db
      .prepare('SELECT id, username, role, discord_id, active, created_at, last_login_at FROM staff ORDER BY id ASC')
      .all();
    res.json({ items });
  }),
);

router.post(
  '/',
  requireAdmin,
  wrap((req, res) => {
    const { username, password, role = 'employee', discordId = null } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
    if (String(password).length < 10) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 10 أحرف على الأقل' });
    if (!['admin', 'employee'].includes(role)) return res.status(400).json({ error: 'صلاحية غير صالحة' });

    const exists = db.prepare('SELECT id FROM staff WHERE username = ?').get(String(username).trim());
    if (exists) return res.status(409).json({ error: 'اسم المستخدم مستخدم مسبقاً' });

    const info = db
      .prepare('INSERT INTO staff (username, password_hash, role, discord_id) VALUES (?, ?, ?, ?)')
      .run(String(username).trim(), hashPassword(password), role, discordId ? String(discordId) : null);

    logAudit({
      actorType: 'staff',
      actorId: req.staff.id,
      actorName: req.staff.username,
      action: 'staff_created',
      targetType: 'staff',
      targetId: info.lastInsertRowid,
      details: { username, role },
    });

    res.status(201).json({ id: Number(info.lastInsertRowid) });
  }),
);

router.patch(
  '/:id',
  requireAdmin,
  wrap((req, res) => {
    const id = Number(req.params.id);
    const target = db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: 'الموظف غير موجود' });

    const { role, active, password, discordId } = req.body || {};

    if (role && ['admin', 'employee'].includes(role)) {
      if (target.role === 'admin' && role !== 'admin') {
        const admins = db.prepare("SELECT COUNT(*) AS c FROM staff WHERE role='admin' AND active=1").get().c;
        if (admins <= 1) return res.status(400).json({ error: 'لا يمكن إزالة صلاحية آخر مدير نشط' });
      }
      db.prepare('UPDATE staff SET role = ? WHERE id = ?').run(role, id);
    }

    if (active !== undefined) {
      const isActive = active ? 1 : 0;
      if (target.role === 'admin' && !isActive) {
        const admins = db.prepare("SELECT COUNT(*) AS c FROM staff WHERE role='admin' AND active=1").get().c;
        if (admins <= 1) return res.status(400).json({ error: 'لا يمكن تعطيل آخر مدير نشط' });
      }
      db.prepare('UPDATE staff SET active = ? WHERE id = ?').run(isActive, id);
      if (!isActive) db.prepare('DELETE FROM sessions WHERE staff_id = ?').run(id);
    }

    if (password) {
      if (String(password).length < 10) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 10 أحرف على الأقل' });
      db.prepare('UPDATE staff SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
      db.prepare('DELETE FROM sessions WHERE staff_id = ?').run(id);
    }

    if (discordId !== undefined) {
      db.prepare('UPDATE staff SET discord_id = ? WHERE id = ?').run(discordId ? String(discordId) : null, id);
    }

    logAudit({
      actorType: 'staff',
      actorId: req.staff.id,
      actorName: req.staff.username,
      action: 'staff_updated',
      targetType: 'staff',
      targetId: id,
      details: { role, active, passwordChanged: Boolean(password) },
    });

    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  requireAdmin,
  wrap((req, res) => {
    const id = Number(req.params.id);
    if (id === req.staff.id) return res.status(400).json({ error: 'لا يمكنك حذف حسابك الحالي' });
    const target = db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: 'الموظف غير موجود' });
    if (target.role === 'admin') {
      const admins = db.prepare("SELECT COUNT(*) AS c FROM staff WHERE role='admin' AND active=1").get().c;
      if (admins <= 1) return res.status(400).json({ error: 'لا يمكن حذف آخر مدير نشط' });
    }
    db.prepare('DELETE FROM staff WHERE id = ?').run(id);
    logAudit({
      actorType: 'staff',
      actorId: req.staff.id,
      actorName: req.staff.username,
      action: 'staff_deleted',
      targetType: 'staff',
      targetId: id,
      details: { username: target.username },
    });
    res.json({ ok: true });
  }),
);

export default router;