// commands/startpoll.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const pollManager = require('../pollManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('startpoll')
    .setDescription('Start a dynamic poll (Owner only)')
    .setDMPermission(false)
    .addIntegerOption(option =>
      option.setName('days')
        .setDescription('Duration in days')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('characters')
        .setDescription('12 characters separated by |')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      const OWNER_ID = '1380051214766444617';

      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({
          content: '❌ You are not allowed to start polls.',
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const days = interaction.options.getInteger('days');
      const rawCharacters = interaction.options.getString('characters');

      if (!rawCharacters) {
        return interaction.editReply({
          content: '❌ Characters field is missing.'
        });
      }

      const characters = rawCharacters
        .split('|')
        .map(c => c.trim())
        .filter(Boolean);

      if (characters.length !== 12) {
        return interaction.editReply({
          content: `❌ You must provide exactly 12 characters separated by |. You provided ${characters.length}.`
        });
      }

      await pollManager.startPoll(interaction.client, days, characters);

      await interaction.editReply({
        content: `✅ Poll started for ${days} day(s).`
      });

    } catch (err) {
      console.error('STARTPOLL ERROR:', err);

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '❌ An unexpected error occurred.',
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '❌ An unexpected error occurred.',
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }
};