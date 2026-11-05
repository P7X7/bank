import express from 'express';
import { config } from '../../config.js';
import { getAllSettings, setSetting, invalidateSettings } from '../../services/settings.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { logAudit } from '../../services/audit.js';

const router = express.Router();

const NUMERIC_KEYS = new Set(['usd_rate', 'match_time_window_hours', 'match_name_min_similarity', 'match_amount_tolerance_sar']);

router.get('/', requireAuth, (req, res) => {
  res.json({
    settings: getAllSettings(),
    integrations: {
      discord: { configured: Boolean(config.discord.token && config.discord.clientId) },
      anthropic: { configured: Boolean(config.anthropic.apiKey), model: config.anthropic.model },
      webhook: { configured: Boolean(config.webhook.secret || config.webhook.bearerToken) },
      receiptChannel: Boolean(config.discord.receiptsChannelId),
      reviewChannel: Boolean(config.discord.reviewChannelId),
      publicUrl: config.publicUrl,
      webhookUrl: `${config.publicUrl.replace(/\/$/, '')}/webhook/rajhi`,
    },
  });
});

router.put('/', requireAdmin, (req, res) => {
  const body = req.body || {};
  const updated = [];

  for (const [key, rawValue] of Object.entries(body)) {
    if (!NUMERIC_KEYS.has(key)) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) {
      return res.status(400).json({ error: `قيمة غير صالحة للحقل ${key}` });
    }
    if (key === 'usd_rate' && (value <= 0 || value > 100)) {
      return res.status(400).json({ error: 'سعر صرف الدولار يجب أن يكون بين 0 و100' });
    }
    if (key === 'match_name_min_similarity' && value > 1) {
      return res.status(400).json({ error: 'حد تشابه الأسماء يجب أن يكون بين 0 و1' });
    }
    setSetting(key, value);
    updated.push(key);
  }

  invalidateSettings();

  logAudit({
    actorType: 'staff',
    actorId: req.staff.id,
    actorName: req.staff.username,
    action: 'settings_updated',
    details: { keys: updated },
  });

  res.json({ ok: true, updated, settings: getAllSettings() });
});

export default router;