// commands/startpoll.js

const h = require('../utils/helpers');
const { chunkArray, emojis, reactIds, ids, releaseEmojis } = h;
const { generateMessageContent, runPollInterval, getPollResults } = require('../services/pollService');
const db = require('../services/database');

async function getPollWebhook(channel) {
  const name = 'Poll';
  const avatar = h.urls.LOGO_URL;
  let webhook = (await channel.fetchWebhooks()).find(w => w.name === name);
  if (webhook) {
    if (webhook.avatar !== avatar) await webhook.edit({ name, avatar });
    return webhook;
  }
  webhook = await channel.createWebhook({ name, avatar });
  return webhook;
}

module.exports = async (interaction) => {
    if (typeof interaction.isChatInputCommand === 'function') {
        if (!interaction.isChatInputCommand() && !interaction.isDashboard) return;
    }

    if (interaction.deferReply) {
        await interaction.deferReply({ flags: 64 }).catch(() => {});
    }

    const days = interaction.options.getInteger('days') || 7;
    const listRaw = interaction.options.getString('list');

    if (!listRaw) {
        console.error("❌ No character list provided to startpoll.");
        if (interaction.editReply) await interaction.editReply("Error: No list provided.");
        return;
    }

    const lines = listRaw.split(/\r?\n/).filter(line => line.trim().length > 0);
    const characters = lines.map(line => line.trim());
    const endTime = Date.now() + (days * 24 * 60 * 60 * 1000);
    const endTimeISO = new Date(endTime).toISOString();
    const channel = interaction.channel;
    const webhook = await getPollWebhook(channel);
    const pollMessage = await webhook.send({
        content: await generateMessageContent(endTime, null, characters),
        username: 'Poll',
        avatarURL: h.urls.LOGO_URL,
    });

    const thread = await pollMessage.startThread({
        name: `Character Discussion - ${new Date().toLocaleDateString()}`,
        autoArchiveDuration: 1440
    });

    // ───── Send initial reminder (right away) – no embed from Discord link ─────
    const initialWebhook = await (async () => {
        const hooks = await channel.fetchWebhooks();
        let wh = hooks.find(w => w.name === 'Poll Reminder');
        if (!wh) wh = await channel.createWebhook({ name: 'Poll Reminder', avatar: h.urls.LOGO_URL });
        return wh;
    })();

    // FETCH THE ANIMATED EMOJI INSTEAD OF '💬'
    const speechEmoji = releaseEmojis.SPEECH || '<a:speech:1506709601758744828>';
    const dmLink = `<https://discord.com/users/${h.ids.users.Velutinx}>`;

    const initialReminderMsg = await initialWebhook.send({
        content: `${speechEmoji} Remember to message **[DM Velutinx](${dmLink})** with suggestions for next week's poll! All suggestions must be sent before **Friday**.`,
        username: 'Poll Reminder',
        avatarURL: h.urls.LOGO_URL,
        flags: [1 << 12]
    });

    // ───── Send the up‑arrow message and store its ID ─────
    const upArrows = releaseEmojis.UP_ARROWS || [];
    const randomUpArrow = upArrows.length ? upArrows[Math.floor(Math.random() * upArrows.length)] : '⬆️';
    const arrowMsg = await webhook.send({
        content: `${randomUpArrow} Character images for the poll above!`,
        threadId: thread.id,
        username: 'Poll',
        avatarURL: h.urls.LOGO_URL,
        flags: [1 << 12]
    });

    // ──────────────────────────────────────────────────────────────────
    //  SELF-HEAL: wipe reminder state from the previous poll cycle
    // ──────────────────────────────────────────────────────────────────
    //  Cloudflare's `poll-reminder-worker` keeps its own bookkeeping in
    //  the `poll_settings` table under these exact keys:
    //      last_thursday_reminder, last_thursday_reminder_message_id,
    //      last_friday_reminder,   last_friday_reminder_message_id,
    //      saturday_cleanup
    //
    //  If a previous cycle's Saturday cleanup ever fails (cron miss,
    //  network hiccup, message-already-deleted, etc.), the stale message
    //  IDs and dates linger. The next poll then inherits them, and — as
    //  you saw with the stuck Friday message — a stale Friday ID can
    //  make the new cycle's cleanup try to delete the wrong message.
    //
    //  Wiping these keys here guarantees every new poll starts blank.
    //  Wrapped in try/catch so a D1 hiccup can never block the poll
    //  from launching.
    // ──────────────────────────────────────────────────────────────────
    try {
        await db.query(
            `DELETE FROM poll_settings WHERE key IN (
                'last_thursday_reminder', 'last_thursday_reminder_message_id',
                'last_friday_reminder',   'last_friday_reminder_message_id',
                'saturday_cleanup'
            )`
        );
        console.log('🧹 Cleared stale poll_settings reminder keys from previous cycle.');

        // Reset vestigial reminder columns on any other active poll rows.
        // Railway's own reminder system is disabled (see events/ready.js),
        // so these columns are unused by the code — but leaving them
        // zeroed keeps the D1 browser from showing stale state.
        await db.query(
            `UPDATE poll_auto_resume
             SET reminder_message_id = NULL,
                 reminder_48h_sent   = 0,
                 reminder_friday_sent = 0
             WHERE status = 'active'`
        );
        console.log('🧹 Reset reminder columns on active poll_auto_resume rows.');
    } catch (cleanupErr) {
        console.warn('⚠️ Poll reminder state cleanup failed (non-fatal):', cleanupErr.message);
    }
    // ──────────────────────────────────────────────────────────────────

    try {
        await db.query(
            `INSERT OR REPLACE INTO ${h.tables.POLL_AUTO_RESUME}
             (message_id, channel_id, ends_at, poll_list, status, created_at, initial_reminder_id, arrow_message_id)
             VALUES (?, ?, ?, ?, 'active', datetime('now'), ?, ?)`,
            [pollMessage.id, channel.id, endTimeISO, listRaw, initialReminderMsg.id, arrowMsg.id]
        );
        console.log(`✅ D1: Recorded poll ${pollMessage.id} for auto-resume, initial reminder and arrow message stored.`);
    } catch (dbError) {
        console.error("❌ D1 Error:", dbError.message);
    }

    // Populate final scores table immediately so dashboard shows characters
    await getPollResults(pollMessage, characters);

    // Start the dynamic reminder system (handles last‑day reminder and deletes initial one)
    // COMMENTED OUT to let the Cloudflare Worker handle the logic and prevent conflicts
    // const { startPollReminders } = require('../services/pollReminders');
    // await startPollReminders(channel, pollMessage.id, endTimeISO, interaction.client);

    await Promise.all(reactIds.map(id =>
        pollMessage.react(id).catch(e => console.error(`Reaction Error (${id}):`, e.message))
    ));

    const characterChunks = chunkArray(characters, 4);
    const cacheVersion = Date.now();

    for (let i = 0; i < characterChunks.length; i++) {
        let content = "";
        const embeds = [];
        const sharedUrl = "https://www.velutinx.com/poll";

        characterChunks[i].forEach((name, idx) => {
            const globalIdx = (i * 4) + idx + 1;
            content += `${emojis[globalIdx - 1]} ${name}\n`;
            embeds.push({
                url: sharedUrl,
                image: {
                    url: `https://www.velutinx.com/images/poll/${globalIdx}.jpg?v=${cacheVersion}`
                }
            });
        });

        await webhook.send({
            content: content,
            embeds: embeds,
            threadId: thread.id,
            username: 'Poll',
            avatarURL: h.urls.LOGO_URL,
            flags: [1 << 12]
        }).catch(e => console.error("Thread Image Error:", e.message));
    }

    if (interaction.editReply) {
        const verifyEmoji = h.releaseEmojis?.getRandomVerify?.() || '✅';
        await interaction.editReply({ content: `${verifyEmoji} Poll Live!` }).catch(() => {});
    }

    runPollInterval(pollMessage, endTime, characters);
};
