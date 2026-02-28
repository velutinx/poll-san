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
        .setDescription('12 characters separated by ♂️ or ♀️ (gender symbols)')
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

      await interaction.deferReply({ ephemeral: true });  // flags → ephemeral: true

      const days = interaction.options.getInteger('days');
      const rawInput = interaction.options.getString('characters')?.trim();

      if (!rawInput) {
        return interaction.editReply({ content: '❌ Characters field is missing.' });
      }

      // Define the two separators (use the actual Unicode characters)
      const MALE   = '♂️';   // U+2642 + U+FE0F
      const FEMALE = '♀️';   // U+2640 + U+FE0F

      // Split on either ♂️ or ♀️ — normalize spaces around separators
      let characters = rawInput
        .split(new RegExp(`\\s*(${MALE}|${FEMALE})\\s*`))   // split AND capture separators
        .map(part => part.trim())
        .filter(part => part !== '' && part !== MALE && part !== FEMALE);  // remove empty & separators themselves

      // Alternative (simpler but less strict) — if you don't care about capturing gender
      // characters = rawInput.split(/[♂️♀️]+/).map(c => c.trim()).filter(Boolean);

      if (characters.length !== 12) {
        return interaction.editReply({
          content: `❌ Exactly 12 characters required. You provided ${characters.length}.\n\n` +
                   `Input received (after trimming): "${rawInput}"\n` +
                   `Parsed: ${characters.join(' | ')}`
        });
      }

      // Optional: log for debugging
      console.log(`Starting poll | days: ${days} | chars: ${characters.join(', ')}`);

      await pollManager.startPoll(interaction.client, days, characters);

      await interaction.editReply({
        content: `✅ Poll started for ${days} day(s) with 12 characters.`
      });

    } catch (err) {
      console.error('STARTPOLL ERROR:', err);

      const msg = '❌ An unexpected error occurred.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
  }
};
