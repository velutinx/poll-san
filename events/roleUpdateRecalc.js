// events/roleUpdateRecalc.js
const h = require('../utils/helpers');
const db = require('../services/database');

const WEIGHTED_ROLES = Object.values(h.weights.tiers);

module.exports = async (oldMember, newMember) => {
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    const gainedWeightedRole = addedRoles.some(role => WEIGHTED_ROLES.includes(role.id));
    if (!gainedWeightedRole) return;

    const userId = newMember.id;

    try {
        // Find the active poll
        const activePoll = await db.query(
            `SELECT * FROM ${h.tables.POLL_AUTO_RESUME}
             WHERE ends_at > ?
             ORDER BY id DESC
             LIMIT 1`,
            [new Date().toISOString()],
            true   // single row
        );

        if (!activePoll) return;

        // Look for an existing vote from this user in the active poll
        const existingVote = await db.query(
            `SELECT * FROM ${h.tables.POLL_VOTING_DISCORD}
             WHERE poll_id = ? AND user_id = ?`,
            [activePoll.message_id, userId],
            true
        );

        if (!existingVote) return;

        const member = newMember;
        let weight = 0.9;

        for (const [roleId, roleWeight] of Object.entries(h.weights.tiers)) {
            if (member.roles.cache.has(roleId)) {
                weight = roleWeight;
                break;
            }
        }

        if (weight === existingVote.weight) return;

        // Update the vote weight using the composite key
        await db.query(
            `UPDATE ${h.tables.POLL_VOTING_DISCORD}
             SET weight = ?
             WHERE user_id = ? AND poll_id = ?`,
            [weight, userId, activePoll.message_id]
        );

        console.log(`🔄 Updated vote weight for ${newMember.user.tag} from ${existingVote.weight} to ${weight}`);

        if (global.refreshPollDashboard) {
            global.refreshPollDashboard();
        }
    } catch (err) {
        console.error('Role update recalc error:', err);
    }
};
