// This is poll-san/commands/admin/post-hangman-ui.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_hangman_ui')
        .setDescription('[ADMIN] Posts the Hangman button interface in this channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: '❌ Admin only.', flags: 64 });
        }

        const channel = interaction.channel;

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

        // Use webhook to send as "Play Hangman"
        let webhook = (await channel.fetchWebhooks()).find(w => w.name === 'Play Hangman');
        if (!webhook) {
            webhook = await channel.createWebhook({
                name: 'Play Hangman',
                avatar: 'https://www.velutinx.com/images/LogoDiscord.png'
            });
        }

        await webhook.send({
            embeds: [embed],
            components: [row],
            username: 'Play Hangman',
            avatarURL: 'https://www.velutinx.com/images/LogoDiscord.png'
        });

        await interaction.reply({ content: '✅ Hangman UI posted!', flags: 64 });
    }
};
