const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const XPLib = require('../xpUtils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Shows your current level, messages, and vote bonus')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Check someone else\'s level (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      // Defer reply as ephemeral (private)
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const target = interaction.options.getUser('user') || interaction.user;
      const guildId = interaction.guild.id;

      const stats = await XPLib.getUserStats(target.id, guildId);

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: `${target.tag}'s Level`, iconURL: target.displayAvatarURL() })
        .addFields(
          { name: 'Level', value: `${stats.level}`, inline: true },
          { name: 'Messages', value: `${stats.messages}`, inline: true },
          { name: 'Vote Bonus', value: `+${stats.bonus}`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'XP from messages ≥5 chars' });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('[/level] Error:', error);

      const errorMsg = 'Failed to fetch your stats (Supabase connection issue). Try again later.';

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: errorMsg, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};