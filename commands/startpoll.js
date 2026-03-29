// commands/startpoll.js
const { chunkArray, emojis, reactIds } = require('../utils/helpers');
const { generateMessageContent, runPollInterval } = require('../services/pollService');
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

// Split by any kind of newline (CR, LF, CRLF)
const lines = listRaw.split(/\r?\n/).filter(line => line.trim().length > 0);
const characters = lines.map(line => line.trim());

// DEBUG: log the order to console (check your bot logs)
//console.log('Characters in order:');
//characters.forEach((c, i) => console.log(`${i+1}: ${c}`));

   
    const endTime = Date.now() + (days * 24 * 60 * 60 * 1000);

    // Send poll message
    const pollMessage = await interaction.channel.send({
        content: await generateMessageContent(endTime, null, characters)
    });

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

    // Add reactions
    for (const id of reactIds) {
        await pollMessage.react(id).catch(() => {});
    }

    // Create discussion thread and attach images
    const thread = await pollMessage.startThread({
        name: `Character Discussion - ${new Date().toLocaleDateString()}`,
        autoArchiveDuration: 1440
    });

    const characterChunks = chunkArray(characters, 4);
    for (let i = 0; i < characterChunks.length; i++) {
        let content = "";
        const files = [];
        characterChunks[i].forEach((name, idx) => {
            const globalIdx = (i * 4) + idx + 1;
            content += `${emojis[globalIdx - 1]} ${name}\n`;
            files.push(`https://www.velutinx.com/images/poll/${globalIdx}.jpg`);
        });
        await thread.send({ content, files }).catch(e => console.error("Thread Image Error:", e.message));
    }

    // Final thread message (mention role)
    await thread.send({
        content: ":point_up_2: Character images for the poll above! <@&1472273843665113139>"
    });

    // Finalize interaction
    if (interaction.editReply) {
        await interaction.editReply({ content: '✅ Poll Live!' }).catch(() => {});
    }

    // Start background timer for poll updates
    runPollInterval(pollMessage, endTime, characters);
};
