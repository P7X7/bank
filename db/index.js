import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { hashPassword } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin','employee')),
  discord_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_staff ON sessions(staff_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('SAR','USD')),
  amount_sar REAL NOT NULL,
  sender_name TEXT,
  sender_name_norm TEXT,
  beneficiary_name TEXT,
  beneficiary_name_norm TEXT,
  operation_number TEXT,
  operation_number_norm TEXT,
  reference TEXT,
  occurred_at TEXT,
  source TEXT NOT NULL DEFAULT 'sms',
  raw_payload TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','linked','flagged')),
  used_by_receipt_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transfers_amount ON transfers(amount_sar);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_op ON transfers(operation_number_norm);
CREATE INDEX IF NOT EXISTS idx_transfers_time ON transfers(occurred_at);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT,
  discord_user_name TEXT,
  discord_channel_id TEXT,
  discord_message_id TEXT,
  image_hash TEXT NOT NULL,
  image_url TEXT,
  amount REAL,
  currency TEXT,
  amount_sar REAL,
  sender_name TEXT,
  sender_name_norm TEXT,
  beneficiary_name TEXT,
  beneficiary_name_norm TEXT,
  operation_number TEXT,
  operation_number_norm TEXT,
  occurred_at TEXT,
  bank_name TEXT,
  ai_confidence REAL,
  ai_notes TEXT,
  ai_raw TEXT,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','accepted','rejected','review','error')),
  reason TEXT,
  score REAL,
  criteria_json TEXT,
  transfer_id INTEGER,
  review_message_id TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_hash ON receipts(image_hash) WHERE status <> 'error';
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status);
CREATE INDEX IF NOT EXISTS idx_receipts_op ON receipts(operation_number_norm);
CREATE INDEX IF NOT EXISTS idx_receipts_created ON receipts(created_at);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER,
  image_hash TEXT,
  discord_user_id TEXT,
  operation_number TEXT,
  transfer_id INTEGER,
  type TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_type ON attempts(type);
CREATE INDEX IF NOT EXISTS idx_attempts_hash ON attempts(image_hash);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT,
  status TEXT,
  ip TEXT,
  raw_body TEXT,
  error TEXT,
  transfer_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_created ON webhook_events(created_at);
`;

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(SCHEMA);

const seed = db.transaction(() => {
  const defaults = {
    usd_rate: '3.75',
    match_time_window_hours: String(config.matching.timeWindowHours),
    match_name_min_similarity: String(config.matching.nameMinSimilarity),
    match_amount_tolerance_sar: String(config.matching.amountToleranceSar),
  };
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) ins.run(k, v);

  const count = db.prepare('SELECT COUNT(*) AS c FROM staff').get().c;
  if (count === 0) {
    if (config.bootstrapAdmin.password) {
      db.prepare('INSERT INTO staff (username, password_hash, role) VALUES (?, ?, ?)').run(
        config.bootstrapAdmin.username,
        hashPassword(config.bootstrapAdmin.password),
        'admin',
      );
      logger.info(`تم إنشاء حساب المدير الأولي: ${config.bootstrapAdmin.username}`);
    } else {
      logger.warn('لا يوجد أي حساب مدير. عيّن ADMIN_PASSWORD في متغيرات البيئة.');
    }
  }
});
seed();

export function closeDb() {
  try {
    db.close();
  } catch {
    /* ignore */
  }
}