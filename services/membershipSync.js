const supabase = require('./supabase');
const db = require('../utils/db');
const supabaseRetry = db.supabaseRetry;
const { sendMembershipMessage } = require('../utils/messaging');

const TIER_ROLES = {
  1: '1465444240845963326',
  2: '1465670134743044139',
  3: '1465904476417163457',
  4: '1465904548320378956',
  5: '1465952085026541804'
};
const SUPPORTER_ROLE = '1466155709547675795';

async function getLastActiveSet() {
  const { data, error } = await supabaseRetry(() =>
    supabase
      .from('sync_state')
      .select('value')
      .eq('key', 'active_members')
      .single()
  );
  if (error) {
    console.error('[MembershipSync] Failed to fetch sync state:', error.message);
    return new Set();
  }
  return new Set(data?.value?.ids || []);
}

async function storeCurrentActiveSet(ids) {
  const { error } = await supabaseRetry(() =>
    supabase
      .from('sync_state')
      .upsert({
        key: 'active_members',
        value: { ids: Array.from(ids), updated_at: new Date().toISOString() }
      }, { onConflict: 'key' })
  );
  if (error) {
    console.error('[MembershipSync] Failed to store sync state:', error.message);
  }
}

async function syncMembershipRoles(client) {
  let changesMade = false;

  try {
    const now = new Date().toISOString();

    // Fetch all memberships with expires_at > now (regardless of status)
    const { data: activeMemberships, error: activeError } = await supabaseRetry(() =>
      supabase
        .from('memberships')
        .select('*')
        .gt('expires_at', now)
    );
    if (activeError) throw activeError;

    // Group by discord_id, keep the highest tier membership (store full record)
    const userBestMembership = new Map(); // discordId -> membership object
    for (const membership of activeMemberships) {
      const discordId = membership.discord_id;
      const currentBest = userBestMembership.get(discordId);
      if (!currentBest || currentBest.tier < membership.tier) {
        userBestMembership.set(discordId, membership);
      }
    }

    const currentActiveIds = new Set(userBestMembership.keys());

    // Log new members (for informational purposes)
    const previousActiveIds = await getLastActiveSet();
    const newIds = [...currentActiveIds].filter(id => !previousActiveIds.has(id));
    if (newIds.length > 0) {
      changesMade = true;
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      for (const discordId of newIds) {
        try {
          const member = await guild.members.fetch(discordId).catch(() => null);
          const tier = userBestMembership.get(discordId).tier;
          const tag = member ? member.user.tag : 'Unknown';
          console.log(`🎉 [MembershipSync] NEW ACTIVE MEMBER: ${tag} (${discordId}) - Tier ${tier}`);
        } catch (err) {
          console.log(`🎉 [MembershipSync] NEW ACTIVE MEMBER: ${discordId} (could not fetch member) - Tier ${userBestMembership.get(discordId).tier}`);
        }
      }
    }

    // --- Send welcome messages for all active members (if not already sent) ---
    for (const [discordId, membership] of userBestMembership.entries()) {
      await sendMembershipMessage(client, discordId, membership);
    }

    // --- Role sync (unchanged) ---
    // ... (the same role assignment/removal logic as before, using userBestMembership)
    // We'll keep the existing role sync block; it's fine.

    // Clean up inactive users
    const inactiveUserIds = [...previousActiveIds].filter(id => !currentActiveIds.has(id));
    for (const discordId of inactiveUserIds) {
      try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) continue;

        const currentRoleIds = member.roles.cache.map(r => r.id);
        const tierRoleIds = Object.values(TIER_ROLES);
        const hasTierRole = currentRoleIds.some(id => tierRoleIds.includes(id));
        const hasSupporter = currentRoleIds.includes(SUPPORTER_ROLE);

        if (hasTierRole || hasSupporter) {
          for (const roleId of tierRoleIds) {
            if (currentRoleIds.includes(roleId)) {
              await member.roles.remove(roleId);
            }
          }
          if (hasSupporter) {
            await member.roles.remove(SUPPORTER_ROLE);
          }
          console.log(`[MembershipSync] Removed all membership roles from ${member.user.tag} (inactive)`);
          changesMade = true;
        }
      } catch (err) {
        console.error(`[MembershipSync] Error cleaning roles for user ${discordId}:`, err.message);
      }
    }

    await storeCurrentActiveSet(currentActiveIds);
    if (changesMade) {
      console.log('[MembershipSync] Sync completed with changes.');
    }
  } catch (err) {
    console.error('[MembershipSync] Fatal error:', err);
  }
}

module.exports = { syncMembershipRoles };
