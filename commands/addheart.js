// commands/addheart.js
const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');

const PREVIEW_FORUM_ID = '1465938599378812980';
const SUPPORTER_FORUM_ID = '1465937644394512516';
const HEART_EMOJI = '<a:heart:1511391137825558628>';
const FALLBACK_HEART = '❤️';

// Helper: wait for ms
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function addHeartIfNoReactions(message, emoji) {
    try {
        const fullMessage = await message.fetch();
        if (fullMessage.reactions.cache.size === 0) {
            await fullMessage.react(emoji);
            console.log(`❤️ Added to ${fullMessage.channel.name} (${fullMessage.id})`);
            return true;
        } else {
            console.log(`⏩ Skipped (has ${fullMessage.reactions.cache.size} reactions): ${fullMessage.channel.name}`);
            return false;
        }
    } catch (err) {
        console.warn(`Failed to react to ${message.id}:`, err.message);
        return false;
    }
}

async function processThread(thread, emoji) {
    let unarchived = false;
    try {
        // Unarchive if archived
        if (thread.archived) {
            await thread.setArchived(false);
            unarchived = true;
            console.log(`📂 Unarchived: ${thread.name}`);
            await delay(500); // brief pause after unarchive
        }

        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (!starter) return { added: false, skipped: true };

        const added = await addHeartIfNoReactions(starter, emoji);
        return { added, skipped: !added };
    } catch (err) {
        console.warn(`Error processing thread ${thread.name} (${thread.id}):`, err.message);
        return { added: false, skipped: false };
    } finally {
        // Re‑archive if we unarchived it
        if (unarchived) {
            try {
                await thread.setArchived(true);
                console.log(`📦 Re‑archived: ${thread.name}`);
            } catch (archiveErr) {
                console.warn(`Could not re‑archive ${thread.name}:`, archiveErr.message);
            }
            await delay(300);
        }
    }
}

async function processForum(guild, channelId, channelName, emoji) {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isThreadOnly()) {
        console.error(`❌ ${channelName} not found or not a forum`);
        return { added: 0, skipped: 0, total: 0 };
    }
    console.log(`\n📁 Processing ${channelName} (including archived threads)...`);
    let added = 0, skipped = 0, total = 0;

    // 1. Active threads (they are already not archived)
    const active = await channel.threads.fetchActive();
    for (const thread of active.threads.values()) {
        total++;
        const result = await processThread(thread, emoji);
        if (result.added) added++;
        else if (result.skipped) skipped++;
        await delay(500); // rate limit buffer
    }

    // 2. Archived threads – paginate
    let before = null;
    let hasMore = true;
    while (hasMore) {
        const options = { limit: 100 };
        if (before) options.before = before;
        const archived = await channel.threads.fetchArchived(options);
        
        for (const thread of archived.threads.values()) {
            total++;
            const result = await processThread(thread, emoji);
            if (result.added) added++;
            else if (result.skipped) skipped++;
            await delay(500);
        }
        
        hasMore = archived.hasMore;
        if (hasMore && archived.threads.size > 0) {
            before = archived.threads.last().id;
            console.log(`📄 Fetching next batch of archived threads (before: ${before})...`);
            await delay(1000); // longer delay between batches
        } else {
            break;
        }
    }
    
    console.log(`✅ ${channelName}: added ${added}, skipped ${skipped}, total ${total} threads processed`);
    return { added, skipped, total };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addheart')
        .setDescription('[ONE‑TIME] Unarchive, add ❤️ reaction, then re‑archive all forum posts without any reaction'),

    async execute(interaction) {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator) &&
            interaction.user.id !== interaction.guild.ownerId) {
            return interaction.reply({
                content: 'Only server administrators can run this command.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        await interaction.reply({ content: '🔄 Starting scan (unarchiving threads temporarily)... This will take a while.', flags: [MessageFlags.Ephemeral] });

        let emoji = FALLBACK_HEART;
        try {
            const emojiId = HEART_EMOJI.match(/\d+/)?.[0];
            if (emojiId) {
                const customEmoji = interaction.guild.emojis.cache.get(emojiId);
                if (customEmoji) emoji = HEART_EMOJI;
                else console.warn(`Custom heart emoji not found, using fallback ❤️`);
            }
        } catch (e) {
            console.warn(`Error checking emoji, using fallback:`, e.message);
        }

        try {
            const guild = interaction.guild;
            const preview = await processForum(guild, PREVIEW_FORUM_ID, 'Preview Forum', emoji);
            const supporter = await processForum(guild, SUPPORTER_FORUM_ID, 'Supporter Forum', emoji);

            await interaction.editReply(
                `✅ **Done!**\n` +
                `Preview forum: ${preview.added} hearts added, ${preview.skipped} already had reactions. (${preview.total} total threads processed)\n` +
                `Supporter forum: ${supporter.added} hearts added, ${supporter.skipped} already had reactions. (${supporter.total} total threads processed)\n\n` +
                `All threads were temporarily unarchived and then re‑archived.`
            );
        } catch (err) {
            console.error('AddHeart command error:', err);
            await interaction.editReply(`❌ Error: ${err.message}`);
        }
    }
};
