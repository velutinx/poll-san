// commands/admin/post-checkin-ui.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_checkin_ui')
        .setDescription('[ADMIN] Post the daily check-in message in #check-in'),
    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({
                content: `${helpers.releaseEmojis?.BATSU || '❌'} Admin only.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const checkinChannel = interaction.guild.channels.cache.get(helpers.ids.channels.checkin);
        if (!checkinChannel) {
            return interaction.reply({
                content: `${helpers.releaseEmojis?.BATSU || '❌'} Check-in channel not found.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x2f3136)
            .setDescription(
                `# ${helpers.releaseEmojis?.STAR || '🌟'} Daily Check‑In\n\n` +
                `Click the button below to claim your **${helpers.CHECKIN_REWARD_TICKETS} tickets** and reset all your game cooldowns!\n\n` +
                `You can do this once every **24 hours**.`
            );

        // Random animated present for the button
        const presentEmojiStr = helpers.getRandomPresent();
        const match = presentEmojiStr.match(/^<a?:(\w+):(\d+)>$/);
        const emojiData = match ? { name: match[1], id: match[2] } : { name: '🎁' };

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('checkin_claim')
                .setLabel('Claim Daily Reward')
                .setStyle(ButtonStyle.Success)
                .setEmoji(emojiData)
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

        await interaction.reply({
            content: `${helpers.releaseEmojis?.getRandomVerify?.() || '✅'} Daily check-in message posted!`,
            flags: MessageFlags.Ephemeral
        });
    }
};
