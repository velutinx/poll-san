const h = require('../../utils/helpers');

module.exports = function setupMembershipsRoute(app, client, supabase, supabaseRetry) {
    app.get('/api/memberships', async (req, res) => {
        try {
            // 🔧 FIX: added .select('*') to actually fetch data
const { data: subs, error } = await supabaseRetry(() =>
    supabase.from(h.tables.MEMBERSHIPS).select('*')
);
if (error) {
    console.error('Membership fetch error:', error);
    return res.status(500).json({ error: 'Database error' });
}
if (!subs || !Array.isArray(subs)) {
    console.warn('No valid membership data, returning empty array');
    return res.json([]);
}

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
                        await supabaseRetry(() =>
                            supabase.from(h.tables.MEMBERSHIPS)
                                .update({ discord_tag: discordTag })
                                .eq('discord_id', sub.discord_id)
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

            const { error } = await supabaseRetry(() =>
                supabase.from(h.tables.MEMBERSHIPS)
                    .upsert({
                        discord_id: discordId,
                        tier: parseInt(tier),
                        order_id: orderId,
                        updated_at: now.toISOString(),
                        expires_at: expirationDate.toISOString()
                    }, { onConflict: 'discord_id' })
            );

            if (error) {
                console.error('Supabase Error:', error);
                return res.status(500).json({ error: "Database error", details: error.message });
            }

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
