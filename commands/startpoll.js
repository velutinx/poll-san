// commands/startpoll.js
const h = require('../utils/helpers');
const { chunkArray, emojis, reactIds, ids, releaseEmojis } = h;
const { generateMessageContent, runPollInterval } = require('../services/pollService');
const supabase = require('../services/supabase');

// Helper: get or create the "Poll" webhook in a channel
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
    // Allow dashboard to bypass Discord checks
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

    // 1. Get or create the "Poll" webhook for this channel
    const channel = interaction.channel;
    const webhook = await getPollWebhook(channel);

    // 2. Send the main poll message via webhook (also creates the thread)
    const pollMessage = await webhook.send({
        content: await generateMessageContent(endTime, null, characters),
        threadName: `Character Discussion - ${new Date().toLocaleDateString()}`,
        username: 'Poll',
        avatarURL: h.urls.LOGO_URL,
    });

    // The thread is automatically created when using threadName
    const thread = pollMessage.thread;

    // 3. Record in Supabase (for auto‑resume) – using centralized table name
    try {
        await supabase.from(h.tables.POLL_AUTO_RESUME).upsert({
            message_id: pollMessage.id,
            channel_id: channel.id,
            ends_at: new Date(endTime).toISOString(),
            poll_list: listRaw
        });
        console.log(`✅ Supabase: Recorded poll ${pollMessage.id} for auto-resume.`);
    } catch (dbError) {
        console.error("❌ Supabase Error:", dbError.message);
    }

    // 4. Add reactions to the poll message (bot must react, webhooks can't)
    await Promise.all(reactIds.map(id =>
        pollMessage.react(id).catch(e => console.error(`Reaction Error (${id}):`, e.message))
    ));

    // 5. Send thread messages (images and prompt) via the same webhook
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
        }).catch(e => console.error("Thread Image Error:", e.message));
    }

    const upArrows = releaseEmojis.UP_ARROWS;
    const randomUpArrow = upArrows[Math.floor(Math.random() * upArrows.length)];

    await webhook.send({
        content: `${randomUpArrow} Character images for the poll above! <@&${ids.tags.poll_mention}>`,
        threadId: thread.id,
        username: 'Poll',
        avatarURL: h.urls.LOGO_URL,
    });

    if (interaction.editReply) {
        await interaction.editReply({ content: '✅ Poll Live!' }).catch(() => {});
    }

    // 6. Start the update interval (pass the webhook info through the message context)
    runPollInterval(pollMessage, endTime, characters);
};
