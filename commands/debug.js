const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debugqueue')
    .setDescription('Test if new commands are registering'),
  async execute(interaction) {
    await interaction.reply({
      content: 'Debug command works! Queue commands should appear after refresh.',
      ephemeral: true
    });
  },
};
