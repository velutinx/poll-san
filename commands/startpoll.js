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

    // ───── Send initial reminder (right away) ─────
    const initialWebhook = await (async () => {
        const hooks = await channel.fetchWebhooks();
        let wh = hooks.find(w => w.name === 'Poll Reminder');
        if (!wh) wh = await channel.createWebhook({ name: 'Poll Reminder', avatar: h.urls.LOGO_URL });
        return wh;
    })();
    const speechEmoji = h.releaseEmojis?.SPEECH || '💬';
    const initialReminderMsg = await initialWebhook.send({
        content: `${speechEmoji} Remember to message **[DM Velutinx](https://discord.com/users/${h.ids.users.Velutinx})** with suggestions for next week's poll! All suggestions must be sent before **Friday**.`,
        username: 'Poll Reminder',
        avatarURL: h.urls.LOGO_URL,
        flags: [1 << 12]
    });

    try {
        await db.query(
            `INSERT OR REPLACE INTO ${h.tables.POLL_AUTO_RESUME}
             (message_id, channel_id, ends_at, poll_list, status, created_at, initial_reminder_id)
             VALUES (?, ?, ?, ?, 'active', datetime('now'), ?)`,
            [pollMessage.id, channel.id, endTimeISO, listRaw, initialReminderMsg.id]
        );
        console.log(`✅ D1: Recorded poll ${pollMessage.id} for auto-resume, initial reminder stored.`);
    } catch (dbError) {
        console.error("❌ D1 Error:", dbError.message);
    }

    // Populate final scores table immediately so dashboard shows characters
    await getPollResults(pollMessage, characters);

    // Start the dynamic reminder system (handles last‑day reminder and deletes initial one)
    const { startPollReminders } = require('../services/pollReminders');
    await startPollReminders(channel, pollMessage.id, endTimeISO, interaction.client);

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

    const upArrows = releaseEmojis.UP_ARROWS || [];
    const randomUpArrow = upArrows.length ? upArrows[Math.floor(Math.random() * upArrows.length)] : '⬆️';

    await webhook.send({
        content: `${randomUpArrow} Character images for the poll above!`,
        threadId: thread.id,
        username: 'Poll',
        avatarURL: h.urls.LOGO_URL,
        flags: [1 << 12]
    });

    if (interaction.editReply) {
        const verifyEmoji = h.releaseEmojis?.getRandomVerify?.() || '✅';
        await interaction.editReply({ content: `${verifyEmoji} Poll Live!` }).catch(() => {});
    }

    runPollInterval(pollMessage, endTime, characters);
};
