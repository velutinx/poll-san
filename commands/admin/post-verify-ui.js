// commands/admin/post-verify-ui.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_verify_ui')
        .setDescription('[ADMIN] Post the Turnstile verification message'),
    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: '❌ Admin only.', flags: 64 });
        }

        const verifyChannel = interaction.guild.channels.cache.get(helpers.ids.channels.verify);
        if (!verifyChannel) {
            return interaction.reply({ content: '❌ Verify channel not found.', flags: 64 });
        }

        // ... (embed code remains the same) ...
        const embed = new EmbedBuilder()
            .setColor(0x2f3136)
            .setDescription(
                `# Welcome To Your Community\n\n` +
                `To unlock full server access, click the **Verify** button below.\n` +
                `You will be taken to a secure page to complete the CAPTCHA.\n\n` +
                `See you in there...`
            );

        // --- Build the Link Button ---
        // Construct the URL that includes the user's specific ID and the server's ID.
        const workerUrl = 'https://verify-captcha.velutinx.workers.dev';
        const uniqueUrl = `${workerUrl}?user=${interaction.user.id}&guild=${interaction.guild.id}`;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Verify with CAPTCHA')
                .setStyle(ButtonStyle.Link)   // This is the key change
                .setURL(uniqueUrl)            // Set the dynamic URL
                .setEmoji('🔒')
        );
        // ---------------------------------

        // ... (webhook logic remains the same) ...
        let webhook = (await verifyChannel.fetchWebhooks()).find(w => w.name === 'Verification Bot');
        if (!webhook) {
            webhook = await verifyChannel.createWebhook({
                name: 'Verification Bot',
                avatar: 'https://www.velutinx.com/images/LogoDiscord.png'
            });
        }

        const sentMessage = await webhook.send({
            embeds: [embed],
            components: [row],
            username: 'Verification Bot',
            avatarURL: 'https://www.velutinx.com/images/LogoDiscord.png'
        });

        // ... (reaction logic remains the same) ...
        const verifyEmoji = helpers.releaseEmojis.VERIFY;
        try {
            await sentMessage.react(verifyEmoji);
        } catch (err) {
            console.error('Failed to add reaction:', err);
        }

        await interaction.reply({ content: '✅ Verification message posted with a direct link button!', flags: 64 });
    }
};
