import {
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
} from 'discord.js';

const base = (builder) =>
  builder
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ]);

export const commandData = [
  base(
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('إرسال صورة إيصال التحقق من مطابقتها مع حوالة')
      .addAttachmentOption((o) => o.setName('receipt').setDescription('صورة الإيصال').setRequired(true)),
  ),
  base(
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('الاستعلام عن حالة حوالة أو إيصال')
      .addStringOption((o) => o.setName('operation').setDescription('رقم العملية').setRequired(true)),
  ),
  base(
    new SlashCommandBuilder()
      .setName('transfer')
      .setDescription('إدارة الحوالات')
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('إضافة حوالة جديدة (للمسؤولين)')
          .addNumberOption((o) => o.setName('amount').setDescription('مبلغ الحوالة').setRequired(true))
          .addStringOption((o) =>
            o
              .setName('currency')
              .setDescription('العملة')
              .setRequired(true)
              .addChoices({ name: 'ريال سعودي SAR', value: 'SAR' }, { name: 'دولار أمريكي USD', value: 'USD' }),
          )
          .addStringOption((o) => o.setName('sender').setDescription('اسم المرسل').setRequired(true))
          .addStringOption((o) => o.setName('operation').setDescription('رقم العملية').setRequired(false))
          .addStringOption((o) => o.setName('date').setDescription('التاريخ YYYY-MM-DD').setRequired(false))
          .addStringOption((o) => o.setName('beneficiary').setDescription('اسم المستفيد').setRequired(false)),
      )
      .addSubcommand((s) => s.setName('list').setDescription('عرض آخر الحوالات')),
  ),
  base(
    new SlashCommandBuilder()
      .setName('review')
      .setDescription('مراجعة الإيصالات المعلقة')
      .addSubcommand((s) => s.setName('list').setDescription('عرض الإيصالات التي تحتاج مراجعة')),
  ),
  base(new SlashCommandBuilder().setName('settings').setDescription('عرض إعدادات النظام الحالية')),
  base(new SlashCommandBuilder().setName('staff').setDescription('قائمة موظفي لوحة التحكم')),
  base(new SlashCommandBuilder().setName('help').setDescription('المساعدة وقائمة الأوامر')),
].map((c) => c.toJSON());