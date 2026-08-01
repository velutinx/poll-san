// commands/admin/resend-giveaway.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const helpers = require('../../utils/helpers');

// ─── Helper: get or create the "Giveaway" webhook (copied from giveaway.js) ───
async function getGiveawayWebhook(channel) {
    const webhooks = await channel.fetchWebhooks();
    let webhook = webhooks.find(w => w.name === 'Giveaway');
    if (!webhook) {
        webhook = await channel.createWebhook({
            name: 'Giveaway',
            avatar: helpers.urls.LOGO_URL
        });
    } else {
        // Update avatar if needed
        if (webhook.avatar !== helpers.urls.LOGO_URL) {
            await webhook.edit({ avatar: helpers.urls.LOGO_URL });
        }
    }
    return webhook;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resend_giveaway')
        .setDescription('[ADMIN] Resend the winners message for the last ended giveaway')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
        }

        const channelId = '1472450019067171008'; // #🎁giveaways-and-events
        const channel = await interaction.guild.channels.fetch(channelId);
        if (!channel) {
            return interaction.reply({ content: 'Channel not found.', ephemeral: true });
        }

        const webhook = await getGiveawayWebhook(channel);

        await webhook.send({
            content: '🎉 Giveaway ended! Winners:\n🥇 <@1057556464090226742>\n🥈 <@505421783252598826>\n🥉 <@1491237574637785249>',
            username: 'Giveaway',
            avatarURL: helpers.urls.LOGO_URL
        });

        await interaction.reply({ content: '✅ Winners re‑announced!', ephemeral: true });
    }
};
