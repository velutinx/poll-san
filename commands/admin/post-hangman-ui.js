// commands/admin/post-hangman-ui.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_hangman_ui')
        .setDescription('[ADMIN] Posts the Hangman button interface in this channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🎮 Hangman')
            .setDescription('Click the button below to start a private game of Hangman!\n\nGuess the word before the stick figure is complete.')
            .setColor('#FFD700');

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('hangman_start_button')
                    .setLabel('Play Hangman')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🎯')
            );

        await interaction.channel.send({
            embeds: [embed],
            components: [row]
        });

        await interaction.reply({ content: '✅ Hangman UI has been posted!', flags: MessageFlags.Ephemeral });
    }
};
