import { config, assertConfig } from './config.js';
import { logger } from './utils/logger.js';
import { db, closeDb } from './db/index.js';
import { createWebServer } from './web/server.js';
import { purgeExpiredSessions } from './web/auth.js';
import { startDiscord, client } from './discord/client.js';

assertConfig();

const app = createWebServer();

const server = app.listen(config.port, () => {
  logger.info(`لوحة التحكم تعمل على المنفذ ${config.port}`);
  logger.info(`رابط الـ Webhook: ${config.publicUrl.replace(/\/$/, '')}/webhook/rajhi`);
});

server.on('error', (err) => logger.error('خطأ في خادم الويب', err));

purgeExpiredSessions();
const sessionTimer = setInterval(purgeExpiredSessions, 60 * 60 * 1000);
sessionTimer.unref();

startDiscord().catch((err) => logger.error('فشل تشغيل بوت Discord', err));

async function shutdown(signal) {
  logger.info(`إيقاف النظام (${signal})...`);
  clearInterval(sessionTimer);
  try {
    await client?.destroy();
  } catch {
    /* ignore */
  }
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', err));
process.on('uncaughtException', (err) => logger.error('Uncaught exception', err));