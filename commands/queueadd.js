const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const queueManager = require('../queueManager');

const OWNER_ID = '1467153810970644638';     // Change only if wrong
const QUEUE_CHANNEL_ID = '1473730427318435860';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queueadd')
    .setDescription('Add an item to the large-requests-queue (owner only)')
    .addStringOption(option =>
      option
        .setName('item')
        .setDescription('Example: ♀️Misery Stentrem or ♂️St. Louis')
        .setRequired(true)
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
};
