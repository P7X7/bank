import { PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';

function memberRoleIds(member) {
  if (!member) return [];
  const cache = member.roles?.cache;
  if (cache && typeof cache.keys === 'function') return [...cache.keys()];
  if (Array.isArray(member.roles)) return member.roles;
  return [];
}

export function isDiscordAdmin(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (interaction.guild && interaction.guild.ownerId === interaction.user.id) return true;
  const roles = memberRoleIds(interaction.member);
  return roles.some((r) => config.discord.adminRoleIds.includes(r));
}

export function isDiscordStaff(interaction) {
  if (isDiscordAdmin(interaction)) return true;
  const roles = memberRoleIds(interaction.member);
  return roles.some((r) => config.discord.staffRoleIds.includes(r));
}