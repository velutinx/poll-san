const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');

const AUDIT_CHANNEL_ID = '1494737302260551822';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cleanarchive')
        .setDescription('[ONE-TIME] Bulk delete all "Thread archived/unarchived" messages in audit channel'),

    async execute(interaction) {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator) &&
            interaction.user.id !== interaction.guild.ownerId) {
            return interaction.reply({
                content: 'Only administrators can run this.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        await interaction.reply({ content: '🔄 Bulk deleting archive/unarchive messages... This may take a minute.', flags: [MessageFlags.Ephemeral] });

        const channel = interaction.guild.channels.cache.get(AUDIT_CHANNEL_ID);
        if (!channel) {
            return interaction.editReply('❌ Audit channel not found.');
        }

        let deletedCount = 0;
        let lastId = null;
        let fetched = 0;

        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;

            // Filter messages containing the target phrases (case-insensitive)
            const toDelete = messages.filter(msg => 
                msg.content.toLowerCase().includes('thread archived') || 
                msg.content.toLowerCase().includes('thread unarchived') ||
                (msg.embeds.length > 0 && 
                 (msg.embeds[0].title?.toLowerCase().includes('thread archived') || 
                  msg.embeds[0].title?.toLowerCase().includes('thread unarchived')))
            );

            if (toDelete.size > 0) {
                // Bulk delete (works for messages older than 14 days? Yes, as long as you have permission)
                // Note: bulkDelete only works for messages less than 14 days old.
                // For older messages, we need to delete individually.
                // But Discord API allows bulkDelete only for messages under 14 days.
                // Since some might be older, we'll use a mix: try bulk, fallback to individual.
                try {
                    await channel.bulkDelete(toDelete);
                    deletedCount += toDelete.size;
                    console.log(`🗑️ Bulk deleted ${toDelete.size} messages`);
                } catch (err) {
                    // If bulkDelete fails (e.g., messages >14 days), delete one by one
                    console.warn('Bulk delete failed, falling back to individual deletions:', err.message);
                    for (const msg of toDelete.values()) {
                        await msg.delete().catch(e => console.warn(`Failed to delete ${msg.id}:`, e.message));
                        deletedCount++;
                        await new Promise(r => setTimeout(r, 200));
                    }
                }
                await new Promise(r => setTimeout(r, 500)); // slight delay between batches
            }

            fetched += messages.size;
            lastId = messages.last().id;

            if (messages.size < 100) break;
        }

        await interaction.editReply(`✅ Deleted ${deletedCount} archive/unarchive messages.`);
    }
};
