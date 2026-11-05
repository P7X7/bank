const ARABIC_DIGITS = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export function toLatinDigits(value) {
  return String(value ?? '').replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d] ?? d);
}

export function parseAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = toLatinDigits(value).replace(/[^\d.,-]/g, '');
  if (!s) return null;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    const groups = s.split(',');
    const thousands = groups.length > 1 && groups.slice(1).every((g) => g.length === 3);
    s = thousands ? groups.join('') : s.replace(/,/g, '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function normalizeName(value) {
  if (!value) return '';
  let s = toLatinDigits(value).toLowerCase();
  s = s.replace(/[\u064B-\u065F\u0670\u0640]/g, '');
  s = s.replace(/[إأآا]/g, 'ا').replace(/[ىي]/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

export function normalizeOperationNumber(value) {
  if (!value) return '';
  return toLatinDigits(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function operationNumbersMatch(a, b) {
  const na = normalizeOperationNumber(a);
  const nb = normalizeOperationNumber(b);
  if (!na || !nb) return null;
  if (na === nb) return true;
  const da = na.replace(/\D/g, '');
  const db = nb.replace(/\D/g, '');
  if (da.length >= 4 && da === db) return true;
  return false;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return null;
  if (na === nb) return 1;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union ? inter / union : 0;
  const lev = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  let score = 0.5 * jaccard + 0.5 * lev;
  if (na.includes(nb) || nb.includes(na)) score = Math.max(score, 0.85);
  return Math.max(0, Math.min(1, score));
}