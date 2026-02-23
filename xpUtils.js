require('dotenv').config();

// Force fetch support for Node <18
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

console.log('=== XP UTILS ENV DEBUG ===');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL || 'MISSING');
console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? 'present (hidden)' : 'MISSING');
console.log('==========================');

const XP_MIN_CHARS = 5;
const LEVEL_MULTIPLIER_PER_LEVEL = 0.02;

const LEVEL_THRESHOLDS = Array.from({ length: 26 }, (_, index) =>
  index <= 1 ? 0 : (index - 1) * 50
);

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '') || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Supabase environment variables missing.');
}

const XPLib = {
  getLevel(messages) {
    for (let i = LEVEL_THRESHOLDS.length - 1; i > 0; i--) {
      if (messages >= LEVEL_THRESHOLDS[i]) return i;
    }
    return 0;
  },

  async updateXP(message) {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.content.length < XP_MIN_CHARS) return;

    try {
      const url = `${SUPABASE_URL}/rest/v1/user_xp?user_id=eq.${message.author.id}&guild_id=eq.${message.guild.id}`;

      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Fetch failed: ${res.status} - ${text}`);
      }

      const rows = await res.json();
      const current = rows[0] || { total_messages: 0, level: 0 };

      const total = current.total_messages + 1;
      const oldLevel = current.level;
      const newLevel = this.getLevel(total);

      const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_xp`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          user_id: message.author.id,
          guild_id: message.guild.id,
          total_messages: total,
          level: newLevel,
          discord_username: message.author.username
        })
      });

      if (!upsertRes.ok) {
        const text = await upsertRes.text();
        throw new Error(`Upsert failed: ${upsertRes.status} - ${text}`);
      }

      if (newLevel > oldLevel) {
        const totalBonus = (newLevel * LEVEL_MULTIPLIER_PER_LEVEL).toFixed(2);

        message.author.send(
          `✨ **Level Up!**\n\nYou reached **Level ${newLevel}**!\nYour vote bonus is now **+${totalBonus}**.\n\nType **/level** anytime to check progress.`
        ).catch(() => {});
      }

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

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Fetch failed: ${res.status} - ${text}`);
      }

      const rows = await res.json();
      const data = rows[0] || { level: 0, total_messages: 0 };

      return {
        level: data.level ?? 0,
        messages: data.total_messages ?? 0,
        bonus: (data.level * LEVEL_MULTIPLIER_PER_LEVEL).toFixed(2)
      };

    } catch (err) {
      console.error('[XP Stats Error]', err.message);
      return { level: 0, messages: 0, bonus: '0.00' };
    }
  }
};

module.exports = XPLib;
