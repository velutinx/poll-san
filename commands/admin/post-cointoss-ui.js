// commands/admin/post-cointoss-ui.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_cointoss_ui')
        .setDescription('[ADMIN] Post the Coin Toss game interface'),
    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: '❌ Admin only.', flags: 64 });
        }

        const embed = new EmbedBuilder()
            .setColor(0x2f3136)
            .setDescription(
                `# 🪙 Coin Toss\n\n` +
                `Click a bet button below to toss a coin!\n` +
                `If it lands **🪙 Heads**, you win the bet amount!\n` +
                `If it lands **🪙 Tails**, you lose the bet.\n\n` +
            );

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('cointoss_bet_1')
                    .setLabel('Toss 1 🎟️')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('cointoss_bet_5')
                    .setLabel('Toss 5 🎟️')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('cointoss_bet_25')
                    .setLabel('Toss 25 🎟️')
                    .setStyle(ButtonStyle.Primary)
            );

        // Use webhook to send as "Coin Toss"
        let webhook = (await interaction.channel.fetchWebhooks()).find(w => w.name === 'Coin Toss');
        if (!webhook) {
            webhook = await interaction.channel.createWebhook({
                name: 'Coin Toss',
                avatar: 'https://www.velutinx.com/images/LogoDiscord.png'
            });
        }

        await webhook.send({
            embeds: [embed],
            components: [row],
            username: 'Coin Toss',
            avatarURL: 'https://www.velutinx.com/images/LogoDiscord.png'
        });

        await interaction.reply({ content: '✅ Coin Toss game posted!', flags: 64 });
    }
};
