const h = require('../utils/helpers');

const SUPPORTER_ROLE = h.ids.roles.supporter;
const MEMBER_ROLE = h.ids.roles.member;
const UNVERIFIED_ROLE = h.ids.roles.unverified;
const CREATOR_ROLE = h.ids.roles.creator;
const TIER_ROLES = Object.values(h.weights.tierMapping); // all paid tier role IDs

module.exports = async function handleRoleUpdate(oldMember, newMember) {
    // Ignore creator – they manage themselves
    if (newMember.roles.cache.has(CREATOR_ROLE)) return;

    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;

    const hadSupporter = oldRoles.has(SUPPORTER_ROLE);
    const hasSupporter = newRoles.has(SUPPORTER_ROLE);

    // Helper: does the member currently have ANY paid tier role?
    const hasAnyPaidTier = TIER_ROLES.some(roleId => newRoles.has(roleId));

    try {
        // ---- CASE 1: Gained @Supporter (or any paid tier) ----
        if (!hadSupporter && hasSupporter) {
            // Remove @Member (they shouldn't need it)
            if (newRoles.has(MEMBER_ROLE)) {
                await newMember.roles.remove(MEMBER_ROLE);
                console.log(`[RoleConsistency] Removed Member from ${newMember.user.tag} (now Supporter).`);
            }
            // Also remove Unverified if present
            if (newRoles.has(UNVERIFIED_ROLE)) {
                await newMember.roles.remove(UNVERIFIED_ROLE);
                console.log(`[RoleConsistency] Removed Unverified from ${newMember.user.tag} (now Supporter).`);
            }
            return;
        }

        // ---- CASE 2: Lost @Supporter ----
        if (hadSupporter && !hasSupporter) {
            // Only give Member if they also have NO paid tier left
            if (!hasAnyPaidTier) {
                if (!newRoles.has(MEMBER_ROLE)) {
                    await newMember.roles.add(MEMBER_ROLE);
                    console.log(`[RoleConsistency] Added Member to ${newMember.user.tag} (no longer Supporter).`);
                }
                // Make sure Unverified is gone (shouldn't be there)
                if (newRoles.has(UNVERIFIED_ROLE)) {
                    await newMember.roles.remove(UNVERIFIED_ROLE);
                }
            }
            return;
        }
    } catch (err) {
        console.error(`[RoleConsistency] Error for ${newMember.user.tag}:`, err);
    }
};
