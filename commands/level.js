// commands/level.js
const { EmbedBuilder, MessageFlags } = require('discord.js');
const supabase = require('../services/supabase');
const h = require('../utils/helpers');

module.exports = async (interaction) => {
    const targetUser = interaction.isUserContextMenuCommand() ? interaction.targetUser : interaction.user;
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const { data } = await supabase.from(h.tables.USER_XP)
        .select('*')
        .eq('user_id', targetUser.id)
        .eq('guild_id', interaction.guildId)
        .single();

    if (!data) return interaction.editReply({ content: "No stats found yet!" });

    const levelEmbed = new EmbedBuilder()
        .setTitle(`${data.discord_username}'s Stats`)
        .setColor(h.colors.success)
        .addFields(
            { name: 'Level', value: `⭐ ${data.level}`, inline: true },
            { name: 'Messages', value: `💬 ${data.total_messages}`, inline: true }
        );

    return interaction.editReply({ embeds: [levelEmbed] });
};
