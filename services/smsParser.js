import { parseAmount, toLatinDigits, normalizeName } from '../utils/normalize.js';
import { normalizeCurrency } from '../utils/money.js';

const AMOUNT_RE = /(?:بمبلغ|مبلغ|المبلغ|قيمة|amount)\s*[:\s]*([\d٠-٩۰-۹][\d٠-٩۰-۹.,]*)/i;
const OPERATION_RE = /(?:رقم\s*(?:العملية|المرجع|الحوالة|الإشعار)|عملية|مرجع|reference|operation)\s*[:\s#]*([A-Za-z0-9٠-٩۰-۹][A-Za-z0-9\-٠-٩۰-۹]{3,})/i;
const DATE_RE = /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})|(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/;
const TIME_RE = /(\d{1,2}:\d{2}(?::\d{2})?)/;
const CURRENCY_RE = /(ريال|SAR|ر\.س|دولار|USD|\$)/i;
const SENDER_RE = /(?:من\s*(?:حساب|المرسل|اسم)?|المرسل|sender)\s*[:\s]*([^\n\r,،]{3,60})/i;
const BENEFICIARY_RE = /(?:إلى|الى|المستفيد|beneficiary)\s*[:\s]*([^\n\r,،]{3,60})/i;

function parseDateParts(str) {
  const s = toLatinDigits(str);
  const m1 = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (m1) return { y: +m1[1], m: +m1[2], d: +m1[3] };
  const m2 = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m2) return { y: +m2[3], m: +m2[2], d: +m2[1] };
  return null;
}

export function parseSmsMessage(text) {
  const raw = String(text || '');
  const result = {
    amount: null,
    currency: 'SAR',
    senderName: null,
    beneficiaryName: null,
    operationNumber: null,
    occurredAt: null,
    raw,
  };

  const amountMatch = raw.match(AMOUNT_RE);
  if (amountMatch) result.amount = parseAmount(amountMatch[1]);

  if (!result.amount) {
    const anyNumber = raw.match(/([\d٠-٩۰-۹][\d٠-٩۰-۹.,]*)\s*(ريال|SAR|دولار|USD)/i);
    if (anyNumber) result.amount = parseAmount(anyNumber[1]);
  }

  if (CURRENCY_RE.test(raw)) {
    result.currency = normalizeCurrency(raw.match(CURRENCY_RE)[1], 'SAR');
  }

  const opMatch = raw.match(OPERATION_RE);
  if (opMatch) result.operationNumber = toLatinDigits(opMatch[1]).trim();

  const dateMatch = raw.match(DATE_RE);
  const timeMatch = raw.match(TIME_RE);
  if (dateMatch) {
    const parts = parseDateParts(dateMatch[0]);
    if (parts) {
      let hh = 0;
      let mm = 0;
      if (timeMatch) {
        const [h, m] = toLatinDigits(timeMatch[1]).split(':').map(Number);
        if (Number.isFinite(h)) hh = h;
        if (Number.isFinite(m)) mm = m;
      }
      const iso = `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+03:00`;
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) result.occurredAt = d.toISOString();
    }
  }

  const senderMatch = raw.match(SENDER_RE);
  if (senderMatch) {
    const v = senderMatch[1].replace(/\s+/g, ' ').trim();
    if (v && !/^\d+$/.test(v)) result.senderName = v;
  }

  const benMatch = raw.match(BENEFICIARY_RE);
  if (benMatch) {
    const v = benMatch[1].replace(/\s+/g, ' ').trim();
    if (v && !/^\d+$/.test(v)) result.beneficiaryName = v;
  }

  return result;
}

export function normalizeStructuredPayload(payload) {
  const p = payload || {};
  return {
    amount: parseAmount(p.amount),
    currency: normalizeCurrency(p.currency, 'SAR'),
    senderName: p.sender_name || p.senderName || p.sender || null,
    beneficiaryName: p.beneficiary_name || p.beneficiaryName || p.beneficiary || null,
    operationNumber: p.operation_number || p.operationNumber || p.reference || null,
    occurredAt: p.occurred_at || p.occurredAt || p.date || null,
    raw: JSON.stringify(p).slice(0, 8000),
  };
}

export { normalizeName };