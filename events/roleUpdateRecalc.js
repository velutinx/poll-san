// events/roleUpdateRecalc.js
const h = require('../utils/helpers');
const db = require('../services/database');

const WEIGHTED_ROLES = Object.values(h.weights.tiers);

async function calculateFullWeight(member) {
    let weight = 1.0;
    let baseWeight = 1.0;

    const hasMemberRole = member.roles.cache.has(h.ids.roles.member);
    if (hasMemberRole) {
        baseWeight = 0.9;
    } else {
        let highestTier = 1.0;
        for (const [roleId, multiplier] of Object.entries(h.weights.tiers)) {
            if (member.roles.cache.has(roleId)) {
                if (multiplier > highestTier) highestTier = multiplier;
            }
        }
        baseWeight = highestTier;
    }
    weight = baseWeight;

    if (member.roles.cache.has(h.weights.booster)) {
        weight += 0.5;
    }

    const xpData = await db.query(
        `SELECT level FROM ${h.tables.USER_XP}
         WHERE user_id = ? AND guild_id = ?`,
        [member.id, member.guild.id],
        true
    );
    if (xpData?.level) {
        weight += (xpData.level * h.weights.xpFactor);
    }

    const antiquityRow = await db.query(
        `SELECT membership_antiquity FROM ${h.tables.PURCHASE_MEMBERSHIP_ANTIQUITY}
         WHERE discord_id = ?`,
        [member.id],
        true
    );
    if (antiquityRow?.membership_antiquity) {
        const antiquity = parseInt(antiquityRow.membership_antiquity, 10) || 0;
        weight += antiquity * 0.1;   // +0.1 per month
    }

    return parseFloat(weight.toFixed(2));
}

module.exports = async (oldMember, newMember) => {
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    const gainedWeightedRole = addedRoles.some(role => WEIGHTED_ROLES.includes(role.id));
    if (!gainedWeightedRole) return;

    const userId = newMember.id;

    try {
        const activePoll = await db.query(
            `SELECT * FROM ${h.tables.POLL_AUTO_RESUME}
             WHERE ends_at > ?
             ORDER BY id DESC
             LIMIT 1`,
            [new Date().toISOString()],
            true
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

        const newWeight = await calculateFullWeight(newMember);

        if (newWeight === existingVote.weight) return;

        await db.query(
            `UPDATE ${h.tables.POLL_VOTING_DISCORD}
             SET weight = ?
             WHERE user_id = ? AND poll_id = ?`,
            [newWeight, userId, activePoll.message_id]
        );

        console.log(`🔄 Updated vote weight for ${newMember.user.tag} from ${existingVote.weight} to ${newWeight}`);

        if (global.refreshPollDashboard) {
            global.refreshPollDashboard();
        }
    } catch (err) {
        console.error('Role update recalc error:', err);
    }
};
