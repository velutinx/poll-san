// index.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env'), quiet: true });
const { setGlobalDispatcher, Agent } = require('undici');

setGlobalDispatcher(new Agent({
    connections: 100,
    keepAliveTimeout: 60000,
    keepAliveMaxTimeout: 600000
}));

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

const { runPollInterval } = require('./services/pollService');
const { cleanRoles } = require('./services/roleCleaner');
const XPLib = require('./utils/xputils');
const { syncMembershipRoles } = require('./services/membershipSync');
const giveawayCommand = require('./commands/giveaway');
const { checkAndNotifyCooldowns } = require('./services/cooldownNotifier');
const { handleTriviaMessage, processEndOfDayAwards } = require('./services/triviaJanitor');
const verification = require('./events/verification');
const initMudaeMessageHandler = require('./handlers/mudaeMessageHandler');
const h = require('./utils/helpers');
const initChannelCleaner = require('./handlers/channelCleaner');

// ── Trivia guess handler ──
const triviaGuessEvent = require('./events/triviaGuess');

// ── Safe require helper ──
function getFn(mod, name) {
    if (typeof mod === 'function') return mod;
    if (mod && typeof mod.default === 'function') return mod.default;
    if (mod && typeof mod.execute === 'function') return mod.execute;
    throw new Error(`${name || 'Module'} does not export a function.`);
}

// ── Require all event handlers safely ──
const messageCreateEvent      = getFn(require('./events/messageCreate'), 'messageCreate');
const guildMemberAddEvent     = getFn(require('./events/guildMemberAdd'), 'guildMemberAdd');
const reactionsModule         = getFn(require('./events/reactions'), 'reactions');
const guildMemberRemoveEvent  = getFn(require('./events/guildMemberPollRemove'), 'guildMemberPollRemove');
const roleConsistencyEvent    = getFn(require('./events/roleConsistency'), 'roleConsistency');
const roleUpdateRecalcEvent   = getFn(require('./events/roleUpdateRecalc'), 'roleUpdateRecalc');
const handleInteraction       = getFn(require('./handlers/interactionHandler'), 'interactionHandler');

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
client.setMaxListeners(20);
client.once(Events.ClientReady, (c) => require('./events/ready')(c));
client.on(Events.InteractionCreate, handleInteraction);
client.on(Events.GuildMemberAdd, guildMemberAddEvent);
client.on(Events.GuildMemberAdd, verification.execute);
client.on(Events.MessageReactionAdd, (reaction, user) => reactionsModule(reaction, user, 'add'));
client.on(Events.MessageReactionRemove, (reaction, user) => reactionsModule(reaction, user, 'remove'));
client.on(Events.GuildMemberRemove, guildMemberRemoveEvent);
client.on(Events.MessageCreate, messageCreateEvent);
client.on(Events.MessageCreate, require('./events/boostReaction'));
client.on(Events.GuildMemberUpdate, roleConsistencyEvent);
client.on(Events.GuildMemberUpdate, roleUpdateRecalcEvent);
client.on(Events.MessageCreate, (message) => {
    handleTriviaMessage(message).catch(err => console.error('Trivia handler error:', err));
});
client.on(Events.MessageCreate, async (message) => {
    await XPLib.updateXP(message);
});
client.on(Events.MessageCreate, triviaGuessEvent);

client.on('error', console.error);
process.on('unhandledRejection', (reason) => {
    if (reason instanceof Error && reason.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' && reason.message.includes('fetch failed')) {
        return;
    }
    console.error(reason);
});

const { startCleanup } = require('./services/redeemHandler');
startCleanup();

require('./features/avatarScanner').init(client);

client.login(process.env.DISCORD_TOKEN);
