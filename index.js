// index.js
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
const { syncMembershipRoles } = require('./services/membershipSync');
const giveawayCommand = require('./commands/giveaway');
const messageCreateEvent = require('./events/messageCreate');
const { checkAndNotifyCooldowns } = require('./services/cooldownNotifier');
const { handleTriviaMessage, processEndOfDayAwards } = require('./services/triviaJanitor');
const handleInteraction = require('./handlers/interactionHandler');
const verification = require('./events/verification');
const initMudaeMessageHandler = require('./handlers/mudaeMessageHandler');
const h = require('./utils/helpers');
const initChannelCleaner = require('./handlers/channelCleaner');
const roleConsistency = require('./events/roleConsistency');

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

// --- 1. STARTUP ---
client.once(Events.ClientReady, async (c) => {
    console.log(`🚀 ${c.user.tag} online and ready!`);

    try {
        const dashboardModule = await import('./web/server.js');
        const startDashboard = dashboardModule.default || dashboardModule;
        startDashboard(client);
    } catch (err) {
        console.error('❌ Failed to start dashboard:', err.message);
    }

    // Sync slash commands
const commandsData = [
    new SlashCommandBuilder().setName('level').setDescription('Shows your current XP/level').toJSON(),
    new ContextMenuCommandBuilder().setName('View Level').setType(ApplicationCommandType.User).toJSON(),
    giveawayCommand.data.toJSON(),
    require('./commands/tickets/balance').data.toJSON(),
    require('./commands/tickets/shop').data.toJSON(),
    require('./commands/admin/post-slots-ui').data.toJSON(),
    require('./commands/admin/post-hangman-ui').data.toJSON(),
    require('./commands/admin/post-verify-ui').data.toJSON(),
    require('./commands/admin/post-checkin-ui').data.toJSON(),
    require('./commands/admin/post-cointoss-ui').data.toJSON(),
    require('./commands/admin/post-redeem-ui').data.toJSON()
];
    require('./services/roleAuditHandler')(client);

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
    if (guild) cleanRoles(guild);
    setInterval(() => {
        const activeGuild = client.guilds.cache.get(process.env.GUILD_ID);
        if (activeGuild) cleanRoles(activeGuild);
    }, 3600000);

    try { await syncMembershipRoles(client); } catch (err) { console.error('[MembershipSync] Initial sync failed:', err); }
    setInterval(() => {
        syncMembershipRoles(client).catch(err => console.error('[MembershipSync] Sync error:', err));
    }, 300000);

    setInterval(() => {
        checkAndNotifyCooldowns(client).catch(err => console.error('Cooldown notifier error:', err));
    }, 300000);

    setInterval(() => {
        processEndOfDayAwards(client).catch(err => console.error('Trivia end-of-day awards error:', err));
    }, 3600000);

    const hangmanChannelId = h.games.hangman.channelId;
    const hangmanWhitelist = h.whitelistedMessages[hangmanChannelId] || [];
    initChannelCleaner(client, hangmanChannelId, hangmanWhitelist);

    const { data: activePolls } = await supabase
        .from(h.tables.POLL_AUTO_RESUME)
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

    const { restoreGiveaways } = require('./commands/giveaway');
    await restoreGiveaways(client).catch(console.error);
    initMudaeMessageHandler(client);

    setInterval(async () => {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) await require('./services/accessGuard')(guild);
}, 60_000);
});

client.on(Events.InteractionCreate, handleInteraction);
client.on(Events.GuildMemberAdd, (member) => require('./events/guildMemberAdd')(member));
client.on(Events.GuildMemberAdd, verification.execute);
client.on(Events.MessageReactionAdd, (reaction, user) => require('./events/reactions')(reaction, user, 'add'));
client.on(Events.MessageReactionRemove, (reaction, user) => require('./events/reactions')(reaction, user, 'remove'));
client.on('guildMemberRemove', require('./events/guildMemberPollRemove'));
client.on('messageCreate', messageCreateEvent);
client.on(Events.GuildMemberUpdate, roleConsistency);
client.on('messageCreate', (message) => {
    handleTriviaMessage(message).catch(err => console.error('Trivia handler error:', err));
});
client.on(Events.MessageCreate, async (message) => {
    await XPLib.updateXP(message);
});

client.on('error', console.error);
process.on('unhandledRejection', console.error);

const { startCleanup } = require('./services/redeemHandler');
startCleanup();

require('./features/avatarScanner').init(client);

client.login(process.env.DISCORD_TOKEN);
