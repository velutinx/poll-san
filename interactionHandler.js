const { Events } = require('discord.js');

module.exports = (client) => {
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isUserContextMenuCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error('Interaction error:', error);

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: 'There was an error executing this command.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: 'There was an error executing this command.',
          ephemeral: true
        });
      }
    }
  });
};
