// commands/addheart.js
const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const h = require('../utils/helpers');

const PREVIEW_FORUM_ID = '1465938599378812980';
const SUPPORTER_FORUM_ID = '1465937644394512516';
const HEART_EMOJI = '<a:heart:1511391137825558628>'; // fallback to '❤️' if needed

async function addHeartIfNoReactions(message) {
    const fullMessage = await message.fetch();
    if (fullMessage.reactions.cache.size === 0) {
        try {
            await fullMessage.react(HEART_EMOJI);
            console.log(`❤️ Added heart to ${fullMessage.channel.name} (${fullMessage.id})`);
            return true;
        } catch (err) {
            console.warn(`Failed to react to ${fullMessage.id}:`, err.message);
        }
    }
    return false;
}

async function processForum(guild, channelId, channelName) {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isThreadOnly()) {
        console.error(`❌ ${channelName} not found or not a forum`);
        return { added: 0, skipped: 0 };
    }
    console.log(`\n📁 Processing ${channelName}...`);
    let added = 0, skipped = 0;

    // Active threads
    const active = await channel.threads.fetchActive();
    for (const thread of active.threads.values()) {
        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (starter) {
            if (await addHeartIfNoReactions(starter)) added++;
            else skipped++;
        }
    }

    // Archived threads (paginated)
    let archivedCursor = null;
    let hasMore = true;
    while (hasMore) {
        const archived = await channel.threads.fetchArchived({ before: archivedCursor, limit: 100 });
        for (const thread of archived.threads.values()) {
            const starter = await thread.fetchStarterMessage().catch(() => null);
            if (starter) {
                if (await addHeartIfNoReactions(starter)) added++;
                else skipped++;
            }
        }
        archivedCursor = archived.threads.last()?.id;
        hasMore = archived.hasMore;
        if (archivedCursor && hasMore) await new Promise(r => setTimeout(r, 500)); // rate limit
    }
    console.log(`✅ ${channelName}: added ${added}, skipped ${skipped}`);
    return { added, skipped };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addheart')
        .setDescription('[ONE-TIME] Add heart reactions to all forum posts without any reaction'),

    async execute(interaction) {
        // Restrict to server owner or admins
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator) &&
            interaction.user.id !== interaction.guild.ownerId) {
            return interaction.reply({
                content: 'Only server administrators can run this command.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        await interaction.reply({ content: '🔄 Starting scan... This may take a while.', flags: [MessageFlags.Ephemeral] });

        try {
            const guild = interaction.guild;
            const previewResult = await processForum(guild, PREVIEW_FORUM_ID, 'Preview Forum');
            const supporterResult = await processForum(guild, SUPPORTER_FORUM_ID, 'Supporter Forum');

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
