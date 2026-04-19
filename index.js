// this is poll-san/index.js

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
    Events,
    MessageFlags
} = require('discord.js');

const supabase = require('./services/supabase');
const { runPollInterval } = require('./services/pollService');
const { cleanRoles } = require('./services/roleCleaner');
const XPLib = require('./utils/xputils');
const { syncMembershipRoles } = require('./services/membershipSync');
const giveawayCommand = require('./commands/giveaway');
const messageCreateEvent = require('./events/messageCreate');
const { handleShopSelect, handleShopPurchase } = require('./services/shopHandler');
const { handleSlotsBet } = require('./services/slotsHandler');
const { startHangmanGame } = require('./services/hangmanGame');
const { checkAndNotifyCooldowns } = require('./services/cooldownNotifier');
const { handleTriviaMessage } = require('./services/triviaJanitor');

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

    // Start the dashboard (clean version - no realtime stuff)
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
        require('./commands/games/slots').data.toJSON(),
        require('./commands/admin/post-slots-ui').data.toJSON(),
        require('./commands/admin/post-hangman-ui').data.toJSON(),
        require('./commands/admin/post-trivia-ui').data.toJSON(),   // <-- ADDED
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

    // Role cleanup
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) cleanRoles(guild);

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

    setInterval(() => {
        checkAndNotifyCooldowns(client).catch(err => console.error('Cooldown notifier error:', err));
    }, 300000); // 5 minutes

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
                case 'level': require('./commands/level')(interaction); break;
                case 'giveaway': await giveawayCommand.execute(interaction); break;
                case 'tickets': await require('./commands/tickets/balance').execute(interaction); break;
                case 'shop': await require('./commands/tickets/shop').execute(interaction); break;
                case 'slots': await require('./commands/games/slots').execute(interaction); break;
                case 'post_slots_ui': await require('./commands/admin/post-slots-ui').execute(interaction); break;
                case 'post_hangman_ui': await require('./commands/admin/post-hangman-ui').execute(interaction); break;
                case 'post_trivia_ui': await require('./commands/admin/post-trivia-ui').execute(interaction); break;  // <-- ADDED
            }
        } else if (interaction.isUserContextMenuCommand() && interaction.commandName === 'View Level') {
            require('./commands/level')(interaction);
        } else if (interaction.isButton()) {
            if (interaction.customId === 'shop_buy_confirm') {
                await handleShopPurchase(interaction);
            } else if (interaction.customId === 'slots_bet_1') {
                await handleSlotsBet(interaction, 1);
            } else if (interaction.customId === 'slots_bet_5') {
                await handleSlotsBet(interaction, 5);
            } else if (interaction.customId === 'slots_bet_25') {
                await handleSlotsBet(interaction, 25);
            } else if (interaction.customId === 'hangman_start_button') {
                await startHangmanGame(interaction);
            } else if (interaction.customId === 'trivia_start_hard') {               // <-- ADDED
                const commandString = '/sb number-of-rounds:5 multiple-winners:Yes difficulty:Hard';
                await interaction.channel.send(commandString);
                await interaction.reply({
                    content: `RinBot command prepared! Press the up arrow in the chat, then Enter to send it.`,
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await giveawayCommand.handleGiveawayButton(interaction);
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'shop_select') {
                await handleShopSelect(interaction);
            }
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
client.on('messageCreate', messageCreateEvent);
client.on('messageCreate', (message) => {
    handleTriviaMessage(message).catch(err => console.error('Trivia handler error:', err));
});

// --- 4. XP SYSTEM ---
client.on(Events.MessageCreate, async (message) => {
    await XPLib.updateXP(message);
});

client.on('error', console.error);
process.on('unhandledRejection', console.error);

client.login(process.env.DISCORD_TOKEN);
