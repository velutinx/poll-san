            // web/routes/memberships.js


const h = require('../../utils/helpers');
const db = require('../../services/database');

module.exports = function setupMembershipsRoute(app, client) {
    app.get('/api/memberships', async (req, res) => {
        try {
            // Fetch all active memberships
            const subs = await db.query(`SELECT * FROM ${h.tables.MEMBERSHIPS}`);

            const guild = await client.guilds.fetch(process.env.GUILD_ID);

            const membershipData = await Promise.all(subs.map(async (sub) => {
                const now = new Date();
                const expiresAt = new Date(sub.expires_at);
                const daysLeft = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));

                let nickname = "User Left Server";
                let discordTag = sub.discord_tag || "Unknown";
                let userId = sub.discord_id;

                try {
                    const member = await guild.members.fetch(sub.discord_id);
                    nickname = member.displayName;
                    discordTag = member.user.tag;
                    userId = member.user.id;

                    if (sub.discord_tag !== discordTag) {
                        await db.query(
                            `UPDATE ${h.tables.MEMBERSHIPS} SET discord_tag = ? WHERE discord_id = ?`,
                            [discordTag, sub.discord_id]
                        );
                        console.log(`✅ Updated discord_tag for ${sub.discord_id} to ${discordTag}`);
                    }
                } catch (err) {
                    // Member left the server – keep original data
                    discordTag = sub.discord_tag || "Unknown";
                    userId = sub.discord_id;
                }

                return {
                    nickname,
                    discordTag,
                    userId,
                    rank: sub.tier.toString(),
                    daysLeft,
                    recurring: sub.recurring || false
                };
            }));

            res.json(membershipData);
        } catch (error) {
            console.error('Membership API Error:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    app.post('/api/capture-membership-order', async (req, res) => {
        console.log('🔥🔥🔥 CAPTURE ENDPOINT HIT! 🔥🔥🔥');
        try {
            const { orderId, tier, discordId } = req.body;
            if (!orderId || !tier || !discordId) {
                return res.status(400).json({ error: "Missing required fields" });
            }

            const now = new Date();
            const expirationDate = new Date();
            expirationDate.setDate(now.getDate() + 30);

            // Upsert membership
            await db.query(
                `INSERT INTO ${h.tables.MEMBERSHIPS} (discord_id, tier, order_id, updated_at, expires_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(discord_id) DO UPDATE SET
                   tier = excluded.tier,
                   order_id = excluded.order_id,
                   updated_at = excluded.updated_at,
                   expires_at = excluded.expires_at`,
                [discordId, parseInt(tier), orderId, now.toISOString(), expirationDate.toISOString()]
            );

            // Assign Discord role
            try {
                const guild = await client.guilds.fetch(process.env.GUILD_ID);
                const member = await guild.members.fetch(discordId).catch(() => null);
                if (member) {
                    const roleId = h.weights.tierMapping[String(tier)];
                    if (roleId && h.weights.tiers[roleId]) {
                        await member.roles.add(roleId);
                        console.log(`✅ Role added to ${member.user.tag}`);
                    }
                }
            } catch (discordErr) {
                console.error('⚠️ Membership saved, but Discord role failed:', discordErr);
            }

            res.json({ success: true });
        } catch (err) {
            console.error('Crash Error:', err);
            res.status(500).json({ error: "Server Crash", message: err.message });
        }
    });
};
