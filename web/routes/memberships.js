// web/routes/memberships.js
module.exports = function setupMembershipsRoute(app, client, supabase, supabaseRetry) {
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

        try {
          const member = await guild.members.fetch(sub.discord_id);
          return {
            nickname: member.displayName,
            discordTag: member.user.tag,
            userId: sub.discord_id,
            rank: sub.tier.toString(),
            daysLeft: daysLeft,
            recurring: sub.recurring || false
          };
        } catch (err) {
          return {
            nickname: "User Left Server",
            discordTag: "Unknown",
            userId: sub.discord_id,
            rank: sub.tier.toString(),
            daysLeft: daysLeft,
            recurring: sub.recurring || false
          };
        }
      }));

      res.json(membershipData);
    } catch (error) {
      console.error('Membership API Error:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
};
