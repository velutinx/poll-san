const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env'), quiet: true });

const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    ContextMenuCommandBuilder, 
    ApplicationCommandType,
    Partials,
    Events
} = require('discord.js');

const supabase = require('./services/supabase');
const { runPollInterval } = require('./services/pollService');
const { cleanRoles } = require('./services/roleCleaner');
const XPLib = require('./utils/xputils');

// Import giveaway command and button handler
const giveawayCommand = require('./commands/giveaway');

// Initialize Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User]
});

// --- 1. STARTUP, AUTO-RESUME & AUDIT ---
client.once(Events.ClientReady, async (c) => {
    console.log(`🚀 ${c.user.tag} online and ready!`);

    const dashboardModule = await import('./web/server.js');
    const startDashboard = dashboardModule.default || dashboardModule;
    startDashboard(client);

    const commandsData = [
        new SlashCommandBuilder().setName('level').setDescription('Shows your current XP/level').toJSON(),
        new ContextMenuCommandBuilder().setName('View Level').setType(ApplicationCommandType.User).toJSON(),
        // Add giveaway command
        giveawayCommand.data.toJSON()
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commandsData }
        );
   //     console.log('✅ Slash commands synced');

        // After commands are synced, restore any active giveaways from the database
        const { restoreGiveaways } = require('./commands/giveaway');
        await restoreGiveaways(client).catch(console.error);

    } catch (err) {
        console.error('❌ Failed to sync commands:', err);
    }

    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) {
   //     console.log('🧹 Running initial role cleanup sweep...');
        cleanRoles(guild);
    }

    setInterval(() => {
        const activeGuild = client.guilds.cache.get(process.env.GUILD_ID);
        if (activeGuild) cleanRoles(activeGuild);
    }, 3600000);

    const { data: activePolls } = await supabase
        .from('auto_resume')
        .select('*')
        .gt('ends_at', new Date().toISOString());

    if (activePolls && activePolls.length > 0) {
        for (const poll of activePolls) {
            try {
                const channel = await client.channels.fetch(poll.channel_id);
                const pollMsg = await channel.messages.fetch(poll.message_id);
                
                const characters = poll.poll_list
                    .split(/(?=:female_sign:|:male_sign:|♀️|♂️)/)
                    .map(s => s.trim())
                    .filter(s => s.length > 0);

                runPollInterval(pollMsg, new Date(poll.ends_at).getTime(), characters);
            } catch (e) {
                console.error(`Failed to resume poll ${poll.message_id}:`, e.message);
            }
        }
    }
});

// --- 2. INTERACTION HANDLER ---
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        // Handle slash commands
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'level':
                    require('./commands/level')(interaction);
                    break;
                case 'giveaway':
                    await giveawayCommand.execute(interaction);
                    break;
            }
        }
        // Handle user context menu (View Level)
        else if (interaction.isUserContextMenuCommand() && interaction.commandName === 'View Level') {
            require('./commands/level')(interaction);
        }
        // Handle button interactions (for giveaway entry)
        else if (interaction.isButton()) {
            await giveawayCommand.handleGiveawayButton(interaction);
        }
    } catch (err) {
        console.error('Interaction Error:', err);
    }
});

// --- 3. EVENT LISTENERS ---
client.on(Events.GuildMemberAdd, (member) => require('./events/guildMemberAdd')(member));
client.on(Events.MessageReactionAdd, (reaction, user) => require('./events/reactions')(reaction, user, 'add'));
client.on(Events.MessageReactionRemove, (reaction, user) => require('./events/reactions')(reaction, user, 'remove'));

// --- 4. XP SYSTEM ---
client.on(Events.MessageCreate, async (message) => {
    await XPLib.updateXP(message);
});

client.on('error', console.error);
process.on('unhandledRejection', console.error);

client.login(process.env.DISCORD_TOKEN);
