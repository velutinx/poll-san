// index.js
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');

// Import your managers and role remover
const pollManager = require('./pollManager');
const queueManager = require('./queueManager');
const roleRemover = require('./roleRemover');  // ← This line activates the role remover!

// Create client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ],
});

// Command collection
client.commands = new Collection();

// === Load commands ===
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

const commands = []; // For deployment

for (const file of commandFiles) {
  try {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    // Handle both single command and array of commands
    if (Array.isArray(command.data)) {
      command.data.forEach(builder => {
        client.commands.set(builder.name, command);
        commands.push(builder.toJSON());
        console.log(`✅ Loaded sub-command: ${builder.name} (from ${file})`);
      });
    } else if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      commands.push(command.data.toJSON());
      console.log(`✅ Loaded command: ${command.data.name}`);
    } else {
      console.warn(`⚠️ The command at ${filePath} is missing "data" or "execute".`);
    }
  } catch (err) {
    console.error(`❌ Failed to load command ${file}:`, err);
  }
}

// === Deploy commands to guild (instant / guild-specific) ===
if (process.env.DISCORD_TOKEN && process.env.CLIENT_ID && process.env.GUILD_ID) {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  (async () => {
    try {
      console.log(`🚀 Deploying ${commands.length} commands to guild (instant)...`);
      const data = await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`✅ Successfully deployed ${data.length} guild commands.`);
      console.log('🔄 Refresh Discord (Ctrl+R) to see new commands');
    } catch (error) {
      console.error('❌ Deploy error:', error);
    }
  })();
} else {
  console.warn('⚠️ Missing env vars for command deployment (DISCORD_TOKEN, CLIENT_ID, GUILD_ID)');
}

// === Client ready event ===
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Activate role remover (sets up event listener + interval)
  roleRemover(client);
  console.log('Role remover initialized');

  // Resume poll
  try {
    await pollManager.resumePoll(client);
    console.log('Poll auto-resume completed');
  } catch (err) {
    console.error('Poll resume error:', err);
  }

  // Resume queue system
  try {
    await queueManager.resumeQueue(client);
    console.log('Queue system auto-resume completed');
  } catch (err) {
    console.error('Queue resume error:', err);
  }
});

// === Handle slash commands ===
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
    const replyMethod = interaction.replied || interaction.deferred ? 'followUp' : 'reply';
    await interaction[replyMethod]({ 
      content: 'There was an error while executing this command!', 
      ephemeral: true 
    }).catch(() => {}); // Silent fail if already replied
  }
});

// === Login ===
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('Login failed:', err);
  process.exit(1);
});
