const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');

const PREVIEW_FORUM_ID = '1465938599378812980';
const SUPPORTER_FORUM_ID = '1465937644394512516';
const CUSTOM_HEART = '<a:heart:1511391137825558628>';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function processThread(thread, client) {
    let unarchived = false;
    try {
        // Check if thread is archived – we need to unarchive to modify reactions
        if (thread.archived) {
            await thread.setArchived(false);
            unarchived = true;
            console.log(`📂 Unarchived: ${thread.name}`);
            await delay(500);
        }

        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (!starter) return { removed: false, reason: 'no_starter' };

        const fullMessage = await starter.fetch();
        
        // Find bot's custom heart reaction
        const heartReaction = fullMessage.reactions.cache.find(r => r.emoji.toString() === CUSTOM_HEART);
        if (!heartReaction) return { removed: false, reason: 'no_heart' };
        
        // Check if bot has the heart reaction
        const botHasHeart = heartReaction.users.cache.has(client.user.id);
        if (!botHasHeart) return { removed: false, reason: 'bot_not_reacted' };
        
        // Check if there are any other reactions (excluding bot's own reactions)
        const otherReactions = fullMessage.reactions.cache.filter(r => !r.users.cache.has(client.user.id));
        if (otherReactions.size === 0) {
            // Heart is the only reaction – keep it
            return { removed: false, reason: 'only_heart' };
        }
        
        // Remove the bot's heart reaction
        await heartReaction.users.remove(client.user.id);
        console.log(`🗑️ Removed heart from ${thread.name} (has ${otherReactions.size} other reactions)`);
        return { removed: true, reason: 'removed_other_reactions' };
        
    } catch (err) {
        console.warn(`Error processing ${thread.name}:`, err.message);
        return { removed: false, reason: 'error' };
    } finally {
        if (unarchived) {
            try {
                await thread.setArchived(true);
                console.log(`📦 Re‑archived: ${thread.name}`);
            } catch (e) {
                console.warn(`Could not re‑archive ${thread.name}:`, e.message);
            }
            await delay(300);
        }
    }
}

async function processForum(guild, channelId, channelName, client) {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isThreadOnly()) {
        console.error(`❌ ${channelName} not a forum`);
        return { removed: 0, total: 0 };
    }
    console.log(`\n📁 Processing ${channelName}...`);
    let removed = 0, total = 0;

    // Active threads (not archived)
    const active = await channel.threads.fetchActive();
    for (const thread of active.threads.values()) {
        total++;
        const res = await processThread(thread, client);
        if (res.removed) removed++;
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
            if (res.removed) removed++;
            await delay(300);
        }
        hasMore = archived.hasMore;
        if (hasMore && archived.threads.size) {
            before = archived.threads.last().id;
            await delay(1000);
        } else break;
    }
    console.log(`✅ ${channelName}: removed ${removed} hearts, total ${total} threads`);
    return { removed, total };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fixheart')
        .setDescription('[ONE-TIME] Remove animated heart from posts that have other reactions'),

    async execute(interaction) {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator) &&
            interaction.user.id !== interaction.guild.ownerId) {
            return interaction.reply({
                content: 'Only administrators can run this.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        await interaction.reply({ content: '🔄 Scanning and fixing hearts...', flags: [MessageFlags.Ephemeral] });

        try {
            const guild = interaction.guild;
            const preview = await processForum(guild, PREVIEW_FORUM_ID, 'Preview Forum', interaction.client);
            const supporter = await processForum(guild, SUPPORTER_FORUM_ID, 'Supporter Forum', interaction.client);

            await interaction.editReply(
                `✅ **Done!**\n` +
                `Preview: removed ${preview.removed} hearts from posts with other reactions (${preview.total} threads)\n` +
                `Supporter: removed ${supporter.removed} hearts (${supporter.total} threads)`
            );
        } catch (err) {
            console.error(err);
            await interaction.editReply(`❌ Error: ${err.message}`);
        }
    }
};
