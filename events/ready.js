// events/ready.js
const db = require('../services/database');
const { runPollInterval } = require('../services/pollService');
const { cleanRoles } = require('../services/roleCleaner');
const { syncMembershipRoles } = require('../services/membershipSync');
const giveawayCommand = require('../commands/giveaway');
const { checkAndNotifyCooldowns } = require('../services/cooldownNotifier');
const { processEndOfDayAwards } = require('../services/triviaJanitor');
const h = require('../utils/helpers');
const initChannelCleaner = require('../handlers/channelCleaner');
const initMudaeMessageHandler = require('../handlers/mudaeMessageHandler');
const { cleanupExpiredMemberships } = require('../services/membershipCleanup');

const {
  REST,
  Routes,
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
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
    // console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('❌ Failed to sync commands:', err);
  }

  // ─── Clean roles periodically (offloaded) ───
  const guild = c.guilds.cache.get(process.env.GUILD_ID);
  if (guild) {    setImmediate(() => cleanRoles(guild).catch(err => console.error('Initial cleanRoles error:', err)));  }
  setInterval(() => {
    const activeGuild = c.guilds.cache.get(process.env.GUILD_ID);
    if (activeGuild) {      setImmediate(() => cleanRoles(activeGuild).catch(err => console.error('cleanRoles interval error:', err)));    }  }, 3600000);

  // ─── Membership sync (offloaded) ───
  setImmediate(() => {    syncMembershipRoles(c).catch(err => console.error('[MembershipSync] Initial sync failed:', err));  });
  setInterval(() => {    setImmediate(() => {      syncMembershipRoles(c).catch(err => console.error('[MembershipSync] Sync error:', err.message || err));    });  }, 300000);
  setInterval(() => {    setImmediate(() => {      checkAndNotifyCooldowns(c).catch(err => console.error('Cooldown notifier error:', err));    });  }, 300000);
  setInterval(() => {    setImmediate(() => {      processEndOfDayAwards(c).catch(err => console.error('Trivia end-of-day awards error:', err));    });  }, 3600000);

  const hangmanChannelId = h.games.hangman.channelId;
  const hangmanWhitelist = h.whitelistedMessages[hangmanChannelId] || [];
  initChannelCleaner(c, hangmanChannelId, hangmanWhitelist);

  try {
    const now = new Date().toISOString();
    const activePolls = await db.query(
      `SELECT * FROM ${h.tables.POLL_AUTO_RESUME} WHERE ends_at > ?`,
      [now]
    );
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
  } catch (err) {
    console.error('Failed to fetch active polls:', err);
  }

  const { restoreGiveaways } = require('../commands/giveaway');
  setImmediate(() => {    restoreGiveaways(c).catch(console.error);  });
  const { restorePollReminders } = require('../services/pollReminders');
  setImmediate(() => {    restorePollReminders(c).catch(console.error);  });
  setImmediate(() => {    cleanupExpiredMemberships(c).catch(err => console.error('Initial membership cleanup failed:', err));  });
  setInterval(() => {    setImmediate(() => {      cleanupExpiredMemberships(c).catch(err => console.error('Scheduled membership cleanup failed:', err));    });  }, 24 * 60 * 60 * 1000);

  initMudaeMessageHandler(c);
};
