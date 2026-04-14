// this is poll-san/index.js

const path = require('path');
const pollService = require('./services/pollService');
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
const { syncMembershipRoles } = require('./services/membershipSync');

// Import giveaway command
const giveawayCommand = require('./commands/giveaway');

// ==================== DASHBOARD REFRESH FUNCTION ====================
// This is what will actually update your dashboard when a vote happens
async function updateDashboard() {
    try {
        // TODO: Put your actual dashboard refresh logic here
        // For now we'll just log it so the bot doesn't crash
        console.log('📊 Dashboard refresh triggered by realtime vote');

        // Example (uncomment and adapt when you implement the real dashboard update):
        // const dashboardModule = await import('./web/server.js');
        // if (dashboardModule.refreshPollData) {
        //     await dashboardModule.refreshPollData();
        // }

    } catch (err) {
        console.error('❌ Dashboard refresh failed:', err.message);
    }
}

// Register the callback
pollService.setDashboardRefreshCallback(updateDashboard);

// ==================== DISCORD CLIENT SETUP ====================
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

    // Start the dashboard (this should be the line that starts your Express server)
    const dashboardModule = await import('./web/server.js');
    const startDashboard = dashboardModule.default || dashboardModule;
    startDashboard(client);

    // ... rest of your startup code remains the same ...
    const commandsData = [
        new SlashCommandBuilder().setName('level').setDescription('Shows your current XP/level').toJSON(),
        new ContextMenuCommandBuilder().setName('View Level').setType(ApplicationCommandType.User).toJSON(),
        giveawayCommand.data.toJSON()
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commandsData }
        );
    } catch (err) {
        console.error('❌ Failed to sync commands:', err);
    }

    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) {
        cleanRoles(guild);
    }

    // Role cleanup every hour
    setInterval(() => {
        const activeGuild = client.guilds.cache.get(process.env.GUILD_ID);
        if (activeGuild) cleanRoles(activeGuild);
    }, 3600000);

    // Membership sync
    try {
        await syncMembershipRoles(client);
    } catch (err) {
        console.error('[MembershipSync] Initial sync failed:', err);
    }

    setInterval(() => {
        syncMembershipRoles(client).catch(err => console.error('[MembershipSync] Sync error:', err));
    }, 300000);

    // Auto-resume active polls
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

    // Restore giveaways
    const { restoreGiveaways } = require('./commands/giveaway');
    await restoreGiveaways(client).catch(console.error);
});

// --- 2. INTERACTION HANDLER ---
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'level':
                    require('./commands/level')(interaction);
                    break;
                case 'giveaway':
                    await giveawayCommand.execute(interaction);
                    break;
            }
        } else if (interaction.isUserContextMenuCommand() && interaction.commandName === 'View Level') {
            require('./commands/level')(interaction);
        } else if (interaction.isButton()) {
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
client.on('guildMemberRemove', require('./events/guildMemberPollRemove'));

// --- 4. XP SYSTEM ---
client.on(Events.MessageCreate, async (message) => {
    await XPLib.updateXP(message);
});

client.on('error', console.error);
process.on('unhandledRejection', console.error);

client.login(process.env.DISCORD_TOKEN);
