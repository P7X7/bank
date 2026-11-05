import express from 'express';
import { listReceipts, getReceipt, applyReview } from '../../services/receipts.js';
import { requireAuth } from '../auth.js';

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get(
  '/',
  requireAuth,
  wrap((req, res) => {
    const { search = '', status = '', page = 1, limit = 20 } = req.query;
    res.json(listReceipts({ search: String(search), status: String(status), page, limit }));
  }),
);

router.get(
  '/:id',
  requireAuth,
  wrap((req, res) => {
    const receipt = getReceipt(req.params.id);
    if (!receipt) return res.status(404).json({ error: 'الإيصال غير موجود' });
    let criteria = null;
    try {
      criteria = receipt.criteria_json ? JSON.parse(receipt.criteria_json) : null;
    } catch {
      criteria = null;
    }
    res.json({ receipt, criteria });
  }),
);

router.post(
  '/:id/review',
  requireAuth,
  wrap((req, res) => {
    const { decision, note } = req.body || {};
    const receipt = applyReview(req.params.id, decision, {
      type: 'staff',
      staffId: req.staff.id,
      name: req.staff.username,
      note: note || null,
    });
    res.json({ receipt });
  }),
);

export default router;