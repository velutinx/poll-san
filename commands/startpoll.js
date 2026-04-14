// this is poll-san/commands/startpoll.js

const { chunkArray, emojis, reactIds, ids, releaseEmojis } = require('../utils/helpers');
const { generateMessageContent, runPollInterval, setActivePollContext } = require('../services/pollService');
const supabase = require('../services/supabase');

module.exports = async (interaction) => {
    // Allow dashboard to bypass Discord checks
    if (typeof interaction.isChatInputCommand === 'function') {
        if (!interaction.isChatInputCommand() && !interaction.isDashboard) return;
    }

    // Defer reply (safe for both)
    if (interaction.deferReply) {
        await interaction.deferReply({ flags: 64 }).catch(() => {});
    }

    // Extract data
    const days = interaction.options.getInteger('days') || 7;
    const listRaw = interaction.options.getString('list');

    if (!listRaw) {
        console.error("❌ No character list provided to startpoll.");
        if (interaction.editReply) await interaction.editReply("Error: No list provided.");
        return;
    }

    // Split by line (preserve exact order)
    const lines = listRaw.split(/\r?\n/).filter(line => line.trim().length > 0);
    const characters = lines.map(line => line.trim());

    const endTime = Date.now() + (days * 24 * 60 * 60 * 1000);

    // Send poll message
    const pollMessage = await interaction.channel.send({
        content: await generateMessageContent(endTime, null, characters)
    });

    // Store poll context for manual refresh (used by vote handlers)
    setActivePollContext(pollMessage, endTime, characters);

    // Record in Supabase (for auto-resume)
    try {
        await supabase.from('auto_resume').upsert({
            message_id: pollMessage.id,
            channel_id: interaction.channel.id,
            ends_at: new Date(endTime).toISOString(),
            poll_list: listRaw
        });
        console.log(`✅ Supabase: Recorded poll ${pollMessage.id} for auto-resume.`);
    } catch (dbError) {
        console.error("❌ Supabase Error:", dbError.message);
    }

    // Add reactions in parallel
    await Promise.all(reactIds.map(id => 
        pollMessage.react(id).catch(e => console.error(`Reaction Error (${id}):`, e.message))
    ));

    // Create discussion thread
    const thread = await pollMessage.startThread({
        name: `Character Discussion - ${new Date().toLocaleDateString()}`,
        autoArchiveDuration: 1440
    });

    // Split characters into chunks of 4
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

        await thread.send({ 
            content: content, 
            embeds: embeds 
        }).catch(e => console.error("Thread Image Error:", e.message));
    }

    const upArrows = releaseEmojis.UP_ARROWS;
    const randomUpArrow = upArrows[Math.floor(Math.random() * upArrows.length)];

    await thread.send({
        content: `${randomUpArrow} Character images for the poll above! <@&${ids.tags.poll_mention}>`
    });

    if (interaction.editReply) {
        await interaction.editReply({ content: '✅ Poll Live!' }).catch(() => {});
    }

    // Start the 1‑minute fallback timer (also sets up manual refresh context)
    runPollInterval(pollMessage, endTime, characters);
};
