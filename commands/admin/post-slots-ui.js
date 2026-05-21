// commands/admin/post-slots-ui.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_slots_ui')
        .setDescription('[ADMIN] Posts the slot machine button interface in this channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: `${helpers.releaseEmojis.BATSU} Admin only.`, flags: 64 });
        }

        const channel = interaction.channel;

        const embed = new EmbedBuilder()
            .setTitle('🎰 Ticket Slot Machine')
            .setDescription(
                'Click a button below to spin the slots!\n\n' +
                '**Winning Combinations:**\n' +
                '• 🍒🍒🍒 = **2x** your bet\n' +
                '• 🍋🍋🍋 = **3x** your bet\n' +
                '• 🍊🍊🍊 = **5x** your bet\n' +
                '• 💎💎💎 = **10x** your bet\n' +
                '• 7️⃣7️⃣7️⃣ = **50x** your bet (jackpot!)\n' +
                '• Any pair (two identical symbols) = **0.8x** your bet (you get 80% back)\n\n' +
                '**Good luck!**'
            )
            .setColor('#FFD700');

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('slots_bet_1')
                    .setLabel('Spin 1 🎟️')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('slots_bet_5')
                    .setLabel('Spin 5 🎟️')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('slots_bet_25')
                    .setLabel('Spin 25 🎟️')
                    .setStyle(ButtonStyle.Primary)
            );

        // Use webhook to send as "Slots"
        let webhook = (await channel.fetchWebhooks()).find(w => w.name === 'Slots');
        if (!webhook) {
            webhook = await channel.createWebhook({
                name: 'Slots',
                avatar: helpers.urls.LOGO_URL
            });
        }

        await webhook.send({
            embeds: [embed],
            components: [row],
            username: 'Slots',
            avatarURL: helpers.urls.LOGO_URL
        });

        await interaction.reply({ content: '✅ Slots UI has been posted!', flags: 64 });
    }
};
