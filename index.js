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
const roleUpdateRecalc = require('./events/roleUpdateRecalc');

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
client.on(Events.GuildMemberAdd, (member) => require('./events/guildMemberAdd')(member));
client.on(Events.GuildMemberAdd, verification.execute);
client.on(Events.MessageReactionAdd, (reaction, user) => require('./events/reactions')(reaction, user, 'add'));
client.on(Events.MessageReactionRemove, (reaction, user) => require('./events/reactions')(reaction, user, 'remove'));
client.on('guildMemberRemove', require('./events/guildMemberPollRemove'));
client.on('messageCreate', messageCreateEvent);
client.on(Events.GuildMemberUpdate, roleConsistency);
client.on(Events.GuildMemberUpdate, roleUpdateRecalc);
client.on('messageCreate', require('./events/boostReaction'));
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
