import express from 'express';
import { listTransfers, getTransfer, createTransfer } from '../../services/transfers.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { logAudit } from '../../services/audit.js';

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get(
  '/',
  requireAuth,
  wrap((req, res) => {
    const { search = '', status = '', currency = '', page = 1, limit = 20 } = req.query;
    res.json(listTransfers({ search: String(search), status: String(status), currency: String(currency), page, limit }));
  }),
);

router.get(
  '/:id',
  requireAuth,
  wrap((req, res) => {
    const transfer = getTransfer(req.params.id);
    if (!transfer) return res.status(404).json({ error: 'الحوالة غير موجودة' });
    res.json({ transfer });
  }),
);

router.post(
  '/',
  requireAuth,
  requireAdmin,
  wrap((req, res) => {
    const { amount, currency, senderName, beneficiaryName, operationNumber, occurredAt } = req.body || {};
    const { transfer, duplicate } = createTransfer({
      amount,
      currency,
      senderName,
      beneficiaryName,
      operationNumber,
      occurredAt,
    });
    logAudit({
      actorType: 'staff',
      actorId: req.staff.id,
      actorName: req.staff.username,
      action: duplicate ? 'transfer_duplicate_manual' : 'transfer_created_manual',
      targetType: 'transfer',
      targetId: transfer.id,
    });
    res.status(duplicate ? 200 : 201).json({ transfer, duplicate });
  }),
);

export default router;