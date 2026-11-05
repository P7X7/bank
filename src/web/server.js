import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { config } from '../config.js';
import { createWebhookRouter } from '../webhook/router.js';
import { parseCookies, loadSession, requireCsrf } from './auth.js';
import authRoutes from './routes/auth.js';
import statsRoutes from './routes/stats.js';
import transferRoutes from './routes/transfers.js';
import receiptRoutes from './routes/receipts.js';
import staffRoutes from './routes/staff.js';
import settingsRoutes from './routes/settings.js';
import auditRoutes from './routes/audit.js';
import { logger } from '../utils/logger.js';

export function createWebServer() {
  const app = express();

  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // الـ Webhook يُركّب قبل محلل JSON لأنه يحتاج الجسم الخام للتوقيع
  app.use('/webhook', createWebhookRouter());

  app.use(express.json({ limit: '1mb' }));
  app.use(parseCookies);
  app.use(loadSession);

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'عدد الطلبات كبير جداً' },
  });
  app.use('/api', apiLimiter);

  app.get('/api/health', (_req, res) =>
    res.json({
      ok: true,
      service: 'bank-verification',
      time: new Date().toISOString(),
    }),
  );

  app.use('/api/auth', authRoutes);
  app.use('/api/stats', requireCsrf, statsRoutes);
  app.use('/api/transfers', requireCsrf, transferRoutes);
  app.use('/api/receipts', requireCsrf, receiptRoutes);
  app.use('/api/staff', requireCsrf, staffRoutes);
  app.use('/api/settings', requireCsrf, settingsRoutes);
  app.use('/api/audit', requireCsrf, auditRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'المسار غير موجود' }));

  const publicDir = path.join(config.root, 'src', 'public');
  app.use(express.static(publicDir, { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));

  app.use((err, _req, res, _next) => {
    logger.error('خطأ غير معالج في الويب', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  });

  return app;
}