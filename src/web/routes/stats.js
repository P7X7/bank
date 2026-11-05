import express from 'express';
import { db } from '../../db/index.js';
import { transferStats } from '../../services/transfers.js';
import { receiptStats, attemptStats } from '../../services/receipts.js';
import { getNumberSetting } from '../../services/settings.js';
import { requireAuth } from '../auth.js';

const router = express.Router();

router.get('/overview', requireAuth, (req, res) => {
  const transfers = transferStats();
  const receipts = receiptStats();
  const attempts = attemptStats();

  const recentReceipts = db
    .prepare('SELECT id, status, amount, currency, amount_sar, sender_name, operation_number, created_at FROM receipts ORDER BY id DESC LIMIT 8')
    .all();
  const recentTransfers = db
    .prepare('SELECT id, status, amount, currency, amount_sar, sender_name, operation_number, created_at FROM transfers ORDER BY id DESC LIMIT 8')
    .all();

  const webhookCount = db.prepare('SELECT COUNT(*) AS c FROM webhook_events').get().c;

  res.json({
    transfers,
    receipts,
    attempts,
    webhookCount,
    usdRate: getNumberSetting('usd_rate', 3.75),
    recentReceipts,
    recentTransfers,
  });
});

export default router;