// services/xpManager.js
const db = require('./database');
const h = require('../utils/helpers');

// ─── In‑memory cache ──────────────────────────────────────────────
const xpCache = new Map(); // key: `${userId}:${guildId}` -> { total_messages, level }
const pendingUpdates = new Map(); // key: `${userId}:${guildId}` -> increments
let flushTimer = null;
const FLUSH_INTERVAL = 10000; // 10 seconds
const BATCH_THRESHOLD = 5; // flush per user after 5 messages

// ─── Helper: get level from XP ────────────────────────────────────
function getLevel(messages) {
  const LEVEL_THRESHOLDS = Array.from({ length: 26 }, (_, index) =>
    index <= 1 ? 0 : (index - 1) * 50
  );
  for (let i = LEVEL_THRESHOLDS.length - 1; i > 0; i--) {
    if (messages >= LEVEL_THRESHOLDS[i]) return i;
  }
  return 0;
}

// ─── Read XP (cache → D1 fallback) ───────────────────────────────
async function getXp(userId, guildId) {
  const key = `${userId}:${guildId}`;
  if (xpCache.has(key)) {
    return xpCache.get(key);
  }

  // Fallback to D1
  const row = await db.query(
    `SELECT total_messages, level FROM ${h.tables.USER_XP} WHERE user_id = ? AND guild_id = ?`,
    [userId, guildId],
    true
  );
  const result = row ? { total_messages: row.total_messages, level: row.level } : { total_messages: 0, level: 0 };
  xpCache.set(key, result);
  return result;
}

// ─── Add XP increment (buffered) ──────────────────────────────────
function addXp(userId, guildId, increment = 1) {
  const key = `${userId}:${guildId}`;
  if (!pendingUpdates.has(key)) {
    pendingUpdates.set(key, 0);
  }
  pendingUpdates.set(key, pendingUpdates.get(key) + increment);

  // Flush if threshold reached
  if (pendingUpdates.get(key) >= BATCH_THRESHOLD) {
    flushUpdates();
  } else {
    scheduleFlush();
  }
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushUpdates, FLUSH_INTERVAL);
}

// ─── Flush pending updates to D1 ──────────────────────────────────
async function flushUpdates() {
  flushTimer = null;
  if (pendingUpdates.size === 0) return;

  const updates = Array.from(pendingUpdates.entries());
  pendingUpdates.clear();

  for (const [key, increment] of updates) {
    const [userId, guildId] = key.split(':');

    // Get current from cache
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
        [userId, guildId, newTotal, newLevel, '']
      );
    } catch (err) {
      console.error('XP flush error:', err);
      continue;
    }

    // Update cache
    const newData = { total_messages: newTotal, level: newLevel };
    xpCache.set(key, newData);

    // Level-up notification
    if (newLevel > oldLevel) {
      // We'll emit an event that the main app can listen to
      // For now, we'll store it and handle it in ready.js
      if (global._xpLevelUpCallbacks) {
        for (const cb of global._xpLevelUpCallbacks) {
          cb({ userId, guildId, oldLevel, newLevel, newTotal });
        }
      }
    }
  }
}

// ─── Register level-up callback ──────────────────────────────────
function onLevelUp(callback) {
  if (!global._xpLevelUpCallbacks) global._xpLevelUpCallbacks = [];
  global._xpLevelUpCallbacks.push(callback);
}

// ─── Expose flush manually ──────────────────────────────────────
async function forceFlush() {
  await flushUpdates();
}

module.exports = {
  getXp,
  addXp,
  flushUpdates: forceFlush,
  onLevelUp,
};
