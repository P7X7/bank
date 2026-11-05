export const CURRENCIES = ['SAR', 'USD'];

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function toSar(amount, currency, usdRate) {
  const a = round2(amount);
  if (String(currency).toUpperCase() === 'USD') return round2(a * (Number(usdRate) || 3.75));
  return a;
}

export function normalizeCurrency(value, fallback = 'SAR') {
  const c = String(value || '').toUpperCase().trim();
  if (c === 'USD' || c.includes('دولار') || c === 'US$' || c === '$') return 'USD';
  if (c === 'SAR' || c.includes('ريال') || c === 'SR' || c.includes('سعودي')) return 'SAR';
  return fallback;
}

export function formatMoney(amount, currency) {
  const v = Number(amount || 0);
  return `${v.toFixed(2)} ${currency === 'USD' ? 'دولار' : 'ريال'}`;
}