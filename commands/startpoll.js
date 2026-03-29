const { chunkArray, emojis, reactIds } = require('../utils/helpers');
const { generateMessageContent, runPollInterval } = require('../services/pollService');
const supabase = require('../services/supabase');

module.exports = async (interaction) => {
    // 1. ALLOW DASHBOARD TO BYPASS DISCORD-ONLY CHECKS
    if (typeof interaction.isChatInputCommand === 'function') {
        if (!interaction.isChatInputCommand() && !interaction.isDashboard) return;
    }

    // 2. DEFER REPLY
    if (interaction.deferReply) {
        await interaction.deferReply({ flags: 64 }).catch(() => {});
    }

    // 3. EXTRACT DATA
    const days = interaction.options.getInteger('days') || 7;
    const listRaw = interaction.options.getString('list');

    if (!listRaw) {
        console.error("❌ No character list provided to startpoll.");
        if (interaction.editReply) await interaction.editReply("Error: No list provided.");
        return;
    }

    const endTime = Date.now() + (days * 24 * 60 * 60 * 1000);

    const characters = listRaw
        .split(/(?=:female_sign:|:male_sign:|♀️|♂️)/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    console.log(`📋 Starting poll with ${characters.length} characters`);

    // 4. GENERATE POLL MESSAGE
    const pollMessage = await interaction.channel.send({
        content: await generateMessageContent(endTime, null, characters)
    });

    // 5. RECORD TO SUPABASE
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

    // 6. ADD REACTIONS
    for (const id of reactIds) {
        await pollMessage.react(id).catch(() => {});
    }

    // 7. THREAD & IMAGES - FIXED ORDER VERSION (using buffers)
    const thread = await pollMessage.startThread({
        name: `Character Discussion - ${new Date().toLocaleDateString()}`,
        autoArchiveDuration: 1440
    });

    const characterChunks = chunkArray(characters, 4);

    for (let i = 0; i < characterChunks.length; i++) {
        let content = "";
        const files = [];

        for (let idx = 0; idx < characterChunks[i].length; idx++) {
            const name = characterChunks[i][idx];
            const globalIdx = (i * 4) + idx + 1;

            content += `${emojis[globalIdx - 1]} ${name}\n`;

            try {
                // Download the image as buffer → forces Discord to respect order
                const response = await fetch(`https://www.velutinx.com/images/poll/${globalIdx}.jpg`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                
                const buffer = await response.arrayBuffer();   // or .buffer() in older node-fetch

                files.push({
                    attachment: Buffer.from(buffer),
                    name: `${globalIdx}.jpg`   // Explicit filename helps a lot
                });
            } catch (err) {
                console.error(`❌ Failed to fetch image ${globalIdx}.jpg:`, err.message);
                // Fallback to URL (less reliable for order)
                files.push(`https://www.velutinx.com/images/poll/${globalIdx}.jpg`);
            }
        }

        console.log(`📸 Sending chunk ${i + 1}/${characterChunks.length} →`, 
            files.map(f => f.name || f.split('/').pop()));

        await thread.send({ content, files })
            .catch(e => console.error("Thread Image Error:", e.message));
    }
    
    // 8. SEND NOTIFICATION
    await thread.send({
        content: ":point_up_2: Character images for the poll above! <@&1472273843665113139>"
    }).catch(() => {});

    // 9. FINALIZE INTERACTION
    if (interaction.editReply) {
        await interaction.editReply({ content: '✅ Poll Live!' }).catch(() => {});
    }

    // 10. START BACKGROUND TIMER
    runPollInterval(pollMessage, endTime, characters);
};
