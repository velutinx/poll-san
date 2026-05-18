// services/accessGuard.js
const h = require('../utils/helpers');

const MEMBER_ROLE = h.ids.roles.member;
const SUPPORTER_ROLE = h.ids.roles.supporter;
const CREATOR_ROLE = h.ids.roles.creator;
const TIER_ROLES = Object.values(h.weights.tierMapping);

module.exports = async function ensureAccessRoles(guild) {
    try {
        const members = await guild.members.fetch();
        for (const member of members.values()) {
            // Never touch the Creator
            if (member.roles.cache.has(CREATOR_ROLE)) continue;

            const hasSupporter = member.roles.cache.has(SUPPORTER_ROLE);
            const hasAnyPaidTier = TIER_ROLES.some(id => member.roles.cache.has(id));
            const hasMember = member.roles.cache.has(MEMBER_ROLE);

            // If they have no paid role and not even the basic Member role → add it
            if (!hasSupporter && !hasAnyPaidTier && !hasMember) {
                await member.roles.add(MEMBER_ROLE);
                console.log(`[AccessGuard] Added Member to ${member.user.tag} (was role‑less).`);
            }
        }
    } catch (err) {
        console.error('[AccessGuard] Error:', err);
    }
};
