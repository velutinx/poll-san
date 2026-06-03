const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');

const AUDIT_CHANNEL_ID = '1494737302260551822';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cleanarchive')
        .setDescription('[ONE-TIME] Delete all "Thread archived/unarchived" messages in audit channel'),

    async execute(interaction) {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator) &&
            interaction.user.id !== interaction.guild.ownerId) {
            return interaction.reply({
                content: 'Only administrators can run this.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        await interaction.reply({ content: '🔄 Scanning and deleting messages... This may take a while.', flags: [MessageFlags.Ephemeral] });

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

            // Match messages that contain either phrase (plain text or embed title)
            const toDelete = messages.filter(msg => 
                msg.content.includes('Thread archived') || 
                msg.content.includes('Thread unarchived') ||
                (msg.embeds.length > 0 && 
                 (msg.embeds[0].title?.includes('Thread archived') || 
                  msg.embeds[0].title?.includes('Thread unarchived')))
            );

            for (const msg of toDelete.values()) {
                await msg.delete().catch(e => console.warn(`Failed to delete ${msg.id}:`, e.message));
                deletedCount++;
                await new Promise(r => setTimeout(r, 200)); // rate limit delay
            }

            fetched += messages.size;
            lastId = messages.last().id;

            if (messages.size < 100) break;
        }

        await interaction.editReply(`✅ Deleted ${deletedCount} archive/unarchive messages.`);
    }
};
