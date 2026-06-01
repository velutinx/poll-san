// poll-san/utils/xputils.js

require('dotenv').config({ quiet: true });
const { MessageFlags } = require('discord.js');
const { weights, releaseEmojis } = require('./helpers');
const h = require('./helpers');
const db = require('../services/database');   // D1 client

const XP_MIN_CHARS = 5;

const LEVEL_THRESHOLDS = Array.from({ length: 26 }, (_, index) =>
  index <= 1 ? 0 : (index - 1) * 50
);

const XP_CHANNEL_ID = h.ids.channels.xp_channel;

const XPLib = {
  getLevel(messages) {
    for (let i = LEVEL_THRESHOLDS.length - 1; i > 0; i--) {
      if (messages >= LEVEL_THRESHOLDS[i]) return i;
    }
    return 0;
  },

  async updateXP(message) {
    if (message.author.bot || !message.guild || message.content.length < XP_MIN_CHARS) return;

    try {
      // Fetch current XP row
      const current = await db.query(
        `SELECT total_messages, level FROM ${h.tables.USER_XP} WHERE user_id = ? AND guild_id = ?`,
        [message.author.id, message.guild.id],
        true
      );

      const total = (current?.total_messages ?? 0) + 1;
      const oldLevel = current?.level ?? 0;
      const newLevel = this.getLevel(total);

      // Upsert the XP data
      await db.query(
        `INSERT INTO ${h.tables.USER_XP} (user_id, guild_id, total_messages, level, discord_username)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, guild_id) DO UPDATE SET
           total_messages = excluded.total_messages,
           level = excluded.level,
           discord_username = excluded.discord_username`,
        [message.author.id, message.guild.id, total, newLevel, message.author.username]
      );

      // Level‑up notification via webhook
      if (newLevel > oldLevel) {
        const totalBonus = (newLevel * weights.xpFactor).toFixed(2);
        const s = releaseEmojis.SPARKLES;

        const xpChannel = message.guild.channels.cache.get(XP_CHANNEL_ID);
        if (!xpChannel) return;

        try {
          const hooks = await xpChannel.fetchWebhooks();
          let levelingWebhook = hooks.find(w => w.name === 'Leveling');
          if (!levelingWebhook) {
            levelingWebhook = await xpChannel.createWebhook({
              name: 'Leveling',
              avatar: h.urls.LOGO_URL
            });
          }

          await levelingWebhook.send({
            content: `<@${message.author.id}> ${s} **Level Up!** ${s}\n` +
                     `You reached **Level ${newLevel}**!\n` +
                     `Your vote bonus is now **+${totalBonus}**.`,
            allowedMentions: { users: [message.author.id] },
            username: 'Leveling',
            avatarURL: h.urls.LOGO_URL,
            flags: [MessageFlags.SuppressNotifications]
          });
        } catch (webhookErr) {
          console.error('Level‑up webhook error:', webhookErr);
        }
      }
    } catch (err) {
      console.error('[XP Update Error]', err.message);
    }
  },

  async getUserStats(userId, guildId) {
    try {
      const row = await db.query(
        `SELECT level, total_messages FROM ${h.tables.USER_XP} WHERE user_id = ? AND guild_id = ?`,
        [userId, guildId],
        true
      );

      const level = row?.level ?? 0;
      const messages = row?.total_messages ?? 0;

      return {
        level,
        messages,
        bonus: (level * weights.xpFactor).toFixed(2)
      };
    } catch (err) {
      console.error('[XP Get Stats Error]', err.message);
      return { level: 0, messages: 0, bonus: '0.00' };
    }
  }
};

module.exports = XPLib;
