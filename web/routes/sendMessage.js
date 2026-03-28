// web/routes/sendMessage.js
module.exports = function setupSendMessageRoute(app, client, supabase, supabaseRetry) {
  app.post('/api/send-message', async (req, res) => {
    const { discordId } = req.body;
    try {
      const now = new Date().toISOString();

      // Fetch the most recent active membership
      const { data: membership, error } = await supabaseRetry(() =>
        supabase
          .from('memberships')
          .select('*')
          .eq('discord_id', discordId)
          .gt('expires_at', now)
          .order('expires_at', { ascending: false })
          .limit(1)
          .single()
      );
      if (error || !membership) {
        console.error('Membership fetch error:', error);
        return res.status(404).json({ error: 'No active membership found' });
      }

      // Check if already messaged for this membership period (same expires_at)
      const { data: existing, error: logError } = await supabaseRetry(() =>
        supabase
          .from('member_message_log')
          .select('id')
          .eq('discord_id', discordId)
          .eq('expires_at', membership.expires_at)
          .limit(1)
      );
      if (logError) console.error('Log check error:', logError);
      if (existing && existing.length > 0) {
        return res.status(400).json({ error: 'Already messaged for this period' });
      }

      // Fetch Discord user
      const member = await client.users.fetch(discordId).catch(() => null);
      if (!member) {
        return res.status(404).json({ error: 'Discord user not found' });
      }

      // Format expiry date
      const expiryDate = new Date(membership.expires_at);
      const expiryFormatted = expiryDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const currentMonth = new Date().toLocaleDateString('en-US', { month: 'long' });

      const tierNames = { 1: 'Bronze', 2: 'Copper', 3: 'Silver', 4: 'Gold', 5: 'Platinum' };
      const tierName = tierNames[membership.tier] || `Tier ${membership.tier}`;

      // Member message based on tier
      let memberMessage = '';
      if (membership.tier === 1) {
        memberMessage = `Hello! You have an active membership (**${tierName}**)!\nFeel free to browse the channel with all paid requests listed at :link: **[forum posts](https://discord.com/channels/1401446104498700358/1465937644394512516)**`;
      } else {
        memberMessage = `Hello! You have an active membership (**${tierName}**)!\nPlease message **[DM Velutinx](https://discord.com/users/1380051214766444617)** to redeem your **${currentMonth}** billing cycle request.`;
      }

      await member.send(memberMessage).catch(err => console.error(`Failed to send DM to ${member.tag}:`, err));

      // Admin message
      const admin = await client.users.fetch('1380051214766444617').catch(() => null);
      if (admin) {
        const adminMessage = `📢 **New membership period started for [DM ${member.tag}](${`https://discord.com/users/${discordId}`})**\nTier: ${tierName}\nExpires on ${expiryFormatted}\nPlease reach out to them.`;
        await admin.send(adminMessage).catch(err => console.error(`Failed to send DM to admin:`, err));
      } else {
        console.warn('Admin user not found');
      }

      // Log the message
      const { error: insertError } = await supabaseRetry(() =>
        supabase
          .from('member_message_log')
          .insert({
            discord_id: discordId,
            expires_at: membership.expires_at,
            sent_by: 'manual',
            message_type: 'cycle_start'
          })
      );
      if (insertError) {
        console.error('Failed to insert log:', insertError);
      } else {
        console.log(`Logged message for ${discordId} (expires: ${membership.expires_at})`);
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Send message error:', err);
      res.status(500).json({ error: err.message });
    }
  });
};
