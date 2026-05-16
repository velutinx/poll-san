  //  /events/roleConsistency.js

const h = require('../utils/helpers');
const SUPPORTER_ROLE = h.ids.roles.supporter;
const MEMBER_ROLE = h.ids.roles.member;
const UNVERIFIED_ROLE = h.ids.roles.unverified;
const CREATOR_ROLE = h.ids.roles.creator;
const TIER_ROLES = Object.values(h.weights.tierMapping);

module.exports = async function handleRoleUpdate(oldMember, newMember) {
    console.log(`[RoleConsistency] Fired for ${newMember.user.tag}`);
    if (newMember.roles.cache.has(CREATOR_ROLE)) return;

    try {
        const member = await newMember.fetch();
        const oldRoles = oldMember.roles.cache;
        const newRoles = member.roles.cache;
        const hadSupporter = oldRoles.has(SUPPORTER_ROLE);
        const hasSupporter = newRoles.has(SUPPORTER_ROLE);
        const hasAnyPaidTier = TIER_ROLES.some(roleId => newRoles.has(roleId));

        // CASE 1: Gained @Supporter
        if (!hadSupporter && hasSupporter) {
            if (newRoles.has(MEMBER_ROLE)) {
                await member.roles.remove(MEMBER_ROLE);
                console.log(`[RoleConsistency] Removed Member from ${member.user.tag}`);
            }
            if (newRoles.has(UNVERIFIED_ROLE)) {
                await member.roles.remove(UNVERIFIED_ROLE);
                console.log(`[RoleConsistency] Removed Unverified from ${member.user.tag}`);
            }
            return;
        }

        // CASE 2: Lost @Supporter
        if (hadSupporter && !hasSupporter) {
            if (!hasAnyPaidTier) {
                if (!newRoles.has(MEMBER_ROLE)) {
                    await member.roles.add(MEMBER_ROLE);
                    console.log(`[RoleConsistency] Added Member to ${member.user.tag} (no longer Supporter)`);
                }
                if (newRoles.has(UNVERIFIED_ROLE)) {
                    await member.roles.remove(UNVERIFIED_ROLE);
                }
            }
            return;
        }
    } catch (err) {
        console.error(`[RoleConsistency] Error for ${newMember.user.tag}:`, err);
    }
};
