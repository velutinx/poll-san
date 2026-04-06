// this is poll-san/web/routes/memberships.js

module.exports = function setupMembershipsRoute(app, client, supabase, supabaseRetry) {
  // GET endpoint – now updates discord_tag in DB
  app.get('/api/memberships', async (req, res) => {
    try {
      const { data: subs, error } = await supabaseRetry(() =>
        supabase.from('memberships').select('*')
      );
      if (error) throw error;

      const guild = await client.guilds.fetch(process.env.GUILD_ID);

      const membershipData = await Promise.all(subs.map(async (sub) => {
        const now = new Date();
        const expiresAt = new Date(sub.expires_at);
        const daysLeft = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));

        let nickname = "User Left Server";
        let discordTag = sub.discord_tag || "Unknown"; // use stored tag if present
        let userId = sub.discord_id;

        try {
          const member = await guild.members.fetch(sub.discord_id);
          nickname = member.displayName;
          discordTag = member.user.tag;
          userId = member.user.id;

          // Update stored tag if missing or changed
          if (sub.discord_tag !== discordTag) {
            await supabaseRetry(() =>
              supabase.from('memberships')
                .update({ discord_tag: discordTag })
                .eq('discord_id', sub.discord_id)
            );
            console.log(`✅ Updated discord_tag for ${sub.discord_id} to ${discordTag}`);
          }
        } catch (err) {
          // Member not in server – use stored tag if any
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

  // POST endpoint: capture membership order (unchanged, but now respects existing tag)
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

      // Note: we don't have the tag here – it will be filled by the GET endpoint later
      const { error } = await supabaseRetry(() =>
        supabase.from('memberships')
          .upsert({
            discord_id: discordId,
            tier: parseInt(tier),
            order_id: orderId,
            updated_at: now.toISOString(),
            expires_at: expirationDate.toISOString()
            // discord_tag is omitted; will be updated on next dashboard load
          }, { onConflict: 'discord_id' })
      );

      if (error) {
        console.error('Supabase Error:', error);
        return res.status(500).json({ error: "Database error", details: error.message });
      }

      // Discord role assignment
      try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(discordId).catch(() => null);

        if (member) {
          const tierRoles = {
            "1": "1465444240845963326",  // ✨ Bronze
            "2": "1465670134743044139",  // ✨ Copper
            "3": "1465904476417163457",  // ✨ Silver
            "4": "1465904548320378956",  // ✨ Gold
            "5": "1465952085026541804"   // ✨ Platinum
          };
          const roleId = tierRoles[String(tier)];
          if (roleId) {
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
