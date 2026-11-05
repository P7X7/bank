import { db } from '../db/index.js';
import { config } from '../config.js';
import { processReceipt } from '../services/receipts.js';
import { reviewEmbed, reviewButtons } from './ui.js';
import { logger } from '../utils/logger.js';

export async function downloadAttachment(attachment) {
  const res = await fetch(attachment.url, {
    headers: { 'user-agent': 'bank-verification/1.0 (+discord-bot)' },
  });
  if (!res.ok) throw new Error(`تعذر تحميل الصورة (${res.status})`);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > config.anthropic.maxImageBytes) throw new Error('حجم الصورة أكبر من الحد المسموح');
  return buffer;
}

export async function handleReceiptUpload({ client, attachment, user, channelId, messageId, imageUrl }) {
  const buffer = await downloadAttachment(attachment);
  const result = await processReceipt({
    imageBuffer: buffer,
    mimeType: attachment.contentType || 'image/jpeg',
    imageUrl: imageUrl || attachment.url,
    user,
    channelId,
    messageId,
  });

  if (result.outcome === 'review' && result.receipt?.id && config.discord.reviewChannelId) {
    try {
      const channel = await client.channels.fetch(config.discord.reviewChannelId);
      if (channel?.isTextBased()) {
        const message = await channel.send({
          embeds: [reviewEmbed(result.receipt)],
          components: [reviewButtons(result.receipt.id)],
        });
        db.prepare('UPDATE receipts SET review_message_id = ? WHERE id = ?').run(message.id, result.receipt.id);
      }
    } catch (err) {
      logger.error('فشل إرسال الإيصال إلى قناة المراجعة', err);
    }
  }

  return result;
}

export function isImageAttachment(attachment) {
  const type = String(attachment.contentType || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(String(attachment.name || attachment.url || ''));
}