// events/roleConsistency.js
const h = require('../utils/helpers');

const SUPPORTER_ROLE = h.ids.roles.supporter;
const MEMBER_ROLE = h.ids.roles.member;
const UNVERIFIED_ROLE = h.ids.roles.unverified;
const CREATOR_ROLE = h.ids.roles.creator;
const TIER_ROLES = Object.values(h.weights.tierMapping);

module.exports = async function handleRoleUpdate(oldMember, newMember) {
    // Ignore bots
    if (newMember.user.bot) return;

    // Never touch the Creator
    if (newMember.roles.cache.has(CREATOR_ROLE)) return;

    // Ensure fresh role data
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
        // --- CASE 1: Gained @Supporter ---
        if (!hadSupporter && hasSupporter) {
            if (hasMember) {
                await member.roles.remove(MEMBER_ROLE);
                console.log(`[RoleConsistency] Removed Member from ${member.user.tag} (now Supporter).`);
            }
            if (hasUnverified) {
                await member.roles.remove(UNVERIFIED_ROLE);
                console.log(`[RoleConsistency] Removed Unverified from ${member.user.tag} (now Supporter).`);
            }
            return;
        }

        // --- CASE 2: Lost @Supporter ---
        if (hadSupporter && !hasSupporter) {
            if (!hasAnyPaidTier && !hasMember) {
                await member.roles.add(MEMBER_ROLE);
                console.log(`[RoleConsistency] Added Member to ${member.user.tag} (no longer Supporter).`);
            }
            return;
        }

        // --- CASE 3: Lost @Member (but not because of gaining Supporter) ---
        // This catches manual removal or any other edge case.
        if (hadMember && !hasMember) {
            // Only restore if they aren't unverified, supporter, or paid tier.
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
