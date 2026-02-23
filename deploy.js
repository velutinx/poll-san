require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN is missing in .env');
  process.exit(1);
}

if (!process.env.CLIENT_ID) {
  console.error('❌ CLIENT_ID is missing in .env');
  process.exit(1);
}

if (!process.env.GUILD_ID) {
  console.error('❌ GUILD_ID is missing in .env');
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');

let commandFiles = [];
try {
  commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
} catch (err) {
  console.error('❌ Error reading commands folder:', err);
  process.exit(1);
}

console.log(`Found ${commandFiles.length} command files`);

for (const file of commandFiles) {
  try {
    const command = require(path.join(commandsPath, file));

    // Handle both single command and array of commands (like our new queue.js)
    if (Array.isArray(command.data)) {
      // It's an array of SlashCommandBuilder objects
      command.data.forEach(builder => {
        commands.push(builder.toJSON());
        console.log(`✅ Loaded sub-command: ${builder.name}`);
      });
    }
    else if ('data' in command && typeof command.data.toJSON === 'function') {
      // Classic single command
      commands.push(command.data.toJSON());
      console.log(`✅ Loaded: ${command.data.name || file}`);
    }
    else {
      console.warn(`⚠️ Skipped ${file} (missing data or toJSON)`);
    }
  } catch (err) {
    console.error(`❌ Failed loading ${file}:`, err);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`🚀 Deploying ${commands.length} commands to guild (instant)...`);

    const data = await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log(`✅ Successfully deployed ${data.length} guild commands.`);
    console.log('🔄 Refresh Discord (Ctrl+R) to see new commands');
  } catch (error) {
    console.error('❌ Deploy error:', error);
  }
})();
