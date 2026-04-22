// commands/admin/post-checkin-ui.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_checkin_ui')
        .setDescription('[ADMIN] Post the daily check-in message in #check-in (and add reaction to verify message)'),
    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
        }

        // --- 1. Post the check-in message (original functionality) ---
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
                avatar: 'https://www.velutinx.com/images/LogoDiscord.png'
            });
        }

        await webhook.send({
            embeds: [embed],
            components: [row],
            username: 'Check in Bot',
            avatarURL: 'https://www.velutinx.com/images/LogoDiscord.png'
        });

        // --- 2. Add VERIFY reaction to the target message in verify channel (one-time) ---
        const verifyChannelId = helpers.ids.channels.verify; // 1495679452489977897
        const targetMessageId = '1495692823603839018';
        const emoji = helpers.releaseEmojis.VERIFY; // '<a:Verify:1491669023245729924>'

        let reactionResult = '';
        try {
            const verifyChannel = interaction.guild.channels.cache.get(verifyChannelId);
            if (verifyChannel) {
                const targetMsg = await verifyChannel.messages.fetch(targetMessageId);
                await targetMsg.react(emoji);
                reactionResult = `\n✅ Also added reaction ${emoji} to message ${targetMessageId} in <#${verifyChannelId}>.`;
            } else {
                reactionResult = `\n⚠️ Verify channel not found – could not add reaction.`;
            }
        } catch (err) {
            reactionResult = `\n⚠️ Failed to add reaction: ${err.message}`;
        }

        await interaction.reply({
            content: `✅ Daily check-in message posted!${reactionResult}`,
            ephemeral: true
        });
    }
};
