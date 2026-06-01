// commands/level.js
const { EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../services/database');
const h = require('../utils/helpers');

module.exports = async (interaction) => {
    const targetUser = interaction.isUserContextMenuCommand() ? interaction.targetUser : interaction.user;
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const data = await db.query(
        `SELECT * FROM ${h.tables.USER_XP} WHERE user_id = ? AND guild_id = ?`,
        [targetUser.id, interaction.guildId],
        true
    );

    if (!data) return interaction.editReply({ content: "No stats found yet!" });

    const levelEmbed = new EmbedBuilder()
        .setTitle(`${data.discord_username}'s Stats`)
        .setColor(h.colors.success)
        .addFields(
            { name: 'Level', value: `${h.releaseEmojis?.STAR || '🌟'} ${data.level}`, inline: true },
            { name: 'Messages', value: `${h.releaseEmojis?.SPEECH || '💬'} ${data.total_messages}`, inline: true }
        );

    return interaction.editReply({ embeds: [levelEmbed] });
};
