// poll-san/utils/xputils.js

require('dotenv').config({ quiet: true });
const { weights, releaseEmojis } = require('./helpers');

const XP_MIN_CHARS = 5;

// Thresholds: Level 2 = 50, Level 3 = 100, etc.
const LEVEL_THRESHOLDS = Array.from({ length: 26 }, (_, index) =>
  index <= 1 ? 0 : (index - 1) * 50
);

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '') || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

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
      const url = `${SUPABASE_URL}/rest/v1/user_xp?user_id=eq.${message.author.id}&guild_id=eq.${message.guild.id}`;

      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      });

      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      
      const rows = await res.json();
      const current = rows[0] || { total_messages: 0, level: 0 };

      const total = current.total_messages + 1;
      const oldLevel = current.level;
      const newLevel = this.getLevel(total);

      await fetch(`${SUPABASE_URL}/rest/v1/user_xp`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          user_id: message.author.id,
          guild_id: message.guild.id,
          total_messages: total,
          level: newLevel,
          discord_username: message.author.username
        })
      });

      // Level-up notification completely removed.
      // The user will see their new level only when they use /level.

    } catch (err) {
      console.error('[XP Update Error]', err.message);
    }
  },

  async getUserStats(userId, guildId) {
    try {
      const url = `${SUPABASE_URL}/rest/v1/user_xp?user_id=eq.${userId}&guild_id=eq.${guildId}`;
      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      });
      const rows = await res.json();
      const data = rows[0] || { level: 0, total_messages: 0 };

      return {
        level: data.level ?? 0,
        messages: data.total_messages ?? 0,
        bonus: (data.level * weights.xpFactor).toFixed(2)
      };
    } catch (err) {
      return { level: 0, messages: 0, bonus: '0.00' };
    }
  }
};

module.exports = XPLib;
