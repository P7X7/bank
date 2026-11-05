import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { formatMoney } from '../utils/money.js';

const STATUS_META = {
  accepted: { label: 'مقبول ✅', color: 0x22c55e },
  rejected: { label: 'مرفوض ❌', color: 0xef4444 },
  review: { label: 'يحتاج مراجعة إدارية ⚠️', color: 0xf59e0b },
  duplicate: { label: 'إيصال مكرر 🚫', color: 0xef4444 },
  error: { label: 'تعذر المعالجة ⚙️', color: 0x64748b },
};

const CRITERIA_ICON = { match: '✅', mismatch: '❌', unknown: '⚠️' };

function fieldSafe(value, max = 1024) {
  const s = value === null || value === undefined || value === '' ? '—' : String(value);
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

export function resultEmbed(result) {
  const meta = STATUS_META[result.outcome] || STATUS_META.error;
  const receipt = result.receipt || {};
  const transfer = result.transfer || {};

  const embed = new EmbedBuilder()
    .setTitle(`نتيجة التحقق — ${meta.label}`)
    .setColor(meta.color)
    .setDescription(fieldSafe(result.message || '', 2000))
    .addFields(
      {
        name: 'مبلغ الإيصال',
        value: fieldSafe(receipt.amount != null ? formatMoney(receipt.amount, receipt.currency) : '—'),
        inline: true,
      },
      {
        name: 'المبلغ بالريال',
        value: fieldSafe(receipt.amount_sar != null ? formatMoney(receipt.amount_sar, 'SAR') : '—'),
        inline: true,
      },
      { name: 'رقم العملية', value: fieldSafe(receipt.operation_number), inline: true },
      { name: 'اسم المرسل', value: fieldSafe(receipt.sender_name), inline: true },
      { name: 'اسم المستفيد', value: fieldSafe(receipt.beneficiary_name), inline: true },
      {
        name: 'الحوالة المطابقة',
        value: transfer.id ? `#${transfer.id} — ${formatMoney(transfer.amount, transfer.currency)}` : '—',
        inline: true,
      },
    )
    .setFooter({ text: `رقم الإيصال: ${receipt.id ?? '—'}` })
    .setTimestamp(new Date());

  if (result.evaluation?.score != null) {
    embed.addFields({ name: 'درجة التطابق', value: `${Math.round(result.evaluation.score * 100)}%`, inline: true });
  }

  return embed;
}

export function resultButtons(receiptId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`receipt:details:${receiptId}`)
      .setLabel('تفاصيل المطابقة')
      .setStyle(ButtonStyle.Secondary),
  );
}

export function reviewEmbed(receipt) {
  return new EmbedBuilder()
    .setTitle('إيصال يحتاج مراجعة إدارية')
    .setColor(0xf59e0b)
    .addFields(
      { name: 'رقم الإيصال', value: String(receipt.id), inline: true },
      { name: 'المبلغ', value: formatMoney(receipt.amount, receipt.currency), inline: true },
      { name: 'المبلغ بالريال', value: formatMoney(receipt.amount_sar, 'SAR'), inline: true },
      { name: 'المرسل', value: fieldSafe(receipt.sender_name), inline: true },
      { name: 'المستفيد', value: fieldSafe(receipt.beneficiary_name), inline: true },
      { name: 'رقم العملية', value: fieldSafe(receipt.operation_number), inline: true },
      { name: 'المستخدم', value: fieldSafe(receipt.discord_user_name || receipt.discord_user_id), inline: true },
      { name: 'سبب المراجعة', value: fieldSafe(receipt.reason || '—'), inline: false },
    )
    .setFooter({ text: `درجة التطابق: ${Math.round((receipt.score || 0) * 100)}%` })
    .setTimestamp(new Date());
}

export function reviewButtons(receiptId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`review:accept:${receiptId}`)
      .setLabel('قبول')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`review:reject:${receiptId}`)
      .setLabel('رفض')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`receipt:details:${receiptId}`)
      .setLabel('تفاصيل المطابقة')
      .setStyle(ButtonStyle.Secondary),
  );
}

export function criteriaEmbed(receipt) {
  let parsed = null;
  try {
    parsed = receipt.criteria_json ? JSON.parse(receipt.criteria_json) : null;
  } catch {
    parsed = null;
  }

  const embed = new EmbedBuilder()
    .setTitle(`تفاصيل مطابقة الإيصال #${receipt.id}`)
    .setColor(0x3b82f6)
    .setTimestamp(new Date());

  if (!parsed || !parsed.criteria) {
    embed.setDescription('لا تتوفر تفاصيل مطابقة لهذا الإيصال.');
    return embed;
  }

  const lines = parsed.criteria.map(
    (c) => `${CRITERIA_ICON[c.status] || '•'} **${c.label}** — ${c.detail} (وزن ${Math.round(c.weight * 100)}%)`,
  );
  embed.addFields({ name: 'المعايير', value: fieldSafe(lines.join('\n')) });

  if (parsed.reasons?.length) {
    embed.addFields({ name: 'الملاحظات', value: fieldSafe(parsed.reasons.map((r) => `• ${r}`).join('\n')) });
  }

  embed.addFields(
    { name: 'درجة التطابق', value: `${Math.round((receipt.score || 0) * 100)}%`, inline: true },
    { name: 'ثقة القراءة', value: `${Math.round((parsed.confidence || 0) * 100)}%`, inline: true },
  );

  return embed;
}