// commands/admin/resend-giveaway.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resend_giveaway')
        .setDescription('[ADMIN] Resend the winners message for the last ended giveaway')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        // Defer to avoid timeout
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.editReply({ content: 'Admin only.' });
        }

        const channelId = '1472450019067171008';
        let channel;
        try {
            channel = await interaction.guild.channels.fetch(channelId);
        } catch (err) {
            console.error('Failed to fetch channel:', err);
            return interaction.editReply({ content: `❌ Channel not found: ${err.message}` });
        }
        if (!channel) {
            return interaction.editReply({ content: '❌ Channel not found.' });
        }

        // Helper: get or create webhook (logs if created)
        async function getGiveawayWebhook(ch) {
            const webhooks = await ch.fetchWebhooks();
            let webhook = webhooks.find(w => w.name === 'Giveaway');
            if (!webhook) {
                console.log('Creating new Giveaway webhook...');
                webhook = await ch.createWebhook({
                    name: 'Giveaway',
                    avatar: helpers.urls.LOGO_URL
                });
            }
            return webhook;
        }

        try {
            const webhook = await getGiveawayWebhook(channel);
            await webhook.send({
                content: '🎉 Giveaway ended! Winners:\n🥇 <@1057556464090226742>\n🥈 <@505421783252598826>\n🥉 <@1491237574637785249>',
                username: 'Giveaway',
                avatarURL: helpers.urls.LOGO_URL
            });
            await interaction.editReply({ content: '✅ Winners re‑announced!' });
        } catch (err) {
            console.error('Error sending via webhook:', err);
            await interaction.editReply({ content: `❌ Failed to send: ${err.message}` });
        }
    }
};
