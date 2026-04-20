// commands/admin/post-verify-ui.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_verify_ui')
        .setDescription('[ADMIN] Post the verification message in #verify'),
    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
        }

        const verifyChannel = interaction.guild.channels.cache.get(helpers.ids.channels.verify);
        if (!verifyChannel) {
            return interaction.reply({ content: '❌ Verify channel not found. Check helpers.ids.channels.verify', ephemeral: true });
        }

        // Find or create a webhook named "Verification Bot"
        let webhook = (await verifyChannel.fetchWebhooks()).find(w => w.name === 'Verification Bot');
        if (!webhook) {
            webhook = await verifyChannel.createWebhook({
                name: 'Verification Bot',
                avatar: 'https://www.velutinx.com/images/LogoDiscord.png'
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x2f3136)
            .setDescription(
                `# Welcome To Your Community\n\n` +
                `To unlock full server access please click the button below.\n\n` +
                `See you in there...`
            );
        // No .setImage() here – that was causing the extra image inside the embed

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('verify_modal_btn')
                .setLabel('Verify')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✅')
        );

        // Send the message using the webhook
        await webhook.send({
            embeds: [embed],
            components: [row],
            username: 'Verification Bot',
            avatarURL: 'https://www.velutinx.com/images/LogoDiscord.png'
        });

        await interaction.reply({ content: '✅ Verification message posted via **Verification Bot** webhook!', ephemeral: true });
    }
};
