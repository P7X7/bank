import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { commandData } from './commands.js';
import { logger } from '../utils/logger.js';

export async function registerCommands() {
  if (!config.discord.token || !config.discord.clientId) {
    logger.warn('تسجيل الأوامر متجاهل: DISCORD_TOKEN أو DISCORD_CLIENT_ID غير مهيأ');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.discord.token);

  if (config.discord.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), {
      body: commandData,
    });
    logger.info(`تم تسجيل ${commandData.length} أمراً في السيرفر ${config.discord.guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commandData });
    logger.info(`تم تسجيل ${commandData.length} أمراً على المستوى العام (Guild + User Install)`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('registerCommands.js')) {
  registerCommands()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('فشل تسجيل الأوامر', err);
      process.exit(1);
    });
}