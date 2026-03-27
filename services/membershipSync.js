// services/membershipSync.js
const { supabaseRetry } = require('../utils/db'); // adjust path as needed
const { ChannelType } = require('discord.js'); // not needed but kept for consistency

const TIER_ROLES = {
  1: '1465444240845963326',  // Bronze
  2: '1465670134743044139',  // Copper
  3: '1465904476417163457',  // Silver
  4: '1465904548320378956',  // Gold
  5: '1465952085026541804'   // Platinum
};
const SUPPORTER_ROLE = '1466155709547675795';

/**
 * Sync roles for all members based on active memberships
 * @param {Client} client - Discord client instance
 */
async function syncMembershipRoles(client) {
  console.log('[MembershipSync] Starting sync...');
  try {
    const now = new Date().toISOString();

    // Fetch all ACTIVE memberships (status = 'ACTIVE' and expires_at > now)
    const { data: activeMemberships, error: activeError } = await supabaseRetry(() =>
      supabase
        .from('memberships')
        .select('*')
        .eq('status', 'ACTIVE')
        .gt('expires_at', now)
    );
    if (activeError) throw activeError;

    // Group by discord_id, keep the highest tier (if multiple, highest tier)
    const userBestTier = new Map(); // discord_id -> tier
    for (const membership of activeMemberships) {
      const discordId = membership.discord_id;
      const tier = membership.tier;
      if (!userBestTier.has(discordId) || userBestTier.get(discordId) < tier) {
        userBestTier.set(discordId, tier);
      }
    }

    // For users with active memberships, ensure they have the correct roles
    for (const [discordId, tier] of userBestTier.entries()) {
      try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) {
          console.warn(`[MembershipSync] Member ${discordId} not found in guild`);
          continue;
        }

        // Determine which tier role should be assigned
        const targetTierRole = TIER_ROLES[tier];
        if (!targetTierRole) {
          console.warn(`[MembershipSync] Unknown tier ${tier} for ${discordId}`);
          continue;
        }

        // Get current roles
        const currentRoleIds = member.roles.cache.map(r => r.id);
        const hasSupporter = currentRoleIds.includes(SUPPORTER_ROLE);

        // Remove any tier roles that are not the target one
        const tierRoleIds = Object.values(TIER_ROLES);
        for (const roleId of tierRoleIds) {
          if (currentRoleIds.includes(roleId) && roleId !== targetTierRole) {
            await member.roles.remove(roleId);
            console.log(`[MembershipSync] Removed old tier role ${roleId} from ${member.user.tag}`);
          }
        }

        // Add target tier role if not present
        if (!currentRoleIds.includes(targetTierRole)) {
          await member.roles.add(targetTierRole);
          console.log(`[MembershipSync] Added tier role ${targetTierRole} to ${member.user.tag}`);
        }

        // Add supporter role if not present
        if (!hasSupporter) {
          await member.roles.add(SUPPORTER_ROLE);
          console.log(`[MembershipSync] Added supporter role to ${member.user.tag}`);
        }

      } catch (err) {
        console.error(`[MembershipSync] Error processing user ${discordId}:`, err.message);
      }
    }

    // Now handle users who have no active membership (expired or cancelled)
    // Fetch all memberships that are NOT active or have expired
    const { data: inactiveMemberships, error: inactiveError } = await supabaseRetry(() =>
      supabase
        .from('memberships')
        .select('discord_id')
        .or(`status.neq.ACTIVE,expires_at.lte.${now}`)
    );
    if (inactiveError) throw inactiveError;

    // Extract unique user IDs from inactive records
    const inactiveUserIds = new Set();
    for (const membership of inactiveMemberships) {
      inactiveUserIds.add(membership.discord_id);
    }

    // Remove roles from inactive users
    for (const discordId of inactiveUserIds) {
      // Skip if this user also appears in active memberships (they might have another active sub)
      if (userBestTier.has(discordId)) continue;

      try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) continue;

        const currentRoleIds = member.roles.cache.map(r => r.id);
        const tierRoleIds = Object.values(TIER_ROLES);
        const hasTierRole = currentRoleIds.some(id => tierRoleIds.includes(id));
        const hasSupporter = currentRoleIds.includes(SUPPORTER_ROLE);

        if (hasTierRole || hasSupporter) {
          // Remove all tier roles
          for (const roleId of tierRoleIds) {
            if (currentRoleIds.includes(roleId)) {
              await member.roles.remove(roleId);
            }
          }
          // Remove supporter role if present
          if (hasSupporter) {
            await member.roles.remove(SUPPORTER_ROLE);
          }
          console.log(`[MembershipSync] Removed all membership roles from ${member.user.tag} (inactive)`);
        }
      } catch (err) {
        console.error(`[MembershipSync] Error cleaning roles for user ${discordId}:`, err.message);
      }
    }

    console.log('[MembershipSync] Sync completed.');
  } catch (err) {
    console.error('[MembershipSync] Fatal error:', err);
  }
}

module.exports = { syncMembershipRoles };
