import { config } from '../../config.js';
import { handleReceiptUpload, isImageAttachment } from '../receiptFlow.js';
import { resultEmbed, resultButtons } from '../ui.js';
import { logger } from '../../utils/logger.js';

export async function handleMessage(message) {
  if (message.author?.bot) return;
  if (!message.attachments?.size) return;

  const isDm = !message.guild;
  const isReceiptChannel = config.discord.receiptsChannelId && message.channelId === config.discord.receiptsChannelId;
  if (!isDm && !isReceiptChannel) return;

  const attachment = message.attachments.find((a) => isImageAttachment(a));
  if (!attachment) return;

  if (!config.anthropic.apiKey) {
    await message.reply('خدمة قراءة الإيصالات غير مهيأة حالياً.').catch(() => null);
    return;
  }

  try {
    const result = await handleReceiptUpload({
      client: message.client,
      attachment,
      user: message.author,
      channelId: message.channelId,
      messageId: message.id,
    });

    await message.reply({
      embeds: [resultEmbed(result)],
      components: result.receipt?.id ? [resultButtons(result.receipt.id)] : [],
    });
  } catch (err) {
    logger.error('فشل معالجة إيصال من الرسائل', err);
    await message.reply(`تعذر معالجة الإيصال: ${err.message}`).catch(() => null);
  }
}