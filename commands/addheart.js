// commands/addheart.js
const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');

const PREVIEW_FORUM_ID = '1465938599378812980';
const SUPPORTER_FORUM_ID = '1465937644394512516';
const CUSTOM_HEART = '<a:heart:1511391137825558628>';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function processThread(thread, client) {
    let unarchived = false;
    try {
        if (thread.archived) {
            await thread.setArchived(false);
            unarchived = true;
            console.log(`📂 Unarchived: ${thread.name}`);
            await delay(500);
        }

        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (!starter) return { added: false, reason: 'no_starter' };

        const fullMessage = await starter.fetch();
        
        // Check if the bot already reacted with the custom heart
        const customReaction = fullMessage.reactions.cache.find(r => r.emoji.toString() === CUSTOM_HEART);
        if (customReaction && customReaction.users.cache.has(client.user.id)) {
            console.log(`✅ Already has custom heart: ${thread.name}`);
            return { added: false, reason: 'already_has_custom' };
        }

        // Remove any bot reactions (including default heart)
        const botReactions = fullMessage.reactions.cache.filter(r => r.users.cache.has(client.user.id));
        for (const reaction of botReactions.values()) {
            await reaction.users.remove(client.user.id);
            console.log(`🗑️ Removed bot reaction (${reaction.emoji.name}) from ${thread.name}`);
            await delay(300);
        }

        // After removal, check if there are any other reactions (from users or other bots)
        const remaining = fullMessage.reactions.cache.filter(r => r.users.cache.size > 0);
        if (remaining.size === 0) {
            await fullMessage.react(CUSTOM_HEART);
            console.log(`❤️ Added custom heart to ${thread.name}`);
            return { added: true, reason: 'added' };
        } else {
            console.log(`⏩ Skipped (has ${remaining.size} other reactions): ${thread.name}`);
            return { added: false, reason: 'has_other_reactions' };
        }
    } catch (err) {
        console.warn(`Error processing ${thread.name}:`, err.message);
        return { added: false, reason: 'error' };
    } finally {
        if (unarchived) {
            try {
                await thread.setArchived(true);
                console.log(`📦 Re‑archived: ${thread.name}`);
            } catch (e) {}
            await delay(300);
        }
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

    // Active threads
    const active = await channel.threads.fetchActive();
    for (const thread of active.threads.values()) {
        total++;
        const res = await processThread(thread, client);
        if (res.added) added++;
        else skipped++;
        await delay(500);
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
        .setDescription('[ONE-TIME] Add animated heart to forum posts without any reactions'),

    async execute(interaction) {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator) &&
            interaction.user.id !== interaction.guild.ownerId) {
            return interaction.reply({
                content: 'Only administrators can run this.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Verify custom emoji exists
        const emojiId = CUSTOM_HEART.match(/\d+/)?.[0];
        if (!emojiId || !interaction.guild.emojis.cache.has(emojiId)) {
            return interaction.reply({
                content: '❌ Custom animated heart emoji not found in this server. Please add it first.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        await interaction.reply({ content: '🔄 Starting – unarchiving threads, adding animated hearts...', flags: [MessageFlags.Ephemeral] });

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
