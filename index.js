require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const pollManager = require('./pollManager');
const queueManager = require('./queueManager'); // ← NEW

// Create client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]
});

// Command collection
client.commands = new Collection();

// Load all commands from ./commands folder
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  // Handle both single command and array-style commands
  if (Array.isArray(command.data)) {
    command.data.forEach(builder => {
      client.commands.set(builder.name, command);
      console.log(`Loaded command: ${builder.name} (from ${file})`);
    });
  }
  else if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    console.log(`Loaded command: ${command.data.name}`);
  } else {
    console.warn(`The command at ${filePath} is missing "data" or "execute".`);
  }
}

// Ready event
client.once('ready', async () => {   // ← changed to 'ready' (clientReady is not standard)
  console.log(`Logged in as ${client.user.tag}`);

  // Resume poll
  try {
    await pollManager.resumePoll(client);
    console.log('Poll auto-resume completed');
  } catch (err) {
    console.error('Poll resume error:', err);
  }

  // Resume queue system ← NEW
  try {
    await queueManager.resumeQueue(client);
    console.log('Queue system auto-resume completed');
  } catch (err) {
    console.error('Queue resume error:', err);
  }
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
    } else {
      await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
  }
});

// Login
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('Login failed:', err);
});
