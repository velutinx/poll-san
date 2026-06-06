// services/pollReminders.js
const db = require('./database');
const h = require('../utils/helpers');

const GIVEAWAY_ROLE_ID = h.ids.roles.giveaway_notify_role;
const REMINDER_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

// Store active intervals per poll
const activeIntervals = new Map();

async function getOrCreateWebhook(channel, name) {
  const hooks = await channel.fetchWebhooks();
  let webhook = hooks.find(w => w.name === name);
  if (!webhook) {
    webhook = await channel.createWebhook({ name, avatar: h.urls.LOGO_URL });
  }
  return webhook;
}

// Core logic: post or delete the reminder based on remaining time
async function managePollReminders(channel, pollMessageId, endTimeISO, client) {
  const now = Date.now();
  const endTime = new Date(endTimeISO).getTime();
  const remainingHours = (endTime - now) / (1000 * 60 * 60);

  // Fetch current poll record
  const poll = await db.query(
    `SELECT reminder_message_id, reminder_48h_sent FROM ${h.tables.POLL_AUTO_RESUME} WHERE message_id = ?`,
    [pollMessageId],
    true
  );
  if (!poll) return;

  const reminderMsgId = poll.reminder_message_id;
  const reminderSent = poll.reminder_48h_sent === 1;

  // ---- Post reminder when 48h <= remaining <= 48h+1h (avoid flapping) ----
  if (remainingHours <= 48 && remainingHours > 24 && !reminderSent) {
    // Delete any stale reminder first
    if (reminderMsgId) {
      try {
        const old = await channel.messages.fetch(reminderMsgId).catch(() => null);
        if (old) await old.delete();
      } catch (e) {}
    }

    const webhook = await getOrCreateWebhook(channel, 'Poll Reminder');
    const roleMention = `<@&${GIVEAWAY_ROLE_ID}>`;
    const reminderContent = `${h.releaseEmojis.ALERT} **Last day for poll suggestions!** ${roleMention}\n` +
      `Please send your character suggestions for next week's poll via DM to <@${h.ids.users.Velutinx}> before Friday.`;

    const sent = await webhook.send({
      content: reminderContent,
      allowedMentions: { parse: [] },
      flags: [1 << 12],
      username: 'Poll Reminder',
      avatarURL: h.urls.LOGO_URL
    });

    await db.query(
      `UPDATE ${h.tables.POLL_AUTO_RESUME} SET reminder_message_id = ?, reminder_48h_sent = 1 WHERE message_id = ?`,
      [sent.id, pollMessageId]
    );
    console.log(`[PollReminders] Posted 48h reminder for poll ${pollMessageId}`);
  }
  // ---- Delete reminder when remaining <= 24h OR poll ended ----
  else if ((remainingHours <= 24 || remainingHours <= 0) && reminderMsgId) {
    try {
      const msg = await channel.messages.fetch(reminderMsgId).catch(() => null);
      if (msg) await msg.delete();
    } catch (e) {}
    await db.query(
      `UPDATE ${h.tables.POLL_AUTO_RESUME} SET reminder_message_id = NULL, reminder_48h_sent = 0 WHERE message_id = ?`,
      [pollMessageId]
    );
    console.log(`[PollReminders] Deleted reminder for poll ${pollMessageId}`);
  }
  // ---- If time was extended past 48h, reset the reminder flag ----
  else if (remainingHours > 48 && reminderSent) {
    await db.query(
      `UPDATE ${h.tables.POLL_AUTO_RESUME} SET reminder_48h_sent = 0 WHERE message_id = ?`,
      [pollMessageId]
    );
    console.log(`[PollReminders] Reset reminder flag for poll ${pollMessageId} (time extended)`);
  }
}

// Main function called from startpoll.js
async function startPollReminders(channel, pollMessageId, endTimeISO, client) {
  // Stop any existing interval for this poll
  if (activeIntervals.has(pollMessageId)) {
    clearInterval(activeIntervals.get(pollMessageId));
    activeIntervals.delete(pollMessageId);
  }

  // Run immediately
  await managePollReminders(channel, pollMessageId, endTimeISO, client);

  // Then run every hour
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

// Restore reminders on bot startup
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

module.exports = { startPollReminders, restorePollReminders };
