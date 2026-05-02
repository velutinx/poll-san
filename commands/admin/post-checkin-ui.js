// commands/admin/post-checkin-ui.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_checkin_ui')
        .setDescription('[ADMIN] Post the daily check-in message in #check-in'),
    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
        }

        const checkinChannel = interaction.guild.channels.cache.get(helpers.ids.channels.checkin);
        if (!checkinChannel) {
            return interaction.reply({ content: '❌ Check-in channel not found.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor(0x2f3136)
            .setDescription(
                `# 🌟 Daily Check‑In\n\n` +
                `Click the button below to claim your **${helpers.CHECKIN_REWARD_TICKETS} tickets** and reset all your game cooldowns!\n\n` +
                `You can do this once every **24 hours**.`
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('checkin_claim')
                .setLabel('Claim Daily Reward')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🎁')
        );

        let webhook = (await checkinChannel.fetchWebhooks()).find(w => w.name === 'Check in Bot');
        if (!webhook) {
            webhook = await checkinChannel.createWebhook({
                name: 'Check in Bot',
                avatar: helpers.urls.LOGO_URL
            });
        }

        await webhook.send({
            embeds: [embed],
            components: [row],
            username: 'Check in Bot',
            avatarURL: helpers.urls.LOGO_URL
        });

        await interaction.reply({ content: '✅ Daily check-in message posted!', ephemeral: true });
    }
};
