const { ContextMenuCommandBuilder, ApplicationCommandType, EmbedBuilder } = require('discord.js');
const XPLib = require('../xpUtils');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Check Level')
    .setType(ApplicationCommandType.User),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.targetUser;

    // If someone right-clicks a bot, fallback to themselves
    const finalTarget = target.bot ? interaction.user : target;

    const guildId = interaction.guild.id;
    const stats = await XPLib.getUserStats(finalTarget.id, guildId);

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({
        name: `${finalTarget.tag}'s Level`,
        iconURL: finalTarget.displayAvatarURL()
      })
      .addFields(
        { name: 'Level', value: `${stats.level}`, inline: true },
        { name: 'Messages', value: `${stats.messages}`, inline: true },
        { name: 'Vote Bonus', value: `+${stats.bonus}`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'XP from messages ≥5 chars' });

    await interaction.editReply({ embeds: [embed] });
  },
};
