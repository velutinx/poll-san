// services/pollReminders.js
const supabase = require('./supabase');
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

    // Store message ID in poll_auto_resume
    await supabase.from(h.tables.POLL_AUTO_RESUME).upsert({
      key: 'suggestion_reminder_1',
      value: {
        messageId: msg1.id,
        channelId: channel.id,
        pollEndTime: pollEndTime.toISOString()
      }
    }, { onConflict: 'key' });

    // Calculate delays
    const now = Date.now();
    const msToThursday = 5 * 24 * 60 * 60 * 1000;   // 5 days exactly
    const msToFriday = 6 * 24 * 60 * 60 * 1000;      // 6 days (Friday cleanup)

    // Schedule Thursday transition
    safeTimeout(async () => {
      await handleThursday(channel.client);
    }, msToThursday);

    // Schedule Friday cleanup (in case Thursday step works, this will delete the second message)
    safeTimeout(async () => {
      await handleFridayCleanup(channel.client);
    }, msToFriday);

//    console.log(`[PollReminders] First suggestion reminder posted (ID: ${msg1.id}), Thursday & Friday timers set.`);
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
    const { data, error } = await supabase
      .from(h.tables.POLL_AUTO_RESUME)
      .select('value')
      .eq('key', 'suggestion_reminder_1')
      .single();

    if (error || !data) return console.warn('[PollReminders] No first reminder found for Thursday transition.');

    const { messageId, channelId } = data.value;

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

    // Store second reminder ID (overwrite or insert)
    await supabase.from(h.tables.POLL_AUTO_RESUME).upsert({
      key: 'suggestion_reminder_2',
      value: {
        messageId: msg2.id,
        channelId: channelId,
        postedAt: new Date().toISOString()
      }
    }, { onConflict: 'key' });

 //   console.log(`[PollReminders] Last-day reminder posted (ID: ${msg2.id}), first one deleted.`);
  } catch (err) {
    console.error('[PollReminders] Thursday handler error:', err);
  }
}

/**
 * Called 6 days after poll end (Friday). Deletes the second reminder.
 */
async function handleFridayCleanup(client) {
  try {
    const { data, error } = await supabase
      .from(h.tables.POLL_AUTO_RESUME)
      .select('value')
      .eq('key', 'suggestion_reminder_2')
      .single();

    if (error || !data) return; // nothing to delete

    const { messageId, channelId } = data.value;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) {
      await channel.messages.delete(messageId).catch(() => {});
    }

    await supabase.from(h.tables.POLL_AUTO_RESUME).delete().eq('key', 'suggestion_reminder_2');
//    console.log(`[PollReminders] Friday cleanup done.`);
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

// ----- Safe timeout (supports >24.8 days, same as giveaway) -----
const MAX_TIMEOUT = 2147483647;
function safeTimeout(callback, delayMs) {
  if (delayMs <= MAX_TIMEOUT) {
    return setTimeout(callback, delayMs);
  }
  return setTimeout(() => safeTimeout(callback, delayMs - MAX_TIMEOUT), MAX_TIMEOUT);
}

// ----- Restoration on bot start (optional) -----
async function restorePollReminders(client) {
  try {
    // Check if we have a first reminder that hasn't transitioned yet
    const { data: d1 } = await supabase
      .from(h.tables.POLL_AUTO_RESUME)
      .select('value')
      .eq('key', 'suggestion_reminder_1')
      .single();

    if (d1) {
      const { pollEndTime } = d1.value;
      const end = new Date(pollEndTime).getTime();
      const now = Date.now();
      const timeSinceEnd = now - end;

      // If Thursday hasn't passed yet, reschedule
      const thursdayDelay = 5 * 24 * 60 * 60 * 1000 - timeSinceEnd;
      if (thursdayDelay > 0) {
        safeTimeout(() => handleThursday(client), thursdayDelay);
  //      console.log(`[PollReminders] Restored Thursday timer (in ${Math.floor(thursdayDelay/3600000)}h).`);
      } else {
        // Thursday already passed, maybe run immediately? But we also need to check if second reminder exists
        const fridayDelay = 6 * 24 * 60 * 60 * 1000 - timeSinceEnd;
        if (fridayDelay > 0) {
          // Friday hasn't passed yet, so the Thursday transition should have happened but didn't. Do it now.
          await handleThursday(client);
        } else {
          // Everything expired, just clean up DB entries
          await supabase.from(h.tables.POLL_AUTO_RESUME).delete().eq('key', 'suggestion_reminder_1');
          await supabase.from(h.tables.POLL_AUTO_RESUME).delete().eq('key', 'suggestion_reminder_2');
        }
      }
    }

    // Check for second reminder (if still needs deletion)
    const { data: d2 } = await supabase
      .from(h.tables.POLL_AUTO_RESUME)
      .select('value')
      .eq('key', 'suggestion_reminder_2')
      .single();

    if (d2) {
      const { postedAt, channelId, messageId } = d2.value;
      const postTime = new Date(postedAt).getTime();
      // Should be deleted on Friday (1 day after posting). If that time passed, delete now.
      const deleteTime = postTime + 24 * 60 * 60 * 1000;
      const now = Date.now();
      if (now >= deleteTime) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) await channel.messages.delete(messageId).catch(() => {});
        await supabase.from(h.tables.POLL_AUTO_RESUME).delete().eq('key', 'suggestion_reminder_2');
      } else {
        // Reschedule deletion
        safeTimeout(async () => {
          const channel = await client.channels.fetch(channelId).catch(() => null);
          if (channel) await channel.messages.delete(messageId).catch(() => {});
          await supabase.from(h.tables.POLL_AUTO_RESUME).delete().eq('key', 'suggestion_reminder_2');
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
