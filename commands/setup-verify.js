// This is poll-san/commands/setup-verify.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const helpers = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-verify')
        .setDescription('Post the verification message (admin only)'),
    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: 'You need admin rights.', ephemeral: true });
        }

        const verifyChannel = interaction.guild.channels.cache.get(helpers.ids.channels.verify);
        if (!verifyChannel) return interaction.reply('Verify channel not found!', { ephemeral: true });

        const embed = new EmbedBuilder()
            .setColor(0x2f3136)
            .setDescription(
                `# Welcome To Your Community\n\n` +
                `To unlock full server access please click the button below.\n\n` +
                `See you in there...`
            )
            .setImage('https://cdn.discordapp.com/attachments/1163490254221738015/1167472390213730335/Embed_Extender_Invisible_Space.png');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('verify_modal_btn')
                .setLabel('Verify')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✅')
        );

        await verifyChannel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: 'Verification message posted!', flags: 64 });
    }
};
