const db = require('./database');
const h = require('../utils/helpers');

const ADMIN_ID = h.ids.users.Velutinx;
const GIVEAWAY_ROLE_ID = h.ids.roles.giveaway_notify_role;

async function getOrCreateWebhook(channel, name) {
  const hooks = await channel.fetchWebhooks();
  let webhook = hooks.find(w => w.name === name);
  if (!webhook) {
    webhook = await channel.createWebhook({ name, avatar: h.urls.LOGO_URL });
  }
  return webhook;
}

async function managePollReminders(channel, pollMessageId, endTime, client) {
  const now = Date.now();
  const remainingMs = new Date(endTime).getTime() - now;
  const remainingHours = remainingMs / (1000 * 60 * 60);

  const poll = await db.query(
    `SELECT * FROM ${h.tables.POLL_AUTO_RESUME} WHERE message_id = ?`,
    [pollMessageId],
    true
  );
  if (!poll) return;

  const reminderMessageId = poll.reminder_message_id;
  const reminderSent = poll.reminder_48h_sent === 1;

  // Post reminder when <=48h and >24h
  if (remainingHours <= 48 && remainingHours > 24 && !reminderSent) {
    if (reminderMessageId) {
      try {
        const msg = await channel.messages.fetch(reminderMessageId).catch(() => null);
        if (msg) await msg.delete();
      } catch(e) {}
    }
    const webhook = await getOrCreateWebhook(channel, 'Poll Reminder');
    const roleMention = `<@&${GIVEAWAY_ROLE_ID}>`;
    const reminderContent = `${h.releaseEmojis.ALERT} **Last day for poll suggestions!** ${roleMention}\nPlease send your character suggestions for next week's poll via DM to <@${ADMIN_ID}> before Friday.`;
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
  // Delete reminder when <=24h or after poll ends
  else if ((remainingHours <= 24 || remainingHours <= 0) && reminderMessageId) {
    try {
      const msg = await channel.messages.fetch(reminderMessageId).catch(() => null);
      if (msg) await msg.delete();
    } catch(e) {}
    await db.query(
      `UPDATE ${h.tables.POLL_AUTO_RESUME} SET reminder_message_id = NULL, reminder_48h_sent = 0 WHERE message_id = ?`,
      [pollMessageId]
    );
    console.log(`[PollReminders] Deleted 48h reminder for poll ${pollMessageId}`);
  }
  // If time extended beyond 48h, remove stale reminder
  else if (remainingHours > 48 && reminderMessageId) {
    try {
      const msg = await channel.messages.fetch(reminderMessageId).catch(() => null);
      if (msg) await msg.delete();
    } catch(e) {}
    await db.query(
      `UPDATE ${h.tables.POLL_AUTO_RESUME} SET reminder_message_id = NULL, reminder_48h_sent = 0 WHERE message_id = ?`,
      [pollMessageId]
    );
  }
}

async function startPollReminders(channel, pollMessageId, endTime, client) {
  await managePollReminders(channel, pollMessageId, endTime, client);
  const interval = setInterval(async () => {
    const poll = await db.query(
      `SELECT ends_at FROM ${h.tables.POLL_AUTO_RESUME} WHERE message_id = ?`,
      [pollMessageId],
      true
    );
    if (!poll) {
      clearInterval(interval);
      return;
    }
    await managePollReminders(channel, pollMessageId, poll.ends_at, client);
  }, 3600000);
  return interval;
}

async function restorePollReminders(client) {
  const activePolls = await db.query(
    `SELECT * FROM ${h.tables.POLL_AUTO_RESUME} WHERE ends_at > datetime('now')`
  );
  for (const poll of activePolls) {
    const channel = await client.channels.fetch(poll.channel_id).catch(() => null);
    if (channel) {
      startPollReminders(channel, poll.message_id, poll.ends_at, client);
    }
  }
}

module.exports = { startPollReminders, restorePollReminders, managePollReminders };
