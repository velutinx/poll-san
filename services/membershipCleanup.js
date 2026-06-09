// services/membershipCleanup.js
const db = require('./database');
const h = require('../utils/helpers');

async function cleanupExpiredMemberships(client) {
    try {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Only clean memberships from 'website' source (skip patreon/subscribestar)
        const expired = await db.query(
            `SELECT * FROM ${h.tables.MEMBERSHIPS}
             WHERE source = 'website'
               AND expires_at < ? AND expires_at < ?
             ORDER BY discord_id`,
            [now.toISOString(), sevenDaysAgo.toISOString()]
        );

        if (!expired.length) return;

        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        if (!guild) return;

        for (const membership of expired) {
            const userId = membership.discord_id;
            const orderId = membership.order_id;

            // 1. Remove logs
            await db.query(
                `DELETE FROM ${h.tables.MEMBER_MESSAGE_LOG} WHERE order_id = ?`,
                [orderId]
            );

            // 2. Remove membership
            await db.query(
                `DELETE FROM ${h.tables.MEMBERSHIPS} WHERE discord_id = ? AND order_id = ?`,
                [userId, orderId]
            );

            // 3. Remove Discord role – but also check if user still has an active external membership?
            // To be safe, we can skip role removal if user has any other active membership (any source).
            const stillActive = await db.query(
                `SELECT 1 FROM ${h.tables.MEMBERSHIPS}
                 WHERE discord_id = ? AND expires_at > ?
                 LIMIT 1`,
                [userId, now.toISOString()],
                true
            );
            if (stillActive) continue; // do not remove role

            try {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    const tier = membership.tier;
                    const roleId = h.weights.tierMapping[String(tier)];
                    if (roleId) {
                        await member.roles.remove(roleId);
                    }
                }
            } catch (roleErr) {
                // silent
            }

            // Get user's name for log
            let userName = userId;
            try {
                const user = await client.users.fetch(userId);
                userName = user.username;
            } catch (_) {}
            console.log(`[MembershipCleanup] Cleaned up membership for ${userName} (order ${orderId})`);
        }
    } catch (err) {
        console.error('[MembershipCleanup] Error:', err);
    }
}

module.exports = { cleanupExpiredMemberships };
