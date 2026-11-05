import express from 'express';
import { listAudit } from '../../services/audit.js';
import { requireAdmin } from '../auth.js';

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  res.json(listAudit({ page, limit }));
});

export default router;