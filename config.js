import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const num = (v, f) => (Number.isFinite(Number(v)) ? Number(v) : f);
const bool = (v, f = false) => (v === undefined ? f : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

const env = (process.env.NODE_ENV || 'development').toLowerCase();
const port = num(process.env.PORT, 3000);

export const config = {
  env,
  isProd: env === 'production',
  root,
  port,
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${port}`,
  databasePath: process.env.DATABASE_PATH || path.join(root, 'data', 'bank.sqlite'),
  trustProxy: bool(process.env.TRUST_PROXY, true),
  session: {
    cookieName: 'bank_session',
    csrfCookieName: 'bank_csrf',
    ttlHours: num(process.env.SESSION_TTL_HOURS, 12),
    secure: env === 'production',
  },
  discord: {
    token: process.env.DISCORD_TOKEN || '',
    clientId: process.env.DISCORD_CLIENT_ID || '',
    guildId: process.env.DISCORD_GUILD_ID || '',
    adminRoleIds: list(process.env.DISCORD_ADMIN_ROLE_IDS),
    staffRoleIds: list(process.env.DISCORD_STAFF_ROLE_IDS),
    receiptsChannelId: process.env.DISCORD_RECEIPTS_CHANNEL_ID || '',
    reviewChannelId: process.env.DISCORD_REVIEW_CHANNEL_ID || '',
    logChannelId: process.env.DISCORD_LOG_CHANNEL_ID || '',
    autoRegisterCommands: bool(process.env.DISCORD_AUTO_REGISTER_COMMANDS, true),
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    maxImageBytes: num(process.env.MAX_IMAGE_BYTES, 8 * 1024 * 1024),
  },
  webhook: {
    secret: process.env.WEBHOOK_SECRET || '',
    bearerToken: process.env.WEBHOOK_BEARER_TOKEN || '',
    allowedIps: list(process.env.WEBHOOK_ALLOWED_IPS),
    signatureHeader: 'x-webhook-signature',
    rejectUnsigned: bool(process.env.WEBHOOK_REJECT_UNSIGNED, true),
  },
  matching: {
    amountToleranceSar: num(process.env.MATCH_AMOUNT_TOLERANCE_SAR, 0.01),
    timeWindowHours: num(process.env.MATCH_TIME_WINDOW_HOURS, 48),
    nameMinSimilarity: num(process.env.MATCH_NAME_MIN_SIMILARITY, 0.6),
  },
  bootstrapAdmin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
  },
  serviceApiKey: process.env.SERVICE_API_KEY || '',
};

export function assertConfig() {
  const warnings = [];
  if (!config.discord.token) warnings.push('DISCORD_TOKEN غير مهيأ — بوت Discord لن يعمل.');
  if (!config.anthropic.apiKey) warnings.push('ANTHROPIC_API_KEY غير مهيأ — قراءة الإيصالات لن تعمل.');
  if (!config.webhook.secret && !config.webhook.bearerToken)
    warnings.push('WEBHOOK_SECRET غير مهيأ — سيتم رفض كل طلبات الـ Webhook.');
  if (!config.bootstrapAdmin.password)
    warnings.push('ADMIN_PASSWORD غير مهيأ — لن يتم إنشاء حساب المدير الأولي.');
  if (!config.publicUrl.startsWith('https://') && config.isProd)
    warnings.push('PUBLIC_URL يجب أن يبدأ بـ https في الإنتاج.');
  warnings.forEach((w) => logger.warn(w));
  if (config.isProd && !config.session.secure) logger.warn('كوكيز الجلسة غير آمنة.');
}