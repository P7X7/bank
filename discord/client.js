import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { handleInteraction } from './handlers/interactions.js';
import { handleMessage } from './handlers/messages.js';
import { registerCommands } from './registerCommands.js';

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  logger.info(`تم تسجيل دخول البوت: ${c.user.tag} — في ${c.guilds.cache.size} سيرفر`);
});

client.on(Events.InteractionCreate, handleInteraction);
client.on(Events.MessageCreate, (message) => {
  handleMessage(message).catch((err) => logger.error('messageCreate handler', err));
});
client.on(Events.Error, (err) => logger.error('Discord client error', err));

export async function startDiscord() {
  if (!config.discord.token || !config.discord.clientId) {
    logger.warn('بوت Discord معطّل: DISCORD_TOKEN أو DISCORD_CLIENT_ID غير مهيأ.');
    return null;
  }

  if (config.discord.autoRegisterCommands) {
    try {
      await registerCommands();
    } catch (err) {
      logger.error('فشل تسجيل أوامر Discord', err);
    }
  }

  await client.login(config.discord.token);
  return client;
}