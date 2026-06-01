// services/pollReminders.js
const db = require('./database');
const h = require('../utils/helpers');

const ADMIN_ID = h.ids.users.Velutinx;
const GIVEAWAY_ROLE_ID = h.ids.roles.giveaway_notify_role;

/**
 * Post the first reminder (suggestions open) right after a poll ends.
 * Schedules the Thursday transition and final Friday cleanup.
 */
async function startPollReminders(channel, pollEndTime) {
  try {
    // 1. Send first reminder (silent ping to Giveaways & Events)
    const webhook = await getOrCreateWebhook(channel, 'Poll Reminder');
    const roleMention = `<@&${GIVEAWAY_ROLE_ID}>`;
    const message1 = `${roleMention} ${h.releaseEmojis.SPEECH} Remember to message **[DM Velutinx](https://discord.com/users/${ADMIN_ID})** with suggestions for next week's poll!\n` +
                     `At the moment suggestions are free — check the pinned messages in this channel.\n` +
                     `All suggestions must be sent before **Friday PTD**.`;

    const msg1 = await webhook.send({
      content: message1,
      allowedMentions: { parse: [] },
      flags: [1 << 12, 1 << 2],
      username: 'Poll Reminder',
      avatarURL: h.urls.LOGO_URL
    });

    // Store message ID in poll_auto_resume (key-value)
    const value = JSON.stringify({
      messageId: msg1.id,
      channelId: channel.id,
      pollEndTime: pollEndTime.toISOString()
    });
    await db.query(
      `INSERT INTO ${h.tables.POLL_AUTO_RESUME} (key, value)
       VALUES ('suggestion_reminder_1', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [value]
    );

    // Calculate delays
    const now = Date.now();
    const msToThursday = 5 * 24 * 60 * 60 * 1000;   // 5 days exactly
    const msToFriday = 6 * 24 * 60 * 60 * 1000;      // 6 days (Friday cleanup)

    // Schedule Thursday transition
    safeTimeout(async () => {
      await handleThursday(channel.client);
    }, msToThursday);

    // Schedule Friday cleanup
    safeTimeout(async () => {
      await handleFridayCleanup(channel.client);
    }, msToFriday);

  } catch (err) {
    console.error('[PollReminders] Error posting first reminder:', err);
  }
}

/**
 * Called exactly 5 days after poll end (Thursday).
 * Deletes the first reminder and posts the "last day" reminder.
 */
async function handleThursday(client) {
  try {
    // Fetch stored first reminder
    const row = await db.query(
      `SELECT value FROM ${h.tables.POLL_AUTO_RESUME} WHERE key = 'suggestion_reminder_1'`,
      [],
      true   // single row
    );

    if (!row) return console.warn('[PollReminders] No first reminder found for Thursday transition.');

    const data = JSON.parse(row.value);
    const { messageId, channelId } = data;

    // Delete the first message
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) {
      await channel.messages.delete(messageId).catch(() => {});
    }

    // Post second reminder (silent ping)
    const webhook = await getOrCreateWebhook(channel, 'Poll Reminder');
    const roleMention = `<@&${GIVEAWAY_ROLE_ID}>`;
    const message2 = `${h.releaseEmojis.ALERT} **Last day for poll suggestions!** ${roleMention}`;

    const msg2 = await webhook.send({
      content: message2,
      allowedMentions: { parse: [] },
      flags: [1 << 12],
      username: 'Poll Reminder',
      avatarURL: h.urls.LOGO_URL
    });

    // Store second reminder ID
    const value2 = JSON.stringify({
      messageId: msg2.id,
      channelId: channelId,
      postedAt: new Date().toISOString()
    });
    await db.query(
      `INSERT INTO ${h.tables.POLL_AUTO_RESUME} (key, value)
       VALUES ('suggestion_reminder_2', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [value2]
    );

  } catch (err) {
    console.error('[PollReminders] Thursday handler error:', err);
  }
}

/**
 * Called 6 days after poll end (Friday). Deletes the second reminder.
 */
async function handleFridayCleanup(client) {
  try {
    const row = await db.query(
      `SELECT value FROM ${h.tables.POLL_AUTO_RESUME} WHERE key = 'suggestion_reminder_2'`,
      [],
      true
    );

    if (!row) return; // nothing to delete

    const data = JSON.parse(row.value);
    const { messageId, channelId } = data;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) {
      await channel.messages.delete(messageId).catch(() => {});
    }

    await db.query(
      `DELETE FROM ${h.tables.POLL_AUTO_RESUME} WHERE key = 'suggestion_reminder_2'`
    );
  } catch (err) {
    console.error('[PollReminders] Friday cleanup error:', err);
  }
}

