// This is poll-san/commands/admin/post-slots-ui.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_slots_ui')
        .setDescription('[ADMIN] Posts the slot machine button interface in this channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🎰 Ticket Slot Machine')
            .setDescription('Click the button below to spin the slots!\n\n**Payouts:**\n💎💎💎 = **10x**\n🍒🍒🍒 = **2x**\nAny pair = **0.5x**')
            .setColor('#FFD700');

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('slots_spin_button')
                    .setLabel('Spin')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🎰')
            );

        await interaction.channel.send({
            embeds: [embed],
            components: [row]
        });

        await interaction.reply({ content: '✅ Slots UI has been posted!', flags: { ephemeral: true } });
    }
};
