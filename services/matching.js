import { config } from '../config.js';
import { round2 } from '../utils/money.js';
import { nameSimilarity, operationNumbersMatch } from '../utils/normalize.js';
import { getNumberSetting } from './settings.js';

const WEIGHTS = {
  amount: 0.35,
  operationNumber: 0.25,
  time: 0.2,
  sender: 0.15,
  beneficiary: 0.05,
};

export function evaluateCandidate(receipt, transfer, options = {}) {
  const tolerance = options.toleranceSar ?? getNumberSetting('match_amount_tolerance_sar', config.matching.amountToleranceSar);
  const windowHours = options.windowHours ?? getNumberSetting('match_time_window_hours', config.matching.timeWindowHours);
  const minName = options.nameMinSimilarity ?? getNumberSetting('match_name_min_similarity', config.matching.nameMinSimilarity);

  const criteria = [];
  const reasons = [];
  let verdict = 'accepted';
  const soft = () => {
    if (verdict === 'accepted') verdict = 'review';
  };
  const hard = () => {
    verdict = 'rejected';
  };

  // 1) المبلغ
  const diff = round2(Math.abs(round2(receipt.amountSar) - round2(transfer.amount_sar)));
  const amountOk = diff <= tolerance;
  criteria.push({
    key: 'amount',
    label: 'المبلغ',
    status: amountOk ? 'match' : 'mismatch',
    detail: amountOk ? 'مطابق' : `فرق ${diff.toFixed(2)} ريال`,
    weight: WEIGHTS.amount,
    value: amountOk ? 1 : 0,
  });
  if (!amountOk) {
    hard();
    reasons.push(`المبلغ غير مطابق (الفارق ${diff.toFixed(2)} ريال)`);
  }

  // 2) رقم العملية
  const opMatch = operationNumbersMatch(receipt.operationNumber, transfer.operation_number);
  let opValue = 0.5;
  let opStatus = 'unknown';
  let opDetail = 'غير متوفر في الطرفين';
  if (opMatch === true) {
    opValue = 1;
    opStatus = 'match';
    opDetail = 'مطابق';
  } else if (opMatch === false) {
    opValue = 0;
    opStatus = 'mismatch';
    opDetail = 'غير مطابق';
    hard();
    reasons.push('رقم العملية غير مطابق');
  } else if (receipt.operationNumber && !transfer.operation_number) {
    opDetail = 'رقم العملية غير مسجل في الحوالة';
  } else if (!receipt.operationNumber && transfer.operation_number) {
    opDetail = 'لم يُقرأ رقم العملية من الإيصال';
    soft();
    reasons.push('تعذر قراءة رقم العملية من الإيصال');
  }
  criteria.push({
    key: 'operationNumber',
    label: 'رقم العملية',
    status: opStatus,
    detail: opDetail,
    weight: WEIGHTS.operationNumber,
    value: opValue,
  });

  // 3) التوقيت
  let timeValue = 0.5;
  let timeStatus = 'unknown';
  let timeDetail = 'لا يتوفر تاريخ للمقارنة';
  if (receipt.occurredAt && transfer.occurred_at) {
    const hours = Math.abs(new Date(receipt.occurredAt).getTime() - new Date(transfer.occurred_at).getTime()) / 3600000;
    if (Number.isFinite(hours)) {
      if (hours <= windowHours) {
        timeValue = 1;
        timeStatus = 'match';
        timeDetail = `الفارق ${hours.toFixed(1)} ساعة`;
      } else if (hours <= windowHours * 2) {
        timeValue = 0.3;
        timeStatus = 'unknown';
        timeDetail = `الفارق ${hours.toFixed(1)} ساعة (خارج النطاق المسموح)`;
        soft();
        reasons.push(`فرق التوقيت ${hours.toFixed(1)} ساعة خارج النطاق المسموح`);
      } else {
        timeValue = 0;
        timeStatus = 'mismatch';
        timeDetail = `الفارق ${hours.toFixed(1)} ساعة`;
        hard();
        reasons.push('فرق التوقيت كبير جداً بين الحوالة والإيصال');
      }
    }
  }
  criteria.push({ key: 'time', label: 'التاريخ والوقت', status: timeStatus, detail: timeDetail, weight: WEIGHTS.time, value: timeValue });

  // 4) اسم المرسل
  const senderSim = nameSimilarity(receipt.senderName, transfer.sender_name);
  let senderValue = 0.5;
  let senderStatus = 'unknown';
  let senderDetail = 'غير متوفر للمقارنة';
  if (senderSim !== null) {
    if (senderSim >= minName) {
      senderValue = 1;
      senderStatus = 'match';
      senderDetail = `تشابه ${(senderSim * 100).toFixed(0)}%`;
    } else if (senderSim >= 0.35) {
      senderValue = 0.4;
      senderStatus = 'unknown';
      senderDetail = `تشابه ضعيف ${(senderSim * 100).toFixed(0)}%`;
      soft();
      reasons.push('تشابه اسم المرسل ضعيف');
    } else {
      senderValue = 0;
      senderStatus = 'mismatch';
      senderDetail = `تشابه ${(senderSim * 100).toFixed(0)}%`;
      hard();
      reasons.push('اسم المرسل غير مطابق');
    }
  }
  criteria.push({ key: 'sender', label: 'اسم المرسل', status: senderStatus, detail: senderDetail, weight: WEIGHTS.sender, value: senderValue });

  // 5) اسم المستفيد
  const benSim = nameSimilarity(receipt.beneficiaryName, transfer.beneficiary_name);
  let benValue = 0.5;
  let benStatus = 'unknown';
  let benDetail = 'غير متوفر للمقارنة';
  if (benSim !== null) {
    if (benSim >= minName) {
      benValue = 1;
      benStatus = 'match';
      benDetail = `تشابه ${(benSim * 100).toFixed(0)}%`;
    } else if (benSim >= 0.35) {
      benValue = 0.4;
      benStatus = 'unknown';
      benDetail = `تشابه ضعيف ${(benSim * 100).toFixed(0)}%`;
      soft();
      reasons.push('تشابه اسم المستفيد ضعيف');
    } else {
      benValue = 0;
      benStatus = 'mismatch';
      benDetail = `تشابه ${(benSim * 100).toFixed(0)}%`;
      soft();
      reasons.push('اسم المستفيد غير مطابق');
    }
  }
  criteria.push({ key: 'beneficiary', label: 'اسم المستفيد', status: benStatus, detail: benDetail, weight: WEIGHTS.beneficiary, value: benValue });

  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
  const score = criteria.reduce((s, c) => s + c.weight * c.value, 0) / totalWeight;

  return {
    transferId: transfer.id,
    transfer,
    verdict,
    score: round2(score * 100) / 100,
    criteria,
    reasons,
  };
}

export function pickBest(evaluations) {
  if (!evaluations.length) return { best: null, ambiguous: false };
  const rank = { accepted: 3, review: 2, rejected: 1 };
  const sorted = [...evaluations].sort((a, b) => rank[b.verdict] - rank[a.verdict] || b.score - a.score);
  const best = sorted[0];
  const second = sorted[1];
  const ambiguous = Boolean(second && second.verdict === best.verdict && Math.abs(second.score - best.score) < 0.05);
  return { best, ambiguous };
}