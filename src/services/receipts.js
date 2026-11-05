import { db } from '../db/index.js';
import { sha256 } from '../utils/crypto.js';
import { round2, toSar } from '../utils/money.js';
import { normalizeName, normalizeOperationNumber } from '../utils/normalize.js';
import { analyzeReceipt } from '../ai/receiptReader.js';
import { evaluateCandidate, pickBest } from './matching.js';
import { findAvailableTransfersNear, getTransfer, markTransferLinked } from './transfers.js';
import { getNumberSetting } from './settings.js';
import { logAudit } from './audit.js';
import { logger } from '../utils/logger.js';

function nowIso() {
  return new Date().toISOString();
}

function recordAttempt({ receiptId = null, imageHash = null, discordUserId = null, operationNumber = null, transferId = null, type, details = null }) {
  db.prepare(
    `INSERT INTO attempts (receipt_id, image_hash, discord_user_id, operation_number, transfer_id, type, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(receiptId, imageHash, discordUserId, operationNumber, transferId, type, details ? JSON.stringify(details) : null);
}

export function getReceipt(id) {
  return db.prepare('SELECT * FROM receipts WHERE id = ?').get(Number(id)) || null;
}

export function listReceipts({ search = '', status = '', page = 1, limit = 20 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(100, Math.max(1, Number(limit) || 20));
  const where = [];
  const params = [];

  if (status && ['processing', 'accepted', 'rejected', 'review', 'error'].includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (search) {
    const s = `%${search}%`;
    where.push(
      `(sender_name LIKE ? OR beneficiary_name LIKE ? OR operation_number LIKE ? OR discord_user_id LIKE ? OR discord_user_name LIKE ?)`,
    );
    params.push(s, s, s, s, s);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM receipts ${whereSql}`).get(...params).c;
  const items = db
    .prepare(`SELECT * FROM receipts ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, l, (p - 1) * l);

  return { items, total, page: p, pages: Math.max(1, Math.ceil(total / l)), limit: l };
}

export function receiptStats() {
  const rows = db.prepare('SELECT status, COUNT(*) AS c, COALESCE(SUM(amount_sar),0) AS s FROM receipts GROUP BY status').all();
  const byStatus = { processing: 0, accepted: 0, rejected: 0, review: 0, error: 0 };
  const sums = { accepted: 0, review: 0, rejected: 0 };
  for (const r of rows) {
    byStatus[r.status] = r.c;
    if (r.status in sums) sums[r.status] = r.s;
  }
  const total = db.prepare('SELECT COUNT(*) AS c FROM receipts').get().c;
  return { total, ...byStatus, sums };
}

export function attemptStats() {
  const total = db.prepare('SELECT COUNT(*) AS c FROM attempts').get().c;
  const rows = db.prepare('SELECT type, COUNT(*) AS c FROM attempts GROUP BY type').all();
  return { total, byType: Object.fromEntries(rows.map((r) => [r.type, r.c])) };
}

/**
 * خط الأنابيب الكامل لمعالجة إيصال جديد.
 */
export async function processReceipt({ imageBuffer, mimeType, imageUrl, user, channelId, messageId }) {
  const imageHash = sha256(imageBuffer);
  const userId = user?.id || null;
  const userName = user?.username || null;

  const existing = db
    .prepare(`SELECT * FROM receipts WHERE image_hash = ? AND status <> 'error'`)
    .get(imageHash);

  if (existing) {
    recordAttempt({
      receiptId: existing.id,
      imageHash,
      discordUserId: userId,
      type: 'duplicate_image',
      details: { originalReceiptId: existing.id, originalUser: existing.discord_user_id },
    });
    logAudit({
      actorType: 'discord',
      actorId: userId,
      actorName: userName,
      action: 'duplicate_receipt_attempt',
      targetType: 'receipt',
      targetId: existing.id,
      details: { imageHash },
    });
    return { outcome: 'duplicate', receipt: existing, message: 'تم إرسال هذا الإيصال مسبقاً.' };
  }

  let receiptId;
  try {
    const info = db
      .prepare(
        `INSERT INTO receipts (discord_user_id, discord_user_name, discord_channel_id, discord_message_id,
            image_hash, image_url, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'processing', datetime('now'))`,
      )
      .run(userId, userName, channelId || null, messageId || null, imageHash, imageUrl || null);
    receiptId = Number(info.lastInsertRowid);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      recordAttempt({ imageHash, discordUserId: userId, type: 'duplicate_image', details: { race: true } });
      return { outcome: 'duplicate', receipt: null, message: 'تم إرسال هذا الإيصال مسبقاً.' };
    }
    throw err;
  }

  let parsed;
  try {
    parsed = await analyzeReceipt({ imageBuffer, mimeType });
  } catch (err) {
    logger.error('analyzeReceipt failed', err);
    db.prepare(`UPDATE receipts SET status='error', reason=?, updated_at=datetime('now') WHERE id=?`).run(
      String(err.message || 'فشل التحليل'),
      receiptId,
    );
    return { outcome: 'error', receipt: getReceipt(receiptId), message: 'تعذر تحليل صورة الإيصال، حاول مرة أخرى.' };
  }

  if (!parsed.isReceipt) {
    db.prepare(`UPDATE receipts SET status='error', reason=?, updated_at=datetime('now') WHERE id=?`).run(
      'الصورة ليست إيصال تحويل',
      receiptId,
    );
    return { outcome: 'error', receipt: getReceipt(receiptId), message: 'الصورة المرفقة لا تبدو إيصال تحويل.' };
  }

  if (parsed.amount === null || parsed.amount <= 0) {
    db.prepare(`UPDATE receipts SET status='rejected', reason=?, ai_confidence=?, ai_raw=?, updated_at=datetime('now') WHERE id=?`).run(
      'تعذر قراءة مبلغ الإيصال',
      parsed.confidence,
      JSON.stringify(parsed.raw),
      receiptId,
    );
    return { outcome: 'rejected', receipt: getReceipt(receiptId), message: 'تعذر قراءة مبلغ الإيصال بوضوح.' };
  }

  const usdRate = getNumberSetting('usd_rate', 3.75);
  const amountSar = toSar(parsed.amount, parsed.currency, usdRate);
  const opNorm = normalizeOperationNumber(parsed.operationNumber);

  db.prepare(
    `UPDATE receipts SET amount=?, currency=?, amount_sar=?, sender_name=?, sender_name_norm=?,
        beneficiary_name=?, beneficiary_name_norm=?, operation_number=?, operation_number_norm=?,
        occurred_at=?, bank_name=?, ai_confidence=?, ai_notes=?, ai_raw=?, updated_at=datetime('now')
     WHERE id=?`,
  ).run(
    round2(parsed.amount),
    parsed.currency,
    amountSar,
    parsed.senderName,
    normalizeName(parsed.senderName),
    parsed.beneficiaryName,
    normalizeName(parsed.beneficiaryName),
    parsed.operationNumber,
    opNorm || null,
    parsed.occurredAt,
    parsed.bankName,
    parsed.confidence,
    parsed.notes,
    JSON.stringify(parsed.raw),
    receiptId,
  );

  const receipt = getReceipt(receiptId);

  // منع تكرار رقم العملية
  if (opNorm) {
    const dupOp = db
      .prepare(`SELECT * FROM receipts WHERE operation_number_norm = ? AND status IN ('accepted','review') AND id <> ?`)
      .get(opNorm, receiptId);
    if (dupOp) {
      recordAttempt({
        receiptId,
        imageHash,
        discordUserId: userId,
        operationNumber: parsed.operationNumber,
        type: 'duplicate_operation_number',
        details: { originalReceiptId: dupOp.id },
      });
      db.prepare(`UPDATE receipts SET status='rejected', reason=?, updated_at=datetime('now') WHERE id=?`).run(
        `رقم العملية مستخدم مسبقاً في إيصال رقم ${dupOp.id}`,
        receiptId,
      );
      return {
        outcome: 'rejected',
        receipt: getReceipt(receiptId),
        message: 'رقم العملية في هذا الإيصال تم استخدامه مسبقاً.',
      };
    }
  }

  const candidates = findAvailableTransfersNear(amountSar, parsed.occurredAt);

  if (!candidates.length) {
    const linkedSameOp = opNorm
      ? db
          .prepare(`SELECT * FROM transfers WHERE operation_number_norm = ? AND status = 'linked'`)
          .get(opNorm)
      : null;

    if (linkedSameOp) {
      recordAttempt({
        receiptId,
        imageHash,
        discordUserId: userId,
        operationNumber: parsed.operationNumber,
        transferId: linkedSameOp.id,
        type: 'transfer_already_linked',
        details: { receiptId: linkedSameOp.used_by_receipt_id },
      });
      db.prepare(`UPDATE receipts SET status='rejected', reason=?, transfer_id=?, updated_at=datetime('now') WHERE id=?`).run(
        'الحوالة مرتبطة بإيصال آخر',
        linkedSameOp.id,
        receiptId,
      );
      return {
        outcome: 'rejected',
        receipt: getReceipt(receiptId),
        message: 'الحوالة المرتبطة بهذا الإيصال مرتبطة مسبقاً بإيصال آخر.',
      };
    }

    recordAttempt({ receiptId, imageHash, discordUserId: userId, type: 'no_matching_transfer', details: { amountSar } });
    db.prepare(`UPDATE receipts SET status='rejected', reason=?, updated_at=datetime('now') WHERE id=?`).run(
      'لا توجد حوالة مطابقة',
      receiptId,
    );
    return {
      outcome: 'rejected',
      receipt: getReceipt(receiptId),
      message: 'لا توجد حوالة مطابقة لهذا الإيصال في النظام.',
    };
  }

  const evaluations = candidates.map((t) => evaluateCandidate(receipt, t));
  const { best, ambiguous } = pickBest(evaluations);

  let verdict = best.verdict;
  const reasons = [...best.reasons];
  if (ambiguous) {
    verdict = 'review';
    reasons.push('توجد أكثر من حوالة محتملة بنفس درجة التطابق');
  }
  if (parsed.confidence < 0.6 && verdict === 'accepted') {
    verdict = 'review';
    reasons.push('ثقة قراءة الإيصال منخفضة');
  }

  const criteriaJson = JSON.stringify({
    criteria: best.criteria,
    reasons,
    amountSar,
    usdRate,
    confidence: parsed.confidence,
    candidates: evaluations.map((e) => ({ transferId: e.transferId, score: e.score, verdict: e.verdict })),
  });

  if (verdict === 'accepted') {
    const linked = markTransferLinked(best.transferId, receiptId);
    if (!linked) {
      db.prepare(`UPDATE receipts SET status='review', reason=?, transfer_id=?, score=?, criteria_json=?, updated_at=datetime('now') WHERE id=?`).run(
        'الحوالة لم تعد متاحة',
        best.transferId,
        best.score,
        criteriaJson,
        receiptId,
      );
      return {
        outcome: 'review',
        receipt: getReceipt(receiptId),
        transfer: best.transfer,
        evaluation: best,
        message: 'الحوالة لم تعد متاحة، تم تحويل الإيصال للمراجعة الإدارية.',
      };
    }
    db.prepare(`UPDATE receipts SET status='accepted', reason=?, transfer_id=?, score=?, criteria_json=?, updated_at=datetime('now') WHERE id=?`).run(
      reasons.length ? reasons.join('؛ ') : 'تمت المطابقة بنجاح',
      best.transferId,
      best.score,
      criteriaJson,
      receiptId,
    );
    logAudit({
      actorType: 'system',
      action: 'receipt_accepted',
      targetType: 'receipt',
      targetId: receiptId,
      details: { transferId: best.transferId, score: best.score },
    });
    return {
      outcome: 'accepted',
      receipt: getReceipt(receiptId),
      transfer: best.transfer,
      evaluation: best,
      message: 'تم التحقق من الإيصال ومطابقته مع الحوالة بنجاح.',
    };
  }

  if (verdict === 'rejected') {
    db.prepare(`UPDATE receipts SET status='rejected', reason=?, transfer_id=?, score=?, criteria_json=?, updated_at=datetime('now') WHERE id=?`).run(
      reasons.join('؛ ') || 'لم تتطابق المعايير',
      best.transferId,
      best.score,
      criteriaJson,
      receiptId,
    );
    recordAttempt({
      receiptId,
      imageHash,
      discordUserId: userId,
      operationNumber: parsed.operationNumber,
      transferId: best.transferId,
      type: 'rejected_mismatch',
      details: { reasons },
    });
    return {
      outcome: 'rejected',
      receipt: getReceipt(receiptId),
      transfer: best.transfer,
      evaluation: best,
      message: 'تم رفض الإيصال لعدم تطابق البيانات.',
    };
  }

  db.prepare(`UPDATE receipts SET status='review', reason=?, transfer_id=?, score=?, criteria_json=?, updated_at=datetime('now') WHERE id=?`).run(
    reasons.join('؛ ') || 'يحتاج مراجعة إدارية',
    best.transferId,
    best.score,
    criteriaJson,
    receiptId,
  );
  return {
    outcome: 'review',
    receipt: getReceipt(receiptId),
    transfer: best.transfer,
    evaluation: best,
    message: 'الإيصال يحتاج مراجعة إدارية.',
  };
}

/**
 * تطبيق قرار المراجعة الإدارية على إيصال.
 */
export function applyReview(receiptId, decision, actor = {}) {
  const receipt = getReceipt(receiptId);
  if (!receipt) throw new Error('الإيصال غير موجود');
  if (receipt.status !== 'review') throw new Error('هذا الإيصال لا يحتاج مراجعة');
  if (!['accepted', 'rejected'].includes(decision)) throw new Error('قرار غير صالح');

  const now = nowIso();

  if (decision === 'accepted') {
    let transferId = receipt.transfer_id;
    if (!transferId) {
      const candidates = findAvailableTransfersNear(receipt.amount_sar, receipt.occurred_at);
      if (!candidates.length) throw new Error('لا توجد حوالة متاحة لربطها بهذا الإيصال');
      const evaluations = candidates.map((t) => evaluateCandidate(receipt, t));
      const { best } = pickBest(evaluations);
      transferId = best.transferId;
    }
    const transfer = getTransfer(transferId);
    if (!transfer) throw new Error('الحوالة غير موجودة');
    if (transfer.status === 'linked' && transfer.used_by_receipt_id !== receipt.id) {
      throw new Error('الحوالة مرتبطة بإيصال آخر بالفعل');
    }
    if (transfer.status === 'available') {
      markTransferLinked(transferId, receipt.id);
    }
    db.prepare(
      `UPDATE receipts SET status='accepted', reviewed_by=?, reviewed_at=?, review_note=?, transfer_id=?, updated_at=datetime('now') WHERE id=?`,
    ).run(actor.staffId ?? null, now, actor.note || null, transferId, receipt.id);
  } else {
    db.prepare(
      `UPDATE receipts SET status='rejected', reviewed_by=?, reviewed_at=?, review_note=?, updated_at=datetime('now') WHERE id=?`,
    ).run(actor.staffId ?? null, now, actor.note || null, receipt.id);
  }

  logAudit({
    actorType: actor.type || 'staff',
    actorId: actor.id ?? actor.staffId ?? null,
    actorName: actor.name || null,
    action: `receipt_review_${decision}`,
    targetType: 'receipt',
    targetId: receipt.id,
    details: { note: actor.note || null },
  });

  return getReceipt(receipt.id);
}

export function listPendingReviews(limit = 25) {
  return db
    .prepare(`SELECT * FROM receipts WHERE status='review' ORDER BY id ASC LIMIT ?`)
    .all(Math.min(25, Math.max(1, Number(limit) || 25)));
}