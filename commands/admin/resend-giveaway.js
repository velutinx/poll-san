const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resend_giveaway')
        .setDescription('[ADMIN] Resend the last giveaway winners message')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: 'Admin only.', ephemeral: true });
        }

        const channelId = '1472450019067171008';
        const channel = await interaction.guild.channels.fetch(channelId);
        if (!channel) {
            return interaction.reply({ content: 'Channel not found.', ephemeral: true });
        }

        // Reuse your existing webhook getter (or create if missing)
        const webhook = await getGiveawayWebhook(channel); // you'll need to import/define this
        await webhook.send({
            content: '🎉 Giveaway ended! Winners:\n🥇 <@1057556464090226742>\n🥈 <@505421783252598826>\n🥉 <@1491237574637785249>',
            username: 'Giveaway',
            avatarURL: 'https://www.velutinx.com/images/LogoDiscord.png'
        });

        await interaction.reply({ content: '✅ Winners re‑announced!', ephemeral: true });
    }
};
