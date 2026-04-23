// commands/admin/post-roll-ui.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_roll_ui')
        .setDescription('[ADMIN] Post test button'),
    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: '❌ Admin only.', flags: 64 });
        }

        const rollChannel = interaction.guild.channels.cache.get(helpers.ids.channels.mudae_roll);
        if (!rollChannel) {
            return interaction.reply({ content: '❌ Channel not found.', flags: 64 });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('test_button')
                .setLabel('Test')
                .setStyle(ButtonStyle.Primary)
        );

        await rollChannel.send({ components: [row], content: 'Click me' });
        await interaction.reply({ content: 'Test button posted!', flags: 64 });
    }
};
