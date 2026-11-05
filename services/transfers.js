import { db } from '../db/index.js';
import { round2, toSar, normalizeCurrency } from '../utils/money.js';
import { normalizeName, normalizeOperationNumber } from '../utils/normalize.js';
import { getNumberSetting } from './settings.js';
import { config } from '../config.js';

function normalizeIso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function getTransfer(id) {
  return db.prepare('SELECT * FROM transfers WHERE id = ?').get(Number(id)) || null;
}

export function createTransfer(input, { source = 'manual' } = {}) {
  const currency = normalizeCurrency(input.currency, 'SAR');
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('مبلغ الحوالة غير صالح');

  const usdRate = getNumberSetting('usd_rate', 3.75);
  const amountSar = toSar(amount, currency, usdRate);

  const opNorm = normalizeOperationNumber(input.operationNumber);

  if (opNorm) {
    const existing = db.prepare('SELECT * FROM transfers WHERE operation_number_norm = ?').get(opNorm);
    if (existing) return { transfer: existing, duplicate: true };
  }

  const occurredAt = normalizeIso(input.occurredAt) || new Date().toISOString();
  const senderName = input.senderName ? String(input.senderName).trim() : null;
  const beneficiaryName = input.beneficiaryName ? String(input.beneficiaryName).trim() : null;

  const info = db
    .prepare(
      `INSERT INTO transfers
        (amount, currency, amount_sar, sender_name, sender_name_norm, beneficiary_name, beneficiary_name_norm,
         operation_number, operation_number_norm, reference, occurred_at, source, raw_payload, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')`,
    )
    .run(
      amount,
      currency,
      amountSar,
      senderName,
      normalizeName(senderName),
      beneficiaryName,
      normalizeName(beneficiaryName),
      input.operationNumber ? String(input.operationNumber).trim() : null,
      opNorm || null,
      input.reference ? String(input.reference).trim() : null,
      occurredAt,
      input.source || source,
      input.rawPayload ? String(input.rawPayload).slice(0, 8000) : null,
    );

  return { transfer: getTransfer(info.lastInsertRowid), duplicate: false };
}

export function markTransferLinked(transferId, receiptId) {
  const res = db
    .prepare(
      `UPDATE transfers SET status = 'linked', used_by_receipt_id = ?
       WHERE id = ? AND status = 'available'`,
    )
    .run(Number(receiptId), Number(transferId));
  return res.changes > 0;
}

export function releaseTransfer(transferId) {
  db.prepare(`UPDATE transfers SET status = 'available', used_by_receipt_id = NULL WHERE id = ?`).run(
    Number(transferId),
  );
}

export function findAvailableTransfersNear(amountSar, occurredAt, options = {}) {
  const tol = options.toleranceSar ?? getNumberSetting('match_amount_tolerance_sar', config.matching.amountToleranceSar);
  const windowHours =
    options.windowHours ?? getNumberSetting('match_time_window_hours', config.matching.timeWindowHours);

  const rows = db
    .prepare(
      `SELECT * FROM transfers
       WHERE status = 'available' AND amount_sar BETWEEN ? AND ?`,
    )
    .all(round2(amountSar - tol), round2(amountSar + tol));

  if (!occurredAt) return rows;

  const t = new Date(occurredAt).getTime();
  if (Number.isNaN(t)) return rows;

  return rows.filter((r) => {
    if (!r.occurred_at) return true;
    const d = Math.abs(new Date(r.occurred_at).getTime() - t) / 3600000;
    return d <= windowHours * 3;
  });
}

export function findLinkedTransferByOperation(opNumber) {
  const norm = normalizeOperationNumber(opNumber);
  if (!norm) return null;
  return db.prepare('SELECT * FROM transfers WHERE operation_number_norm = ?').get(norm) || null;
}

export function listTransfers({ search = '', status = '', currency = '', page = 1, limit = 20 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(100, Math.max(1, Number(limit) || 20));
  const where = [];
  const params = [];

  if (status && ['available', 'linked', 'flagged'].includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (currency && ['SAR', 'USD'].includes(currency)) {
    where.push('currency = ?');
    params.push(currency);
  }
  if (search) {
    const s = `%${search}%`;
    where.push(
      `(sender_name LIKE ? OR beneficiary_name LIKE ? OR operation_number LIKE ? OR CAST(amount AS TEXT) LIKE ?)`,
    );
    params.push(s, s, s, s);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM transfers ${whereSql}`).get(...params).c;
  const items = db
    .prepare(`SELECT * FROM transfers ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, l, (p - 1) * l);

  return { items, total, page: p, pages: Math.max(1, Math.ceil(total / l)), limit: l };
}

export function transferStats() {
  const rows = db.prepare('SELECT status, COUNT(*) AS c FROM transfers GROUP BY status').all();
  const byStatus = { available: 0, linked: 0, flagged: 0 };
  for (const r of rows) byStatus[r.status] = r.c;
  const total = db.prepare('SELECT COUNT(*) AS c FROM transfers').get().c;
  return { total, ...byStatus };
}