// ----- Webhook helper -----
async function getOrCreateWebhook(channel, name) {
  const hooks = await channel.fetchWebhooks();
  let webhook = hooks.find(w => w.name === name);
  if (!webhook) {
    webhook = await channel.createWebhook({
      name,
      avatar: h.urls.LOGO_URL
    });
  }
  return webhook;
}

// ----- Safe timeout (supports >24.8 days) -----
const MAX_TIMEOUT = 2147483647;
function safeTimeout(callback, delayMs) {
  if (delayMs <= MAX_TIMEOUT) {
    return setTimeout(callback, delayMs);
  }
  return setTimeout(() => safeTimeout(callback, delayMs - MAX_TIMEOUT), MAX_TIMEOUT);
}

// ----- Restoration on bot start -----
async function restorePollReminders(client) {
  try {
    // Check first reminder
    const d1 = await db.query(
      `SELECT value FROM ${h.tables.POLL_AUTO_RESUME} WHERE key = 'suggestion_reminder_1'`,
      [],
      true
    );

    if (d1) {
      const data = JSON.parse(d1.value);
      const { pollEndTime } = data;
      const end = new Date(pollEndTime).getTime();
      const now = Date.now();
      const timeSinceEnd = now - end;

      const thursdayDelay = 5 * 24 * 60 * 60 * 1000 - timeSinceEnd;
      if (thursdayDelay > 0) {
        safeTimeout(() => handleThursday(client), thursdayDelay);
      } else {
        const fridayDelay = 6 * 24 * 60 * 60 * 1000 - timeSinceEnd;
        if (fridayDelay > 0) {
          // Thursday already passed, do it now
          await handleThursday(client);
        } else {
          // Everything expired, clean up DB entries
          await db.query(`DELETE FROM ${h.tables.POLL_AUTO_RESUME} WHERE key IN ('suggestion_reminder_1','suggestion_reminder_2')`);
        }
      }
    }

    // Check second reminder
    const d2 = await db.query(
      `SELECT value FROM ${h.tables.POLL_AUTO_RESUME} WHERE key = 'suggestion_reminder_2'`,
      [],
      true
    );

    if (d2) {
      const data = JSON.parse(d2.value);
      const { postedAt, channelId, messageId } = data;
      const postTime = new Date(postedAt).getTime();
      const deleteTime = postTime + 24 * 60 * 60 * 1000;
      const now = Date.now();
      if (now >= deleteTime) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) await channel.messages.delete(messageId).catch(() => {});
        await db.query(`DELETE FROM ${h.tables.POLL_AUTO_RESUME} WHERE key = 'suggestion_reminder_2'`);
      } else {
        safeTimeout(async () => {
          const channel = await client.channels.fetch(channelId).catch(() => null);
          if (channel) await channel.messages.delete(messageId).catch(() => {});
          await db.query(`DELETE FROM ${h.tables.POLL_AUTO_RESUME} WHERE key = 'suggestion_reminder_2'`);
        }, deleteTime - now);
      }
    }
  } catch (err) {
    console.error('[PollReminders] Restoration error:', err);
  }
}

module.exports = {
  startPollReminders,
  restorePollReminders
};
