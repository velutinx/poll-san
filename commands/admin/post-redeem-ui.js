// commands/admin/post-redeem-ui.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_redeem_ui')
        .setDescription('[ADMIN] Post the Redeem Shop interface in this channel.'),

    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
        }

        const channel = interaction.channel;

        const embed = new EmbedBuilder()
            .setColor('#B68BEC')
            .setTitle('🎁 Request a Character')
            .setDescription(
                `Spend **300 tickets** to request a character from a series you already own.\n\n` +
                `Click the button below to begin!`
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('redeem_start')
                .setLabel('Request a Character')
                .setStyle(ButtonStyle.Primary)
        );

        let webhook = (await channel.fetchWebhooks()).find(w => w.name === 'Redeem');
        if (!webhook) {
            webhook = await channel.createWebhook({
                name: 'Redeem',
                avatar: helpers.urls.LOGO_URL
            });
        }

        await webhook.send({
            embeds: [embed],
            components: [row],
            username: 'Redeem',
            avatarURL: helpers.urls.LOGO_URL
        });

        await interaction.reply({ content: '✅ Redeem UI posted!', ephemeral: true });
    }
};
