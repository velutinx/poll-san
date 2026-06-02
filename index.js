// index.js (FULL – all listener exports fixed)
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

const { runPollInterval } = require('./services/pollService');
const { cleanRoles } = require('./services/roleCleaner');
const XPLib = require('./utils/xputils');
const { syncMembershipRoles } = require('./services/membershipSync');
const giveawayCommand = require('./commands/giveaway');
const { checkAndNotifyCooldowns } = require('./services/cooldownNotifier');
const { handleTriviaMessage, processEndOfDayAwards } = require('./services/triviaJanitor');
const handleInteraction = require('./handlers/interactionHandler');
const verification = require('./events/verification');
const initMudaeMessageHandler = require('./handlers/mudaeMessageHandler');
const h = require('./utils/helpers');
const initChannelCleaner = require('./handlers/channelCleaner');
const roleConsistency = require('./events/roleConsistency');
const roleUpdateRecalc = require('./events/roleUpdateRecalc');

// ── Helper: extract a callable function from any export style ──
function getListener(mod) {
    if (typeof mod === 'function') return mod;
    if (mod && typeof mod.default === 'function') return mod.default;
    if (mod && typeof mod.execute === 'function') return mod.execute;
    throw new Error('Module does not export a function: ' + String(mod));
}

const messageCreateEvent = getListener(require('./events/messageCreate'));
const guildMemberAddEvent = getListener(require('./events/guildMemberAdd'));
const reactionsAddEvent = getListener(require('./events/reactions'));
const reactionsRemoveEvent = getListener(require('./events/reactions')); // same module, but we need separate functions? We'll handle differently.
// Actually reactions.js might export an object with 'add' and 'remove'? The original code used a single module and passed 'add'/'remove' as second argument.
// So we keep original way for reactions: client.on(Events.MessageReactionAdd, (reaction, user) => require('./events/reactions')(reaction, user, 'add'));
// That is fine because the module is expected to be a function that takes (reaction, user, action). We'll leave that as is.
// But we need to ensure it's a function. We can just use getListener for it too.

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

client.once(Events.ClientReady, (c) => require('./events/ready')(c));
client.on(Events.InteractionCreate, handleInteraction);

// These are fine because we call getListener at require time
client.on(Events.GuildMemberAdd, getListener(require('./events/guildMemberAdd')));
client.on(Events.GuildMemberAdd, verification.execute); // separate verification handler

client.on(Events.MessageReactionAdd, (reaction, user) => {
    const fn = getListener(require('./events/reactions'));
    fn(reaction, user, 'add');
});
client.on(Events.MessageReactionRemove, (reaction, user) => {
    const fn = getListener(require('./events/reactions'));
    fn(reaction, user, 'remove');
});

client.on('guildMemberRemove', (member) => {
    const handler = require('./events/guildMemberPollRemove');
    if (typeof handler === 'function') handler(member);
});

client.on('messageCreate', messageCreateEvent);

client.on(Events.GuildMemberUpdate, getListener(roleConsistency));
client.on(Events.GuildMemberUpdate, getListener(roleUpdateRecalc));

client.on('messageCreate', (message) => {
    handleTriviaMessage(message).catch(err => console.error('Trivia handler error:', err));
});
client.on(Events.MessageCreate, async (message) => {
    await XPLib.updateXP(message);
});

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
