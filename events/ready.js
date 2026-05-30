// events/ready.js
const supabase = require('../services/supabase');
const { runPollInterval } = require('../services/pollService');
const { cleanRoles } = require('../services/roleCleaner');
const { syncMembershipRoles } = require('../services/membershipSync');
const giveawayCommand = require('../commands/giveaway');
const { checkAndNotifyCooldowns } = require('../services/cooldownNotifier');
const { processEndOfDayAwards } = require('../services/triviaJanitor');
const h = require('../utils/helpers');
const initChannelCleaner = require('../handlers/channelCleaner');
const initMudaeMessageHandler = require('../handlers/mudaeMessageHandler');

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

module.exports = async (c) => {
  // Start dashboard
  try {
    const dashboardModule = await import('../web/server.js');
    const startDashboard = dashboardModule.default || dashboardModule;
    startDashboard(c);
  } catch (err) {
    console.error('❌ Failed to start dashboard:', err.message);
  }

  // Register slash commands
  const commandsData = [
    new SlashCommandBuilder().setName('level').setDescription('Shows your current XP/level').toJSON(),
    new ContextMenuCommandBuilder().setName('View Level').setType(ApplicationCommandType.User).toJSON(),
    giveawayCommand.data.toJSON(),
    require('../commands/admin/post-slots-ui').data.toJSON(),
    require('../commands/admin/post-hangman-ui').data.toJSON(),
    require('../commands/admin/post-verify-ui').data.toJSON(),
    require('../commands/admin/post-checkin-ui').data.toJSON(),
    require('../commands/admin/post-cointoss-ui').data.toJSON(),
    require('../commands/admin/post-redeem-ui').data.toJSON()
  ];

  require('../services/roleAuditHandler')(c);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commandsData }
    );
  } catch (err) {
    console.error('❌ Failed to sync commands:', err);
  }

  // Clean roles periodically
  const guild = c.guilds.cache.get(process.env.GUILD_ID);
  if (guild) cleanRoles(guild);
  setInterval(() => {
    const activeGuild = c.guilds.cache.get(process.env.GUILD_ID);
    if (activeGuild) cleanRoles(activeGuild);
  }, 3600000);

  // Membership sync
  try { await syncMembershipRoles(c); } catch (err) { console.error('[MembershipSync] Initial sync failed:', err); }
  setInterval(() => {
    syncMembershipRoles(c).catch(err => console.error('[MembershipSync] Sync error:', err));
  }, 300000);

  // Cooldown notifier
  setInterval(() => {
    checkAndNotifyCooldowns(c).catch(err => console.error('Cooldown notifier error:', err));
  }, 300000);

  // Trivia end-of-day awards
  setInterval(() => {
    processEndOfDayAwards(c).catch(err => console.error('Trivia end-of-day awards error:', err));
  }, 3600000);

  // Channel cleaner for hangman
  const hangmanChannelId = h.games.hangman.channelId;
  const hangmanWhitelist = h.whitelistedMessages[hangmanChannelId] || [];
  initChannelCleaner(c, hangmanChannelId, hangmanWhitelist);

  // Resume active polls
  const { data: activePolls } = await supabase
    .from(h.tables.POLL_AUTO_RESUME)
    .select('*')
    .gt('ends_at', new Date().toISOString());
  if (activePolls && activePolls.length > 0) {
    for (const poll of activePolls) {
      try {
        const channel = await c.channels.fetch(poll.channel_id);
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

  // Restore giveaways and poll reminders
  const { restoreGiveaways } = require('../commands/giveaway');
  await restoreGiveaways(c).catch(console.error);
  const { restorePollReminders } = require('../services/pollReminders');
  await restorePollReminders(c).catch(console.error);

  // Start Mudae message handler
  initMudaeMessageHandler(c);
};
