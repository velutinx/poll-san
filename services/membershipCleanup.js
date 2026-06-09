// services/membershipCleanup.js
const db = require('./database');
const h = require('../utils/helpers');

/**
 * Clean up expired memberships that are 7+ days overdue.
 * Removes from purchase_memberships, purchase_member_message_log, and Discord role.
 */
async function cleanupExpiredMemberships(client) {
    try {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Find expired memberships that are older than 7 days
        const expired = await db.query(
            `SELECT * FROM ${h.tables.MEMBERSHIPS}
             WHERE expires_at < ? AND expires_at < ?
             ORDER BY discord_id`,
            [now.toISOString(), sevenDaysAgo.toISOString()]
        );

        if (!expired.length) return;

        console.log(`[MembershipCleanup] Found ${expired.length} expired memberships to clean.`);

        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        if (!guild) {
            console.error('[MembershipCleanup] Guild not found.');
            return;
        }

        for (const membership of expired) {
            const userId = membership.discord_id;
            const orderId = membership.order_id;

            // 1. Remove from purchase_member_message_log
            await db.query(
                `DELETE FROM ${h.tables.MEMBER_MESSAGE_LOG} WHERE order_id = ?`,
                [orderId]
            );

            // 2. Remove from purchase_memberships
            await db.query(
                `DELETE FROM ${h.tables.MEMBERSHIPS} WHERE discord_id = ? AND order_id = ?`,
                [userId, orderId]
            );

            // 3. Remove Discord role
            try {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    const tier = membership.tier;
                    const roleId = h.weights.tierMapping[String(tier)];
                    if (roleId) {
                        await member.roles.remove(roleId);
                        console.log(`[MembershipCleanup] Removed role ${roleId} from ${userId}`);
                    } else {
                        console.warn(`[MembershipCleanup] No role mapping for tier ${tier}`);
                    }
                } else {
                    console.log(`[MembershipCleanup] User ${userId} not in server, skipped role removal.`);
                }
            } catch (roleErr) {
                console.error(`[MembershipCleanup] Failed to remove role for ${userId}:`, roleErr.message);
            }

            console.log(`[MembershipCleanup] Cleaned up membership for ${userId} (order ${orderId})`);
        }
    } catch (err) {
        console.error('[MembershipCleanup] Error:', err);
    }
}

module.exports = { cleanupExpiredMemberships };
