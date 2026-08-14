// services/pollReminders.js

const db = require('./database');
const h = require('../utils/helpers');

const GIVEAWAY_ROLE_ID = h.ids.roles.giveaway_notify_role;
const REMINDER_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

const activeIntervals = new Map();

async function getOrCreateWebhook(channel, name) {
  const hooks = await channel.fetchWebhooks();
  let webhook = hooks.find(w => w.name === name);
  if (!webhook) {
    webhook = await channel.createWebhook({
      name: name,
      avatar: h.urls.LOGO_URL
    });
  }
  return webhook;
}

async function managePollReminders(channel, pollMessageId, endTimeISO, client) {
  const now = new Date();
  const nowUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const endTime = new Date(endTimeISO);
  const remainingHours = (endTime - now) / (1000 * 60 * 60);

  // Only act if poll ends on Saturday (per your poll logic)
  if (endTime.getUTCDay() !== 6) return;

  const poll = await db.query(
    `SELECT reminder_48h_sent, initial_reminder_id, reminder_message_id
     FROM ${h.tables.POLL_AUTO_RESUME}
     WHERE message_id = ?`,
    [pollMessageId],
    true
  );
  if (!poll) return;

  const initialReminderId = poll.initial_reminder_id;
  let reminder48hSent = poll.reminder_48h_sent === 1;
  let reminderFridaySent = poll.reminder_friday_sent === 1;

  // ─── Get the current day in UTC ──────────────────────────────────
  const day = now.getUTCDay(); // 0 = Sunday, 4 = Thursday, 5 = Friday
  const todayStr = now.toISOString().slice(0, 10);

  // ─── Helper: send a reminder via webhook ────────────────────────
  async function sendReminder(content, username = 'Poll Reminder') {
    const webhook = await getOrCreateWebhook(channel, username);
    const sent = await webhook.send({
      content,
      allowedMentions: { parse: [] },
      flags: [1 << 12],
      username,
      avatarURL: h.urls.LOGO_URL
    });
    return sent;
  }

  // ─── Delete a message by ID ──────────────────────────────────────
  async function deleteMessage(messageId) {
    if (!messageId) return;
    try {
      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (msg) await msg.delete();
    } catch (e) {
      // ignore
    }
  }

  const alertEmoji = h.releaseEmojis?.ALERT || '<a:alert:1493698480034676736>';
  const dmLink = `<https://discord.com/users/${h.ids.users.Velutinx}>`;
  const roleMention = `<@&${GIVEAWAY_ROLE_ID}>`;

  // ─── THURSDAY: "Last day for poll suggestions" ──────────────────
  if (day === 4 && !reminder48hSent && remainingHours <= 72 && remainingHours > 24) {
    // Delete initial reminder
    if (initialReminderId) {
      await deleteMessage(initialReminderId);
    }

    const content = `${alertEmoji} **Last day for poll suggestions!** ${roleMention}\n` +
      `Please send your character suggestions for next week's poll via DM to **[DM Velutinx](${dmLink})** before Friday.`;

    const sent = await sendReminder(content);
    await db.query(
      `UPDATE ${h.tables.POLL_AUTO_RESUME}
       SET reminder_48h_sent = 1, reminder_message_id = ?
       WHERE message_id = ?`,
      [sent.id, pollMessageId]
    );
    console.log(`[PollReminders] Posted Thursday reminder for poll ${pollMessageId}`);
  }

  // ─── FRIDAY: "Last chance – poll suggestions close tonight!" ──
  if (day === 5 && !reminderFridaySent && remainingHours <= 48 && remainingHours > 0) {
    // Delete the Thursday reminder (if it exists) to avoid clutter
    if (poll.reminder_message_id) {
      await deleteMessage(poll.reminder_message_id);
    }

    const content = `${alertEmoji} **Reminder: poll suggestions close tonight!**\n` +
      `Last chance to DM **[DM Velutinx](${dmLink})** with your picks.`;

    const sent = await sendReminder(content);
    await db.query(
      `UPDATE ${h.tables.POLL_AUTO_RESUME}
       SET reminder_friday_sent = 1, reminder_message_id = ?
       WHERE message_id = ?`,
      [sent.id, pollMessageId]
    );
    console.log(`[PollReminders] Posted Friday reminder for poll ${pollMessageId}`);
  }

  // ─── After poll ends, clean up ──────────────────────────────────
  if (remainingHours <= 0) {
    if (poll.reminder_message_id) {
      await deleteMessage(poll.reminder_message_id);
    }
    if (poll.initial_reminder_id) {
      await deleteMessage(poll.initial_reminder_id);
    }
    await db.query(
      `UPDATE ${h.tables.POLL_AUTO_RESUME}
       SET reminder_message_id = NULL, reminder_48h_sent = 0, reminder_friday_sent = 0
       WHERE message_id = ?`,
      [pollMessageId]
    );
    console.log(`[PollReminders] Cleaned up reminders for poll ${pollMessageId}`);
  }
}

async function startPollReminders(channel, pollMessageId, endTimeISO, client) {
  if (activeIntervals.has(pollMessageId)) {
    clearInterval(activeIntervals.get(pollMessageId));
    activeIntervals.delete(pollMessageId);
  }

  // Run immediately on start
  await managePollReminders(channel, pollMessageId, endTimeISO, client);

  const interval = setInterval(async () => {
    const poll = await db.query(
      `SELECT ends_at FROM ${h.tables.POLL_AUTO_RESUME} WHERE message_id = ?`,
      [pollMessageId],
      true
    );
    if (!poll) {
      clearInterval(interval);
      activeIntervals.delete(pollMessageId);
      return;
    }
    await managePollReminders(channel, pollMessageId, poll.ends_at, client);
  }, REMINDER_CHECK_INTERVAL);

  activeIntervals.set(pollMessageId, interval);
}

async function restorePollReminders(client) {
  const activePolls = await db.query(
    `SELECT * FROM ${h.tables.POLL_AUTO_RESUME} WHERE ends_at > datetime('now')`
  );
  for (const poll of activePolls) {
    const channel = await client.channels.fetch(poll.channel_id).catch(() => null);
    if (channel) {
      await startPollReminders(channel, poll.message_id, poll.ends_at, client);
    }
  }
}

module.exports = { startPollReminders, restorePollReminders, managePollReminders };
