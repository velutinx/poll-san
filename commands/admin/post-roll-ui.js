// commands/admin/post-roll-ui.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_roll_ui')
        .setDescription('[ADMIN] Post the roll button interface (Mudae style)'),
    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: '❌ Admin only.', flags: 64 });
        }

        const rollChannel = interaction.guild.channels.cache.get(helpers.ids.channels.mudae_roll);
        if (!rollChannel) {
            return interaction.reply({ content: '❌ Mudae roll channel not found.', flags: 64 });
        }

        const embed = new EmbedBuilder()
            .setColor(0x2f3136)
            .setDescription(
                '🎲 **Roll for a character!**\n\n' +
                '• Click **Roll** below.\n' +
                '• You have **10 seconds** to claim your roll alone.\n' +
                '• After that, anyone can claim it for the next **4m 50s**.\n' +
                '• Unclaimed rolls are deleted after **5 minutes**.\n' +
                '• You get **5 rolls** and **2 claims** every hour.\n\n' +
                '✅ = claim | ❌ = pass'
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('mudae_roll_start')
                .setLabel('Roll 🎲')
                .setStyle(ButtonStyle.Primary)
        );

        let webhook = (await rollChannel.fetchWebhooks()).find(w => w.name === 'Mudae Preflix');
        if (!webhook) {
            webhook = await rollChannel.createWebhook({
                name: 'Mudae Preflix',
                avatar: 'https://www.velutinx.com/images/LogoDiscord.png'
            });
        }

        await webhook.send({
            embeds: [embed],
            components: [row],
            username: 'Mudae Preflix',
            avatarURL: 'https://www.velutinx.com/images/LogoDiscord.png'
        });

        await interaction.reply({ content: '✅ Roll button posted!', flags: 64 });
    }
};
