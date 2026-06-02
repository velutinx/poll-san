// commands/roll.js
const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../services/database');
const h = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roll')
        .setDescription('Select a random winner from the current giveaway entrants'),

    async execute(interaction) {
        // Check if user has permission
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({
                content: 'You need `Manage Server` permission to roll the giveaway.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        await interaction.deferReply();

        try {
            // Get active giveaway from database
            const giveaway = await db.query(
                `SELECT * FROM ${h.tables.GIVEAWAYS}
                 WHERE ended = 0
                 ORDER BY julianday(end_time) ASC
                 LIMIT 1`,
                [],
                true
            );

            if (!giveaway) {
                return interaction.editReply({
                    content: `${h.releaseEmojis?.ALERT || '⚠️'} No active giveaway found. Create one first with /giveaway!`
                });
            }

            // Parse entrants array
            let entrants = [];
            try {
                entrants = JSON.parse(giveaway.entrants || '[]');
            } catch (e) {
                entrants = [];
            }

            if (entrants.length === 0) {
                return interaction.editReply({
                    content: `${h.releaseEmojis?.ALERT || '⚠️'} No entrants in the current giveaway.`
                });
            }

            // Select random winner
            const randomIndex = Math.floor(Math.random() * entrants.length);
            const winnerId = entrants[randomIndex];
            const winnerMention = `<@${winnerId}>`;

            // Try to fetch the winner's username for display
            let winnerName = winnerId;
            try {
                const winner = await interaction.client.users.fetch(winnerId);
                winnerName = winner.username;
            } catch (err) {
                console.warn(`Could not fetch user ${winnerId}:`, err.message);
            }

            // Get random present emojis for flair
            const { left, right } = h.getTwoRandomPresents?.() || { left: '🎁', right: '🎁' };

            // Create embed
            const embed = new EmbedBuilder()
                .setTitle(`${left} Giveaway Winner! ${right}`)
                .setDescription(`${h.releaseEmojis?.CONFETTI || '🎉'} **Congratulations ${winnerMention}!** ${h.releaseEmojis?.CONFETTI || '🎉'}`)
                .addFields(
                    { name: 'Prize', value: giveaway.prize, inline: true },
                    { name: 'Total Entrants', value: `${entrants.length}`, inline: true },
                    { name: 'Winner ID', value: winnerId, inline: false }
                )
                .setColor(h.colors?.giveaway || '#FF69B4')
                .setFooter({ text: `Rolled by ${interaction.user.username}` })
                .setTimestamp();

            // Add winner's username if we have it
            if (winnerName !== winnerId) {
                embed.addFields({ name: 'Winner', value: winnerName, inline: true });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('Roll command error:', err);
            await interaction.editReply({
                content: `${h.releaseEmojis?.ALERT || '⚠️'} An error occurred while rolling the giveaway. Please try again later.`
            });
        }
    }
};
