const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = levels[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 2;
const ts = () => new Date().toISOString();

export const logger = {
  error: (...a) => threshold >= 0 && console.error(`[${ts()}] [ERROR]`, ...a),
  warn: (...a) => threshold >= 1 && console.warn(`[${ts()}] [WARN]`, ...a),
  info: (...a) => threshold >= 2 && console.log(`[${ts()}] [INFO]`, ...a),
  debug: (...a) => threshold >= 3 && console.log(`[${ts()}] [DEBUG]`, ...a),
};