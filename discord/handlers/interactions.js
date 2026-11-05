import { MessageFlags, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { config } from '../../config.js';
import { isDiscordAdmin, isDiscordStaff } from '../permissions.js';
import { handleReceiptUpload, isImageAttachment } from '../receiptFlow.js';
import { resultEmbed, resultButtons, criteriaEmbed } from '../ui.js';
import { getReceipt, applyReview, listPendingReviews } from '../../services/receipts.js';
import { createTransfer, listTransfers } from '../../services/transfers.js';
import { getAllSettings } from '../../services/settings.js';
import { db } from '../../db/index.js';
import { formatMoney } from '../../utils/money.js';
import { logger } from '../../utils/logger.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

async function deny(interaction, text = 'ليست لديك صلاحية لتنفيذ هذا الأمر.') {
  const payload = { content: text, ...EPHEMERAL };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

async function handleVerify(interaction) {
  if (!config.anthropic.apiKey) return deny(interaction, 'خدمة قراءة الإيصالات غير مهيأة حالياً. راجع إعدادات النظام.');
  const attachment = interaction.options.getAttachment('receipt', true);
  if (!isImageAttachment(attachment)) return deny(interaction, 'المرفق ليس صورة صالحة. أرسل صورة JPG أو PNG أو WEBP.');

  await interaction.deferReply(EPHEMERAL);

  try {
    const result = await handleReceiptUpload({
      client: interaction.client,
      attachment,
      user: interaction.user,
      channelId: interaction.channelId,
      messageId: interaction.id,
    });

    const embed = resultEmbed(result);
    const components = result.receipt?.id ? [resultButtons(result.receipt.id)] : [];
    await interaction.editReply({ embeds: [embed], components });
  } catch (err) {
    logger.error('verify command failed', err);
    await interaction.editReply({ content: `تعذر معالجة الإيصال: ${err.message}` });
  }
}

async function handleStatus(interaction) {
  await interaction.deferReply(EPHEMERAL);
  const operation = interaction.options.getString('operation', true).trim();
  const norm = operation.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const transfer = db
    .prepare('SELECT * FROM transfers WHERE operation_number_norm = ?')
    .get(norm);

  const receipt = db
    .prepare('SELECT * FROM receipts WHERE operation_number_norm = ? ORDER BY id DESC LIMIT 1')
    .get(norm);

  if (!transfer && !receipt) {
    return interaction.editReply({ content: 'لا توجد حوالة أو إيصال بهذا الرقم.' });
  }

  const embed = new EmbedBuilder().setTitle('حالة العملية').setColor(0x3b82f6).setTimestamp(new Date());

  if (transfer) {
    const statusLabel = transfer.status === 'linked' ? 'مرتبطة بإيصال ✅' : 'متاحة — بانتظار إيصال ⏳';
    embed.addFields({
      name: 'الحوالة',
      value: `#${transfer.id}\nالمبلغ: ${formatMoney(transfer.amount, transfer.currency)}\nالحالة: ${statusLabel}`,
    });
  }

  if (receipt) {
    const labels = { accepted: 'مقبول ✅', rejected: 'مرفوض ❌', review: 'قيد المراجعة ⚠️', processing: 'قيد المعالجة ⏳', error: 'خطأ ⚙️' };
    embed.addFields({
      name: 'الإيصال',
      value: `#${receipt.id}\nالمبلغ: ${formatMoney(receipt.amount, receipt.currency || 'SAR')}\nالحالة: ${labels[receipt.status] || receipt.status}`,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleTransfer(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'add') {
    if (!isDiscordAdmin(interaction)) return deny(interaction, 'إضافة الحوالات تتطلب صلاحية مسؤول.');
    await interaction.deferReply(EPHEMERAL);

    const amount = interaction.options.getNumber('amount', true);
    const currency = interaction.options.getString('currency', true);
    const sender = interaction.options.getString('sender', true);
    const operation = interaction.options.getString('operation');
    const date = interaction.options.getString('date');
    const beneficiary = interaction.options.getString('beneficiary');

    let occurredAt = null;
    if (date) {
      const parsed = new Date(`${date}T00:00:00+03:00`);
      if (Number.isNaN(parsed.getTime())) {
        return interaction.editReply({ content: 'صيغة التاريخ غير صحيحة. استخدم YYYY-MM-DD' });
      }
      occurredAt = parsed.toISOString();
    }

    try {
      const { transfer, duplicate } = createTransfer({
        amount,
        currency,
        senderName: sender,
        beneficiaryName: beneficiary,
        operationNumber: operation,
        occurredAt,
      });

      const embed = new EmbedBuilder()
        .setTitle(duplicate ? 'الحوالة موجودة مسبقاً' : 'تمت إضافة الحوالة')
        .setColor(duplicate ? 0xf59e0b : 0x22c55e)
        .addFields(
          { name: 'رقم الحوالة', value: `#${transfer.id}`, inline: true },
          { name: 'المبلغ', value: formatMoney(transfer.amount, transfer.currency), inline: true },
          { name: 'بالريال', value: formatMoney(transfer.amount_sar, 'SAR'), inline: true },
          { name: 'المرسل', value: transfer.sender_name || '—', inline: true },
          { name: 'المستفيد', value: transfer.beneficiary_name || '—', inline: true },
          { name: 'رقم العملية', value: transfer.operation_number || '—', inline: true },
        )
        .setTimestamp(new Date());

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ content: `تعذر إضافة الحوالة: ${err.message}` });
    }
    return;
  }

  if (sub === 'list') {
    if (!isDiscordStaff(interaction)) return deny(interaction);
    await interaction.deferReply(EPHEMERAL);
    const { items } = listTransfers({ page: 1, limit: 10 });
    if (!items.length) return interaction.editReply({ content: 'لا توجد حوالات مسجلة.' });

    const labels = { available: 'متاحة', linked: 'مرتبطة', flagged: 'معلّمة' };
    const lines = items.map(
      (t) =>
        `#${t.id} — ${formatMoney(t.amount, t.currency)} — ${labels[t.status]} — ${t.sender_name || 'بدون اسم'} — ${t.operation_number || 'بدون رقم عملية'}`,
    );

    const embed = new EmbedBuilder()
      .setTitle('آخر الحوالات')
      .setDescription(lines.join('\n').slice(0, 4000))
      .setColor(0x3b82f6)
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [embed] });
  }
}

async function handleReview(interaction) {
  if (!isDiscordStaff(interaction)) return deny(interaction);
  await interaction.deferReply(EPHEMERAL);

  const pending = listPendingReviews(25);
  if (!pending.length) return interaction.editReply({ content: 'لا توجد إيصالات بحاجة إلى مراجعة حالياً.' });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('review:select')
    .setPlaceholder('اختر إيصالاً لعرض تفاصيله')
    .addOptions(
      pending.map((r) => ({
        label: `#${r.id} — ${formatMoney(r.amount, r.currency || 'SAR')}`.slice(0, 100),
        description: String(r.reason || 'يحتاج مراجعة').slice(0, 100),
        value: String(r.id),
      })),
    );

  const embed = new EmbedBuilder()
    .setTitle('الإيصالات التي تحتاج مراجعة')
    .setDescription(`عدد الإيصالات المعلقة: **${pending.length}**`)
    .setColor(0xf59e0b)
    .setTimestamp(new Date());

  await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
}

async function handleSettings(interaction) {
  await interaction.deferReply(EPHEMERAL);
  const s = getAllSettings();
  const embed = new EmbedBuilder()
    .setTitle('إعدادات النظام')
    .setColor(0x3b82f6)
    .addFields(
      { name: 'سعر صرف الدولار', value: `${Number(s.usd_rate || 3.75).toFixed(2)} ريال`, inline: true },
      { name: 'نافذة المطابقة الزمنية', value: `${s.match_time_window_hours || 48} ساعة`, inline: true },
      { name: 'حد تشابه الأسماء', value: `${Math.round(Number(s.match_name_min_similarity || 0.6) * 100)}%`, inline: true },
      { name: 'سماحية المبلغ', value: `${s.match_amount_tolerance_sar || 0.01} ريال`, inline: true },
      { name: 'قراءة الإيصالات', value: config.anthropic.apiKey ? 'مهيأة ✅' : 'غير مهيأة ❌', inline: true },
      { name: 'قناة المراجعة', value: config.discord.reviewChannelId ? 'مهيأة ✅' : 'غير مهيأة ❌', inline: true },
    )
    .setFooter({ text: 'لتعديل القيم استخدم لوحة التحكم' })
    .setTimestamp(new Date());
  await interaction.editReply({ embeds: [embed] });
}

async function handleStaff(interaction) {
  if (!isDiscordAdmin(interaction)) return deny(interaction);
  await interaction.deferReply(EPHEMERAL);
  const items = db
    .prepare('SELECT id, username, role, active, last_login_at FROM staff ORDER BY id ASC')
    .all();
  if (!items.length) return interaction.editReply({ content: 'لا يوجد موظفون مسجلون.' });

  const lines = items.map(
    (s) => `#${s.id} — ${s.username} — ${s.role === 'admin' ? 'مدير' : 'موظف'} — ${s.active ? 'نشط' : 'معطّل'}`,
  );
  const embed = new EmbedBuilder()
    .setTitle('موظفو لوحة التحكم')
    .setDescription(lines.join('\n').slice(0, 4000))
    .setColor(0x3b82f6)
    .setTimestamp(new Date());
  await interaction.editReply({ embeds: [embed] });
}

async function handleHelp(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('دليل الاستخدام')
    .setColor(0x3b82f6)
    .setDescription('نظام التحقق من الحوالات والإيصالات المالية')
    .addFields(
      { name: '/verify', value: 'أرسل صورة إيصال للتحقق من مطابقتها مع حوالة مسجلة.' },
      { name: '/status', value: 'استعلم عن حالة حوالة أو إيصال برقم العملية.' },
      { name: '/transfer add | list', value: 'إضافة حوالة جديدة أو عرض آخر الحوالات (للمسؤولين).' },
      { name: '/review list', value: 'عرض الإيصالات التي تحتاج إلى مراجعة إدارية.' },
      { name: '/settings', value: 'عرض إعدادات النظام الحالية.' },
      { name: '/staff', value: 'عرض موظفي لوحة التحكم (للمسؤولين).' },
      { name: 'ملاحظة', value: 'يمكنك أيضاً إرسال صورة الإيصال مباشرة في قناة الإيصالات المخصصة أو في الرسائل الخاصة.' },
    )
    .setTimestamp(new Date());
  await interaction.reply({ embeds: [embed], ...EPHEMERAL });
}

async function handleButton(interaction) {
  const [scope, action, idRaw] = interaction.customId.split(':');
  const id = Number(idRaw);

  if (scope === 'receipt' && action === 'details') {
    const receipt = getReceipt(id);
    if (!receipt) return interaction.reply({ content: 'الإيصال غير موجود.', ...EPHEMERAL });
    return interaction.reply({ embeds: [criteriaEmbed(receipt)], ...EPHEMERAL });
  }

  if (scope === 'review' && (action === 'accept' || action === 'reject')) {
    if (!isDiscordStaff(interaction)) return deny(interaction);
    const decision = action === 'accept' ? 'accepted' : 'rejected';
    try {
      const updated = applyReview(id, decision, {
        type: 'discord',
        id: interaction.user.id,
        name: interaction.user.username,
      });
      const embed = criteriaEmbed(updated)
        .setTitle(`تم ${decision === 'accepted' ? 'قبول' : 'رفض'} الإيصال #${updated.id}`)
        .setColor(decision === 'accepted' ? 0x22c55e : 0xef4444);
      return interaction.update({ embeds: [embed], components: [] });
    } catch (err) {
      return interaction.reply({ content: `تعذر تنفيذ القرار: ${err.message}`, ...EPHEMERAL });
    }
  }

  return interaction.reply({ content: 'إجراء غير معروف.', ...EPHEMERAL });
}

async function handleSelect(interaction) {
  if (interaction.customId !== 'review:select') {
    return interaction.reply({ content: 'قائمة غير معروفة.', ...EPHEMERAL });
  }
  if (!isDiscordStaff(interaction)) return deny(interaction);

  const receipt = getReceipt(interaction.values[0]);
  if (!receipt) return interaction.reply({ content: 'الإيصال غير موجود.', ...EPHEMERAL });

  const { reviewEmbed, reviewButtons } = await import('../ui.js');
  return interaction.reply({
    embeds: [reviewEmbed(receipt), criteriaEmbed(receipt)],
    components: receipt.status === 'review' ? [reviewButtons(receipt.id)] : [],
    ...EPHEMERAL,
  });
}

export async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'verify':
          return await handleVerify(interaction);
        case 'status':
          return await handleStatus(interaction);
        case 'transfer':
          return await handleTransfer(interaction);
        case 'review':
          return await handleReview(interaction);
        case 'settings':
          return await handleSettings(interaction);
        case 'staff':
          return await handleStaff(interaction);
        case 'help':
          return await handleHelp(interaction);
        default:
          return await interaction.reply({ content: 'أمر غير معروف.', ...EPHEMERAL });
      }
    }
    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isStringSelectMenu()) return await handleSelect(interaction);
  } catch (err) {
    logger.error('خطأ في معالجة تفاعل Discord', err);
    const payload = { content: 'حدث خطأ غير متوقع أثناء تنفيذ العملية.', ...EPHEMERAL };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch {
      /* ignore */
    }
  }
}