// commands/addheart.js
const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');

const PREVIEW_FORUM_ID = '1465938599378812980';
const SUPPORTER_FORUM_ID = '1465937644394512516';
const CUSTOM_HEART_EMOJI = '<a:heart:1511391137825558628>';
const DEFAULT_HEART = '❤️';
const FALLBACK_EMOJI = '❤️'; // if custom not found

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function processThread(thread, client, customEmoji) {
    let unarchived = false;
    try {
        if (thread.archived) {
            await thread.setArchived(false);
            unarchived = true;
            console.log(`📂 Unarchived: ${thread.name}`);
            await delay(500);
        }

        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (!starter) return { added: false, skipped: true };

        // Fetch full message to get reactions
        const fullMessage = await starter.fetch();
        const botReactions = fullMessage.reactions.cache.filter(r => 
            r.users.cache.has(client.user.id)
        );

        // Check if bot already reacted with default heart
        const defaultHeartReaction = botReactions.find(r => r.emoji.name === DEFAULT_HEART || r.emoji.name === 'heart');
        if (defaultHeartReaction) {
            // Remove the default heart reaction
            await defaultHeartReaction.users.remove(client.user.id);
            console.log(`🗑️ Removed default heart from ${thread.name}`);
            await delay(300);
        }

        // Now check if there are any reactions left (excluding bot's custom heart maybe)
        const remainingReactions = fullMessage.reactions.cache.filter(r => 
            !(r.users.cache.has(client.user.id) && r.emoji.toString() === customEmoji)
        );
        if (remainingReactions.size === 0) {
            // No other reactions → add custom heart
            await fullMessage.react(customEmoji);
            console.log(`❤️ Added custom heart to ${thread.name}`);
            return { added: true, skipped: false };
        } else {
            console.log(`⏩ Skipped (has ${remainingReactions.size} other reactions): ${thread.name}`);
            return { added: false, skipped: true };
        }
    } catch (err) {
        console.warn(`Error processing ${thread.name}:`, err.message);
        return { added: false, skipped: false };
    } finally {
        if (unarchived) {
            try {
                await thread.setArchived(true);
                console.log(`📦 Re‑archived: ${thread.name}`);
            } catch (e) { /* ignore */ }
            await delay(300);
        }
    }
}

async function processForum(guild, channelId, channelName, client, customEmoji) {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isThreadOnly()) {
        console.error(`❌ ${channelName} not a forum`);
        return { added: 0, skipped: 0, total: 0 };
    }
    console.log(`\n📁 Processing ${channelName}...`);
    let added = 0, skipped = 0, total = 0;

    // Active threads
    const active = await channel.threads.fetchActive();
    for (const thread of active.threads.values()) {
        total++;
        const res = await processThread(thread, client, customEmoji);
        if (res.added) added++;
        else if (res.skipped) skipped++;
        await delay(500);
    }

    // Archived threads (paginated)
    let before = null;
    let hasMore = true;
    while (hasMore) {
        const options = { limit: 100 };
        if (before) options.before = before;
        const archived = await channel.threads.fetchArchived(options);
        for (const thread of archived.threads.values()) {
            total++;
            const res = await processThread(thread, client, customEmoji);
            if (res.added) added++;
            else if (res.skipped) skipped++;
            await delay(500);
        }
        hasMore = archived.hasMore;
        if (hasMore && archived.threads.size) {
            before = archived.threads.last().id;
            await delay(1000);
        } else break;
    }
    console.log(`✅ ${channelName}: added ${added}, skipped ${skipped}, total ${total}`);
    return { added, skipped, total };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addheart')
        .setDescription('[ONE‑TIME] Replace default heart with animated heart on all forum posts'),

    async execute(interaction) {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator) &&
            interaction.user.id !== interaction.guild.ownerId) {
            return interaction.reply({
                content: 'Only administrators can run this.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        await interaction.reply({ content: '🔄 Starting – unarchiving threads, replacing hearts...', flags: [MessageFlags.Ephemeral] });

        // Determine custom emoji availability
        let customEmoji = FALLBACK_EMOJI;
        const emojiId = CUSTOM_HEART_EMOJI.match(/\d+/)?.[0];
        if (emojiId) {
            const emoji = interaction.guild.emojis.cache.get(emojiId);
            if (emoji) customEmoji = CUSTOM_HEART_EMOJI;
            else console.warn('Custom heart not found, using default ❤️');
        }

        try {
            const guild = interaction.guild;
            const preview = await processForum(guild, PREVIEW_FORUM_ID, 'Preview Forum', interaction.client, customEmoji);
            const supporter = await processForum(guild, SUPPORTER_FORUM_ID, 'Supporter Forum', interaction.client, customEmoji);

            await interaction.editReply(
                `✅ **Done!**\n` +
                `Preview: ${preview.added} hearts added, ${preview.skipped} already had other reactions. (${preview.total} threads)\n` +
                `Supporter: ${supporter.added} hearts added, ${supporter.skipped} already had other reactions. (${supporter.total} threads)\n\n` +
                `Replaced default heart with animated heart where applicable.`
            );
        } catch (err) {
            console.error(err);
            await interaction.editReply(`❌ Error: ${err.message}`);
        }
    }
};
