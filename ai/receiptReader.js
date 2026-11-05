import { config } from '../config.js';
import { parseAmount, toLatinDigits } from '../utils/normalize.js';
import { normalizeCurrency } from '../utils/money.js';
import { logger } from '../utils/logger.js';

const PROMPT = `أنت نظام استخراج بيانات من إيصالات التحويل البنكي.
اقرأ الصورة بدقة واستخرج الحقول المطلوبة عبر الأداة record_receipt.

قواعد صارمة:
- إن لم تكن الصورة إيصال تحويل أو حوالة مالية، اجعل is_receipt = false واملأ باقي الحقول بـ null.
- المبلغ: رقم فقط بدون فواصل أو عملة. إن وُجد أكثر من مبلغ، اختر المبلغ المحوَّل الفعلي (وليس الرسوم).
- العملة: SAR أو USD فقط. إيصالات بنك الراجحي عادةً SAR.
- date بصيغة YYYY-MM-DD ميلادي، وtime بصيغة HH:MM بنظام 24 ساعة. إن كانت الصورة بالتقويم الهجري فحوّلها إلى ميلادي.
- sender_name: اسم المُحوِّل كما هو مكتوب. beneficiary_name: اسم المستفيد كما هو مكتوب.
- operation_number: رقم العملية أو رقم المرجع إن وُجد، انسخه حرفياً.
- confidence: رقم من 0 إلى 1 يعبّر عن ثقتك في دقة الاستخراج.
- لا تخمّن قيماً غير موجودة، استخدم null.`;

const TOOL = {
  name: 'record_receipt',
  description: 'تسجيل بيانات إيصال التحويل المستخرجة من الصورة',
  input_schema: {
    type: 'object',
    properties: {
      is_receipt: { type: 'boolean', description: 'هل الصورة إيصال تحويل مالي؟' },
      amount: { type: ['number', 'null'], description: 'المبلغ المحوَّل' },
      currency: { type: ['string', 'null'], description: "SAR أو USD" },
      sender_name: { type: ['string', 'null'] },
      beneficiary_name: { type: ['string', 'null'] },
      date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      time: { type: ['string', 'null'], description: 'HH:MM' },
      operation_number: { type: ['string', 'null'] },
      bank_name: { type: ['string', 'null'] },
      confidence: { type: 'number', description: '0 إلى 1' },
      notes: { type: ['string', 'null'] },
    },
    required: [
      'is_receipt',
      'amount',
      'currency',
      'sender_name',
      'beneficiary_name',
      'date',
      'time',
      'operation_number',
      'bank_name',
      'confidence',
      'notes',
    ],
  },
};

function normalizeMediaType(mimeType) {
  const t = String(mimeType || '').toLowerCase();
  if (['image/jpeg', 'image/jpg'].includes(t)) return 'image/jpeg';
  if (t === 'image/png') return 'image/png';
  if (t === 'image/gif') return 'image/gif';
  if (t === 'image/webp') return 'image/webp';
  return null;
}

function buildOccurredAt(date, time) {
  if (!date) return null;
  const d = toLatinDigits(String(date)).trim();
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(d)) return null;
  const [y, m, day] = d.split('-').map(Number);
  let hh = 0;
  let mm = 0;
  if (time) {
    const t = toLatinDigits(String(time)).match(/(\d{1,2}):(\d{2})/);
    if (t) {
      hh = Number(t[1]);
      mm = Number(t[2]);
    }
  }
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+03:00`;
  const d2 = new Date(iso);
  return Number.isNaN(d2.getTime()) ? null : d2.toISOString();
}

function cleanString(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'null' || s === '-' || s === 'غير متوفر') return null;
  return s;
}

export function normalizeParsed(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const amount = parseAmount(raw.amount);
  const confidence = Number(raw.confidence);
  return {
    isReceipt: raw.is_receipt !== false,
    amount: amount !== null && amount > 0 ? amount : null,
    currency: normalizeCurrency(cleanString(raw.currency) || 'SAR', 'SAR'),
    senderName: cleanString(raw.sender_name),
    beneficiaryName: cleanString(raw.beneficiary_name),
    operationNumber: cleanString(raw.operation_number),
    bankName: cleanString(raw.bank_name),
    occurredAt: buildOccurredAt(cleanString(raw.date), cleanString(raw.time)),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    notes: cleanString(raw.notes),
    raw,
  };
}

export async function analyzeReceipt({ imageBuffer, mimeType }) {
  if (!config.anthropic.apiKey) throw new Error('ANTHROPIC_API_KEY غير مهيأ');

  const mediaType = normalizeMediaType(mimeType);
  if (!mediaType) throw new Error('صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WEBP');
  if (imageBuffer.length > config.anthropic.maxImageBytes) throw new Error('حجم الصورة كبير جداً');

  const body = {
    model: config.anthropic.model,
    max_tokens: 1500,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  };

  const res = await fetch(`${config.anthropic.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.error('Anthropic API error', res.status, text.slice(0, 500));
    throw new Error(`فشل تحليل الإيصال (رمز ${res.status})`);
  }

  const json = await res.json();
  const toolUse = (json.content || []).find((c) => c.type === 'tool_use');
  if (!toolUse || !toolUse.input) throw new Error('لم يتمكن النظام من استخراج بيانات الإيصال');

  return normalizeParsed(toolUse.input);
}