const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const queueManager = require('../queueManager');

const OWNER_ID = '1380051214766444617';     // Change only if wrong
const QUEUE_CHANNEL_ID = '1473730427318435860';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queueremove')
    .setDescription('Remove an item from the queue by position (owner only)')
    .addIntegerOption(option =>
      option
        .setName('position')
        .setDescription('Position to remove (1 = first, 2 = second, etc.)')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    // Security checks
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: 'Sorry, only the bot owner can use this command.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.channelId !== QUEUE_CHANNEL_ID) {
      return interaction.reply({
        content: 'This command can only be used in the <#1473730427318435860> channel.',
        flags: MessageFlags.Ephemeral
      });
    }

    const position = interaction.options.getInteger('position');

    try {
      await queueManager.removeFromQueue(interaction.client, position);
      await interaction.reply({
        content: `Removed item at position **${position}**.`,
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      console.error('Queue remove error:', error);
      let msg = 'Failed to remove item.';
      if (error.message.includes('Invalid position')) {
        msg = 'Invalid position — maybe the queue is shorter than that?';
      }
      await interaction.reply({
        content: msg,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
