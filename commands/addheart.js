// commands/addheart.js
const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');

const PREVIEW_FORUM_ID = '1465938599378812980';
const SUPPORTER_FORUM_ID = '1465937644394512516';
const HEART_EMOJI = '<a:heart:1511391137825558628>';
const FALLBACK_HEART = '❤️';

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

async function processForum(guild, channelId, channelName, emoji) {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isThreadOnly()) {
        console.error(`❌ ${channelName} not found or not a forum`);
        return { added: 0, skipped: 0 };
    }
    console.log(`\n📁 Processing ${channelName}...`);
    let added = 0, skipped = 0;

    // 1. Active threads
    const active = await channel.threads.fetchActive();
    for (const thread of active.threads.values()) {
        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (starter) {
            if (await addHeartIfNoReactions(starter, emoji)) added++;
            else skipped++;
        }
        await new Promise(r => setTimeout(r, 300)); // delay between posts
    }

    // 2. Archived threads – paginate correctly
    let before = null;
    let hasMore = true;
    while (hasMore) {
        const options = { limit: 100 };
        if (before) options.before = before;
        const archived = await channel.threads.fetchArchived(options);
        
        for (const thread of archived.threads.values()) {
            const starter = await thread.fetchStarterMessage().catch(() => null);
            if (starter) {
                if (await addHeartIfNoReactions(starter, emoji)) added++;
                else skipped++;
            }
            await new Promise(r => setTimeout(r, 300));
        }
        
        hasMore = archived.hasMore;
        if (hasMore && archived.threads.size > 0) {
            before = archived.threads.last().id;
            console.log(`📄 Fetching next batch of archived threads (before: ${before})...`);
            await new Promise(r => setTimeout(r, 1000)); // longer delay between batches
        } else {
            break;
        }
    }
    
    console.log(`✅ ${channelName}: added ${added}, skipped ${skipped}`);
    return { added, skipped };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addheart')
        .setDescription('[ONE-TIME] Add heart reactions to all forum posts without any reaction'),

    async execute(interaction) {
        // Only allow admins or server owner
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator) &&
            interaction.user.id !== interaction.guild.ownerId) {
            return interaction.reply({
                content: 'Only server administrators can run this command.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        await interaction.reply({ content: '🔄 Starting scan... This may take a while.', flags: [MessageFlags.Ephemeral] });

        // Determine which heart emoji to use (fallback if custom not found)
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
            const previewResult = await processForum(guild, PREVIEW_FORUM_ID, 'Preview Forum', emoji);
            const supporterResult = await processForum(guild, SUPPORTER_FORUM_ID, 'Supporter Forum', emoji);

            await interaction.editReply(
                `✅ **Done!**\n` +
                `Preview forum: ${previewResult.added} hearts added, ${previewResult.skipped} already had reactions.\n` +
                `Supporter forum: ${supporterResult.added} hearts added, ${supporterResult.skipped} already had reactions.`
            );
        } catch (err) {
            console.error('AddHeart command error:', err);
            await interaction.editReply(`❌ Error: ${err.message}`);
        }
    }
};
