// This is poll-san/commands/admin/post-slots-ui.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_slots_ui')
        .setDescription('[ADMIN] Posts the slot machine button interface in this channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🎰 Ticket Slot Machine')
            .setDescription('Click a button below to spin the slots!\n\n**Payouts:**\n💎💎💎 = **10x**\n🍒🍒🍒 = **2x**\nAny pair = **0.5x**')
            .setColor('#FFD700');

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('slots_bet_1')
                    .setLabel('Spin 1🎟️')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('slots_bet_5')
                    .setLabel('Spin 5🎟️')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('slots_bet_25')
                    .setLabel('Spin 25🎟️')
                    .setStyle(ButtonStyle.Primary)
            );

        await interaction.channel.send({
            embeds: [embed],
            components: [row]
        });

        await interaction.reply({ content: '✅ Slots UI has been posted!', flags: MessageFlags.Ephemeral });
    }
};
