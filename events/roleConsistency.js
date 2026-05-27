// events/roleConsistency.js
const h = require('../utils/helpers');
const supabase = require('../services/supabase');

const SUPPORTER_ROLE = h.ids.roles.supporter;
const MEMBER_ROLE = h.ids.roles.member;
const UNVERIFIED_ROLE = h.ids.roles.unverified;
const CREATOR_ROLE = h.ids.roles.creator;
const TIER_ROLES = Object.values(h.weights.tierMapping);

module.exports = async function handleRoleUpdate(oldMember, newMember) {
    if (newMember.user.bot) return;
    if (newMember.roles.cache.has(CREATOR_ROLE)) return;

    // Skip users with an active website membership – they are handled by the sync
    try {
        const { data: activeMember } = await supabase
            .from(h.tables.MEMBERSHIPS)
            .select('id')
            .eq('discord_id', newMember.id)
            .gt('expires_at', new Date().toISOString())
            .limit(1)
            .maybeSingle();

        if (activeMember) {
            return;
        }
    } catch (err) {
        console.error(`[RoleConsistency] Supabase check failed for ${newMember.user.tag}:`, err.message);
    }

    const member = await newMember.fetch();
    const oldRoles = oldMember.roles.cache;
    const newRoles = member.roles.cache;

    const hadSupporter = oldRoles.has(SUPPORTER_ROLE);
    const hasSupporter = newRoles.has(SUPPORTER_ROLE);
    const hasAnyPaidTier = TIER_ROLES.some(roleId => newRoles.has(roleId));
    const hadMember = oldRoles.has(MEMBER_ROLE);
    const hasMember = newRoles.has(MEMBER_ROLE);
    const hasUnverified = newRoles.has(UNVERIFIED_ROLE);

    try {
        if (!hadSupporter && hasSupporter) {
            if (hasMember) {
                await member.roles.remove(MEMBER_ROLE);
     //           console.log(`[RoleConsistency] Removed Member from ${member.user.tag} (now Supporter).`);
            }
            if (hasUnverified) {
                await member.roles.remove(UNVERIFIED_ROLE);
      //          console.log(`[RoleConsistency] Removed Unverified from ${member.user.tag} (now Supporter).`);
            }
            return;
        }

        if (hadSupporter && !hasSupporter) {
            if (!hasAnyPaidTier && !hasMember) {
                await member.roles.add(MEMBER_ROLE);
                console.log(`[RoleConsistency] Added Member to ${member.user.tag} (no longer Supporter).`);
            }
            return;
        }

        if (hadMember && !hasMember) {
            if (!hasSupporter && !hasAnyPaidTier && !hasUnverified) {
                await member.roles.add(MEMBER_ROLE);
                console.log(`[RoleConsistency] Restored Member to ${member.user.tag} (was removed manually).`);
            }
            return;
        }
    } catch (err) {
        console.error(`[RoleConsistency] Error for ${member.user.tag}:`, err);
    }
};
