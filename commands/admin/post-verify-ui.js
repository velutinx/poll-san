// commands/admin/post-verify-ui.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_verify_ui')
        .setDescription('[ADMIN] Post the Turnstile verification message'),
    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
        }

        const verifyChannel = interaction.guild.channels.cache.get(helpers.ids.channels.verify);
        if (!verifyChannel) {
            return interaction.reply({ content: '❌ Verify channel not found.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor(0x2f3136)
            .setDescription(
                `# Welcome To Your Community\n\n` +
                `To unlock full server access, click the **Verify** button below.\n` +
                `You will receive a unique link to complete the CAPTCHA in your browser.\n\n` +
                `See you in there...`
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('verify_start')
                .setLabel('Verify')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔒')
        );

        // Use webhook to send as "Verification Bot"
        let webhook = (await verifyChannel.fetchWebhooks()).find(w => w.name === 'Verification Bot');
        if (!webhook) {
            webhook = await verifyChannel.createWebhook({
                name: 'Verification Bot',
                avatar: helpers.urls.LOGO_URL   // <-- centralized constant
            });
        }

        // Send the message and capture the sent message object
        const sentMessage = await webhook.send({
            embeds: [embed],
            components: [row],
            username: 'Verification Bot',
            avatarURL: helpers.urls.LOGO_URL   // <-- centralized constant
        });

        // Add the VERIFY emoji reaction to the message we just posted
        const verifyEmoji = helpers.releaseEmojis.VERIFY; // '<a:Verify:1491669023245729924>'
        try {
            await sentMessage.react(verifyEmoji);
        } catch (err) {
            console.error('Failed to add reaction:', err);
        }
        await interaction.reply({ content: '✅ Verification message posted!', flags: 64 });
    }
};
