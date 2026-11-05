import express from 'express';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { hmacHex, safeEqual } from '../utils/crypto.js';
import { parseSmsMessage, normalizeStructuredPayload } from '../services/smsParser.js';
import { createTransfer } from '../services/transfers.js';
import { logAudit } from '../services/audit.js';
import { logger } from '../utils/logger.js';

function logEvent({ source, status, ip, rawBody, error = null, transferId = null }) {
  try {
    db.prepare(
      `INSERT INTO webhook_events (source, status, ip, raw_body, error, transfer_id) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(source, status, ip, String(rawBody || '').slice(0, 8000), error, transferId);
  } catch (err) {
    logger.error('فشل تسجيل حدث webhook', err);
  }
}

function verifySignature(raw, headers) {
  const secret = config.webhook.secret;
  if (!secret) return false;
  const header = headers[config.webhook.signatureHeader] || headers['x-signature'] || '';
  const provided = String(header).replace(/^sha256=/i, '').trim();
  if (!provided) return false;
  const expected = hmacHex(secret, raw);
  return safeEqual(provided.toLowerCase(), expected.toLowerCase());
}

function verifyBearer(headers) {
  const token = config.webhook.bearerToken;
  if (!token) return false;
  const auth = String(headers['authorization'] || '');
  const provided = auth.replace(/^Bearer\s+/i, '').trim();
  return provided ? safeEqual(provided, token) : false;
}

function ipAllowed(req) {
  if (!config.webhook.allowedIps.length) return true;
  const ip = String(req.ip || '').replace(/^::ffff:/, '');
  return config.webhook.allowedIps.includes(ip);
}

export function createWebhookRouter() {
  const router = express.Router();

  router.use(express.text({ type: () => true, limit: '256kb' }));

  router.post('/rajhi', (req, res) => {
    const raw = typeof req.body === 'string' ? req.body : '';
    const ip = String(req.ip || '');

    if (!ipAllowed(req)) {
      logEvent({ source: 'rajhi', status: 'rejected_ip', ip, rawBody: raw, error: 'IP غير مسموح' });
      return res.status(403).json({ ok: false, error: 'المصدر غير مسموح' });
    }

    const signatureOk = verifySignature(raw, req.headers);
    const bearerOk = verifyBearer(req.headers);

    if (config.webhook.rejectUnsigned && !signatureOk && !bearerOk) {
      logEvent({ source: 'rajhi', status: 'rejected_auth', ip, rawBody: raw, error: 'توقيع غير صالح' });
      return res.status(401).json({ ok: false, error: 'توقيع الطلب غير صالح' });
    }

    let payload = null;
    let data;

    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }

    if (payload && typeof payload === 'object') {
      if (typeof payload.amount === 'number' || payload.amount === undefined ? false : true) {
        // noop — نتحقق أدناه
      }
      const structured = payload.amount !== undefined || payload.operation_number || payload.operationNumber;
      if (structured) {
        data = normalizeStructuredPayload(payload);
      } else {
        const text = payload.message || payload.text || payload.body || '';
        data = parseSmsMessage(text);
        data.raw = raw;
      }
    } else {
      data = parseSmsMessage(raw);
      data.raw = raw;
    }

    if (!data.amount || !Number.isFinite(Number(data.amount)) || Number(data.amount) <= 0) {
      logEvent({ source: 'rajhi', status: 'rejected_parse', ip, rawBody: raw, error: 'تعذر استخراج المبلغ' });
      return res.status(422).json({ ok: false, error: 'تعذر استخراج مبلغ الحوالة من الرسالة' });
    }

    try {
      const { transfer, duplicate } = createTransfer(
        {
          amount: data.amount,
          currency: data.currency,
          senderName: data.senderName,
          beneficiaryName: data.beneficiaryName,
          operationNumber: data.operationNumber,
          occurredAt: data.occurredAt,
          rawPayload: data.raw || raw,
        },
        { source: 'sms' },
      );

      logEvent({
        source: 'rajhi',
        status: duplicate ? 'duplicate' : 'parsed',
        ip,
        rawBody: raw,
        transferId: transfer.id,
      });

      logAudit({
        actorType: 'webhook',
        actorId: ip,
        action: duplicate ? 'transfer_duplicate_webhook' : 'transfer_created_webhook',
        targetType: 'transfer',
        targetId: transfer.id,
      });

      return res.status(duplicate ? 200 : 201).json({
        ok: true,
        duplicate,
        transfer: {
          id: transfer.id,
          amount: transfer.amount,
          currency: transfer.currency,
          amount_sar: transfer.amount_sar,
          operation_number: transfer.operation_number,
          occurred_at: transfer.occurred_at,
          status: transfer.status,
        },
      });
    } catch (err) {
      logger.error('webhook createTransfer failed', err);
      logEvent({ source: 'rajhi', status: 'error', ip, rawBody: raw, error: String(err.message || err) });
      return res.status(500).json({ ok: false, error: 'فشل حفظ الحوالة' });
    }
  });

  router.get('/health', (_req, res) => res.json({ ok: true }));

  return router;
}