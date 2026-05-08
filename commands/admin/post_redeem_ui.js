// commands/admin/post-redeem-ui.js
module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_redeem_ui')
        .setDescription('[ADMIN] Post the redeem shop interface'),
    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator'))
            return interaction.reply({ content: '❌ Admin only.', flags: 64 });

        const channel = interaction.channel;
        const embed = new EmbedBuilder()
            .setColor('#B68BEC')
            .setTitle('🎁 Redeem Tickets')
            .setDescription(`Spend **300 tickets** to request a character from a series you already own.\n\nClick the button below to begin!`);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('redeem_start')
                .setLabel('Request a Character')
                .setStyle(ButtonStyle.Primary)
        );

        let webhook = (await channel.fetchWebhooks()).find(w => w.name === 'Redeem');
        if (!webhook) {
            webhook = await channel.createWebhook({
                name: 'Store',
                avatar: helpers.urls.LOGO_URL
            });
        }
        await webhook.send({ embeds: [embed], components: [row], username: 'Redeem', avatarURL: helpers.urls.LOGO_URL });
        await interaction.reply({ content: '✅ Redeem UI posted!', flags: 64 });
    }
};
