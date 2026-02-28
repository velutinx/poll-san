// commands/startpoll.js
const { SlashCommandBuilder } = require('discord.js');
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
        .setDescription('12 characters prefixed by ♂️ or ♀️ (e.g. ♂️Name ♀️Name ...)')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      const OWNER_ID = '1380051214766444617';

      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({
          content: '❌ You are not allowed to start polls.',
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const days = interaction.options.getInteger('days');
      const rawInput = interaction.options.getString('characters')?.trim();

      if (!rawInput) {
        return interaction.editReply({ content: '❌ Characters field is missing.' });
      }

      const MALE   = '♂️';
      const FEMALE = '♀️';

      // Split while capturing the gender symbols
      const parts = rawInput.split(new RegExp(`(${MALE}|${FEMALE})`));

      const characters = [];
      let currentGender = '';

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        if (trimmed === MALE || trimmed === FEMALE) {
          currentGender = trimmed;
        } else {
          // Attach gender if we have one pending
          const displayName = currentGender ? `${currentGender} ${trimmed}` : trimmed;
          characters.push(displayName);
          currentGender = ''; // reset after use
        }
      }

      if (characters.length !== 12) {
        return interaction.editReply({
          content: `❌ Exactly 12 characters required. Got ${characters.length}.\n\n` +
                   `Raw input: ${rawInput}\n` +
                   `Parsed (${characters.length}):\n${characters.map((c,i) => `${i+1}. ${c}`).join('\n')}`
        });
      }

      console.log(`Starting poll | ${days}d | ${characters.join(' • ')}`);

      await pollManager.startPoll(interaction.client, days, characters);

      await interaction.editReply({
        content: `✅ Poll started for ${days} day(s) with 12 characters.`
      });

    } catch (err) {
      console.error('STARTPOLL ERROR:', err);

      const msg = '❌ An unexpected error occurred. Check console.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
  }
};
