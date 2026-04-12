// this is poll-san/commands/startpoll.js

const { chunkArray, emojis, reactIds, ids, releaseEmojis } = require('../utils/helpers');
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

    // Split by line (preserve exact order)
    const lines = listRaw.split(/\r?\n/).filter(line => line.trim().length > 0);
    const characters = lines.map(line => line.trim());

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

    // Create discussion thread
    const thread = await pollMessage.startThread({
        name: `Character Discussion - ${new Date().toLocaleDateString()}`,
        autoArchiveDuration: 1440
    });

    // Split characters into chunks of 4
    const characterChunks = chunkArray(characters, 4);

    // --- NEW: Generate a single cache-buster timestamp for this entire poll run ---
    const cacheVersion = Date.now();

    for (let i = 0; i < characterChunks.length; i++) {
        let content = "";
        const embeds = [];
        
        // Using a shared URL helps Discord group these into a visual grid
        const sharedUrl = "https://www.velutinx.com/poll"; 

        characterChunks[i].forEach((name, idx) => {
            const globalIdx = (i * 4) + idx + 1;
            content += `${emojis[globalIdx - 1]} ${name}\n`;
            
            // Push an individual embed for each image to guarantee order
            // --- NEW: Apply the ?v=cacheVersion to the Discord embed URL ---
            embeds.push({
                url: sharedUrl,
                image: {
                    url: `https://www.velutinx.com/images/poll/${globalIdx}.jpg?v=${cacheVersion}`
                }
            });
        });

        // Send the names and the images together
        await thread.send({ 
            content: content, 
            embeds: embeds 
        }).catch(e => console.error("Thread Image Error:", e.message));
    }

    // --- RANDOM ARROW LOGIC ---
    // Pick one random up arrow for the final thread message
    const upArrows = releaseEmojis.UP_ARROWS;
    const randomUpArrow = upArrows[Math.floor(Math.random() * upArrows.length)];

    // Final thread message (using the new randomized arrow)
    await thread.send({
        content: `${randomUpArrow} Character images for the poll above! <@&${ids.tags.poll_mention}>`
    });

    // Finalize interaction
    if (interaction.editReply) {
        await interaction.editReply({ content: '✅ Poll Live!' }).catch(() => {});
    }

    // Start background timer for poll updates
    runPollInterval(pollMessage, endTime, characters);
};
