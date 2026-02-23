const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const queueManager = require('../queueManager');

const OWNER_ID = '1467153810970644638';     // ← change this if it's not your Discord ID
const QUEUE_CHANNEL_ID = '1473730427318435860';

module.exports = {
  data: [
    new SlashCommandBuilder()
      .setName('queueadd')
      .setDescription('Add an item to the large-requests-queue (owner only)')
      .addStringOption(option =>
        option
          .setName('item')
          .setDescription('Example: ♀️Misery Stentrem or ♂️St. Louis')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('queueremove')
      .setDescription('Remove an item from the queue by position (owner only)')
      .addIntegerOption(option =>
        option
          .setName('position')
          .setDescription('Position to remove (1 = first item, 2 = second, etc.)')
          .setRequired(true)
          .setMinValue(1)
      )
  ],

  async execute(interaction) {
    // Security checks
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: 'Sorry, only the bot owner can use these commands.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.channelId !== QUEUE_CHANNEL_ID) {
      return interaction.reply({
        content: 'This command can only be used in the <#1473730427318435860> channel.',
        flags: MessageFlags.Ephemeral
      });
    }

    const commandName = interaction.commandName;

    if (commandName === 'queueadd') {
      const item = interaction.options.getString('item').trim();

      if (!item) {
        return interaction.reply({
          content: 'Please provide an item to add.',
          flags: MessageFlags.Ephemeral
        });
      }

      try {
        await queueManager.addToQueue(interaction.client, item);
        await interaction.reply({
          content: `Added **${item}** to the queue.`,
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        console.error('Queue add error:', error);
        await interaction.reply({
          content: 'Something went wrong while adding to the queue.',
          flags: MessageFlags.Ephemeral
        });
      }
    }

    else if (commandName === 'queueremove') {
      const position = interaction.options.getInteger('position');

      if (position < 1) {
        return interaction.reply({
          content: 'Position must be 1 or higher.',
          flags: MessageFlags.Ephemeral
        });
      }

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
  }
};
