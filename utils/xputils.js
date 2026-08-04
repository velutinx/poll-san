// utils/xputils.js
const { MessageFlags } = require('discord.js');
const { weights, releaseEmojis } = require('./helpers');
const h = require('./helpers');
const db = require('../services/database');

const XP_MIN_CHARS = 5;

const LEVEL_THRESHOLDS = Array.from({ length: 26 }, (_, index) =>
  index <= 1 ? 0 : (index - 1) * 50
);

const XP_CHANNEL_ID = h.ids.channels.xp_channel;

// ─── In‑memory cache ──────────────────────────────────────────────
const xpCache = new Map(); // key: `${userId}:${guildId}` -> { total_messages, level }
const pendingUpdates = new Map(); // key: `${userId}:${guildId}` -> increment count
let flushTimer = null;
const FLUSH_INTERVAL_MS = 10000; // 10 seconds
const BATCH_THRESHOLD = 5; // flush after 5 messages from same user

// ─── Helper: get level from messages ─────────────────────────────
function getLevel(messages) {
  for (let i = LEVEL_THRESHOLDS.length - 1; i > 0; i--) {
    if (messages >= LEVEL_THRESHOLDS[i]) return i;
  }
  return 0;
}

// ─── Schedule a flush ─────────────────────────────────────────────
function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushUpdates();
  }, FLUSH_INTERVAL_MS);
}

// ─── Flush pending updates to D1 ──────────────────────────────────
async function flushUpdates() {
  if (pendingUpdates.size === 0) return;

  const updates = Array.from(pendingUpdates.entries());
  pendingUpdates.clear();

  for (const [key, increment] of updates) {
    const [userId, guildId] = key.split(':');

    // Get current from cache (or D1 if missing)
    let current = xpCache.get(key);
    if (!current) {
      try {
        const row = await db.query(
          `SELECT total_messages, level FROM ${h.tables.USER_XP} WHERE user_id = ? AND guild_id = ?`,
          [userId, guildId],
          true
        );
        current = row ? { total_messages: row.total_messages, level: row.level } : { total_messages: 0, level: 0 };
      } catch (_) {
        current = { total_messages: 0, level: 0 };
      }
      xpCache.set(key, current);
    }

    const newTotal = current.total_messages + increment;
    const newLevel = getLevel(newTotal);
    const oldLevel = current.level;

    // Update D1
    try {
      await db.query(
        `INSERT INTO ${h.tables.USER_XP} (user_id, guild_id, total_messages, level, discord_username)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, guild_id) DO UPDATE SET
           total_messages = excluded.total_messages,
           level = excluded.level,
           discord_username = excluded.discord_username`,
        [userId, guildId, newTotal, newLevel, ''] // username updated separately
      );
    } catch (err) {
      console.error('[XP Flush Error]', err.message);
      continue;
    }

    // Update cache
    const newData = { total_messages: newTotal, level: newLevel };
    xpCache.set(key, newData);

    // Level-up notification
    if (newLevel > oldLevel) {
      // We'll emit an event that the main bot can listen to
      if (global._xpLevelUpCallbacks) {
        for (const cb of global._xpLevelUpCallbacks) {
          try {
            cb({ userId, guildId, oldLevel, newLevel, newTotal });
          } catch (e) {}
        }
      }
    }
  }
}

// ─── Force flush (exposed for periodic safety) ────────────────────
async function forceFlush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushUpdates();
}

// ─── Register level‑up callback ──────────────────────────────────
function onLevelUp(callback) {
  if (!global._xpLevelUpCallbacks) global._xpLevelUpCallbacks = [];
  global._xpLevelUpCallbacks.push(callback);
}

// ─── Public API ──────────────────────────────────────────────────
const XPLib = {
  // ─── Update XP (called on every message) ──────────────────────
  async updateXP(message) {
    if (message.author.bot || !message.guild || message.content.length < XP_MIN_CHARS) return;

    const userId = message.author.id;
    const guildId = message.guild.id;
    const key = `${userId}:${guildId}`;

    // Increment pending counter
    if (!pendingUpdates.has(key)) {
      pendingUpdates.set(key, 0);
    }
    pendingUpdates.set(key, pendingUpdates.get(key) + 1);

    // If threshold reached, flush immediately
    if (pendingUpdates.get(key) >= BATCH_THRESHOLD) {
      await forceFlush();
    } else {
      scheduleFlush();
    }
  },

  // ─── Get user stats (level, messages, bonus) ──────────────────
  async getUserStats(userId, guildId) {
    const key = `${userId}:${guildId}`;
    let data = xpCache.get(key);
    if (!data) {
      try {
        const row = await db.query(
          `SELECT level, total_messages FROM ${h.tables.USER_XP} WHERE user_id = ? AND guild_id = ?`,
          [userId, guildId],
          true
        );
        data = row ? { total_messages: row.total_messages, level: row.level } : { total_messages: 0, level: 0 };
        xpCache.set(key, data);
      } catch (_) {
        data = { total_messages: 0, level: 0 };
      }
    }

    return {
      level: data.level || 0,
      messages: data.total_messages || 0,
      bonus: ((data.level || 0) * weights.xpFactor).toFixed(2),
    };
  },

  // ─── Expose flush for manual call ─────────────────────────────
  flush: forceFlush,
  onLevelUp,
};

module.exports = XPLib;
