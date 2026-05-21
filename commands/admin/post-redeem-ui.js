// commands/admin/post-redeem-ui.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_redeem_ui')
        .setDescription('[ADMIN] Post the Ticket Store interface in this channel.'),

    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({ content: `${helpers.releaseEmojis?.BATSU || '❌'} Admin only.`, flags: 64 });
        }

        const channel = interaction.channel;
        const cost = helpers.redeem;

        const embed = new EmbedBuilder()
            .setColor('#B68BEC')
            .setTitle(`${helpers.releaseEmojis?.TICKET || '🎫'} Ticket Store`)
            .setDescription(
                'Spend your hard‑earned tickets on these perks:\n\n' +
                `🗳️ **Vote Boost** – your poll votes count 2× for 7 days\n` +
                `　　Cost: **${cost.voteBoostCost}** tickets\n\n` +
                `${helpers.releaseEmojis?.SPEECH || '💬'} **Suggest a Character** – nominate someone for the next weekly poll\n` +
                `　　Cost: **${cost.suggestCost}** tickets\n\n` +
                `${helpers.getRandomPresent?.() || '🎁'} **Request a Character** – ask for a character from a series you already own\n` +
                `　　Cost: **${cost.characterRequestCost}** tickets`
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('redeem_vote_power')
                .setLabel('Vote Boost')
                .setEmoji('🗳️')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('redeem_suggest_character')
                .setLabel('Suggest Character')
                .setEmoji(`${helpers.releaseEmojis?.SPEECH || '💬'}`)
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('redeem_start')
                .setLabel('Request a Character')
                .setEmoji(`${helpers.getRandomPresent?.() || '🎁'}`)
                .setStyle(ButtonStyle.Secondary)
        );

        const webhookName = 'Ticket Store';
        let webhook = (await channel.fetchWebhooks()).find(w => w.name === webhookName);
        if (!webhook) {
            webhook = await channel.createWebhook({
                name: webhookName,
                avatar: helpers.urls.LOGO_URL
            });
        }

        await webhook.send({
            embeds: [embed],
            components: [row],
            username: webhookName,
            avatarURL: helpers.urls.LOGO_URL
        });

        await interaction.reply({ content: `${helpers.releaseEmojis?.getRandomVerify?.() || '✅'} Ticket Store posted!`, ephemeral: true });
    }
};
