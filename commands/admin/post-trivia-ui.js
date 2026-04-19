// This is poll-san/commands/admin/post-trivia-ui.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const h = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_trivia_ui')
        .setDescription('[ADMIN] Posts the Quick-Start Trivia button.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🎲 Anime Trivia — Hard Mode')
            .setDescription('Click the button below to start a 5-round Hard difficulty trivia game!')
            .setColor('#9B59B6');

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('trivia_start_hard')
                    .setLabel('Start Trivia Session')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🎲')
            );

        await interaction.channel.send({
            embeds: [embed],
            components: [row]
        });

        await interaction.reply({ content: '✅ Trivia quick-start button has been posted!', flags: MessageFlags.Ephemeral });
    }
};
