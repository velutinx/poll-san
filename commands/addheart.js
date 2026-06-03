// commands/addheart.js
const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');

const PREVIEW_FORUM_ID = '1465938599378812980';
const SUPPORTER_FORUM_ID = '1465937644394512516';
const CUSTOM_HEART = '<a:heart:1511391137825558628>';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function processThread(thread, client) {
    try {
        // Fetch starter message (works even if archived)
        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (!starter) return { added: false, reason: 'no_starter' };

        const fullMessage = await starter.fetch();
        
        // Check if bot already has custom heart reaction
        const customReaction = fullMessage.reactions.cache.find(r => r.emoji.toString() === CUSTOM_HEART);
        if (customReaction && customReaction.users.cache.has(client.user.id)) {
            console.log(`✅ Already has custom heart: ${thread.name}`);
            return { added: false, reason: 'already_has_custom' };
        }

        // Check if there are any other reactions (excluding bot's own reactions)
        const otherReactions = fullMessage.reactions.cache.filter(r => !r.users.cache.has(client.user.id));
        if (otherReactions.size > 0) {
            console.log(`⏩ Skipped (has ${otherReactions.size} other reactions): ${thread.name}`);
            return { added: false, reason: 'has_other_reactions' };
        }

        // If we reach here, the post has no reactions (or only bot's default heart which we will remove)
        // Need to unarchive temporarily to modify reactions
        let unarchived = false;
        if (thread.archived) {
            await thread.setArchived(false);
            unarchived = true;
            console.log(`📂 Unarchived: ${thread.name}`);
            await delay(500);
        }

        // Remove any bot reactions (like default heart)
        const botReactions = fullMessage.reactions.cache.filter(r => r.users.cache.has(client.user.id));
        for (const reaction of botReactions.values()) {
            await reaction.users.remove(client.user.id);
            console.log(`🗑️ Removed bot reaction (${reaction.emoji.name}) from ${thread.name}`);
            await delay(300);
        }

        // Add custom heart
        await fullMessage.react(CUSTOM_HEART);
        console.log(`❤️ Added custom heart to ${thread.name}`);

        // Re-archive if we unarchived
        if (unarchived) {
            await thread.setArchived(true);
            console.log(`📦 Re‑archived: ${thread.name}`);
            await delay(300);
        }

        return { added: true, reason: 'added' };
    } catch (err) {
        console.warn(`Error processing ${thread.name}:`, err.message);
        return { added: false, reason: 'error' };
    }
}

async function processForum(guild, channelId, channelName, client) {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isThreadOnly()) {
        console.error(`❌ ${channelName} not a forum`);
        return { added: 0, skipped: 0, total: 0 };
    }
    console.log(`\n📁 Processing ${channelName}...`);
    let added = 0, skipped = 0, total = 0;

    // Active threads (not archived)
    const active = await channel.threads.fetchActive();
    for (const thread of active.threads.values()) {
        total++;
        const res = await processThread(thread, client);
        if (res.added) added++;
        else skipped++;
        await delay(300);
    }

    // Archived threads
    let before = null;
    let hasMore = true;
    while (hasMore) {
        const options = { limit: 100 };
        if (before) options.before = before;
        const archived = await channel.threads.fetchArchived(options);
        for (const thread of archived.threads.values()) {
            total++;
            const res = await processThread(thread, client);
            if (res.added) added++;
            else skipped++;
            await delay(300);
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
        .setDescription('[ONE-TIME] Add animated heart to forum posts without any reactions'),

    async execute(interaction) {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator) &&
            interaction.user.id !== interaction.guild.ownerId) {
            return interaction.reply({
                content: 'Only administrators can run this.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        await interaction.reply({ content: '🔄 Starting – scanning threads...', flags: [MessageFlags.Ephemeral] });

        try {
            const guild = interaction.guild;
            const preview = await processForum(guild, PREVIEW_FORUM_ID, 'Preview Forum', interaction.client);
            const supporter = await processForum(guild, SUPPORTER_FORUM_ID, 'Supporter Forum', interaction.client);

            await interaction.editReply(
                `✅ **Done!**\n` +
                `Preview: ${preview.added} hearts added, ${preview.skipped} skipped. (${preview.total} threads)\n` +
                `Supporter: ${supporter.added} hearts added, ${supporter.skipped} skipped. (${supporter.total} threads)`
            );
        } catch (err) {
            console.error(err);
            await interaction.editReply(`❌ Error: ${err.message}`);
        }
    }
};
