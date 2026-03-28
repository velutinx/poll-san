// web/routes/sendMessage.js
module.exports = function setupSendMessageRoute(app, client, supabase, supabaseRetry) {
  app.post('/api/send-message', async (req, res) => {
    const { discordId } = req.body;
    try {
      const now = new Date().toISOString();
      
      // Fetch the most recent active membership for this user
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

      // Determine the correct primary key column
      const membershipId = membership.idx || membership.id;
      if (!membershipId) {
        console.error('Membership has no idx or id:', membership);
        return res.status(500).json({ error: 'Invalid membership record' });
      }

      // Check if already messaged for this membership period
      const { data: existing, error: logError } = await supabaseRetry(() =>
        supabase
          .from('member_message_log')
          .select('id')
          .eq('membership_idx', membershipId)
          .limit(1)
      );
      if (logError) {
        console.error('Log check error:', logError);
      }
      if (existing && existing.length > 0) {
        return res.status(400).json({ error: 'Already messaged for this period' });
      }

      // Send DM to member
      const member = await client.users.fetch(discordId).catch(() => null);
      if (!member) {
        return res.status(404).json({ error: 'Discord user not found' });
      }

      // Format expiry date
      const expiryDate = new Date(membership.expires_at);
      const expiryFormatted = expiryDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      // Current month for member message
      const currentMonth = new Date().toLocaleDateString('en-US', { month: 'long' });

      // Tier name mapping
      const tierNames = {
        1: 'Bronze',
        2: 'Copper',
        3: 'Silver',
        4: 'Gold',
        5: 'Platinum'
      };
      const tierName = tierNames[membership.tier] || `Tier ${membership.tier}`;

      // Member message based on tier
      let memberMessage = '';
      if (membership.tier === 1) {
        memberMessage = `Hello! You have an active membership (**${tierName}**)!\nFeel free to browse the channel with all paid requests listed at :link: **[forum posts](https://discord.com/channels/1401446104498700358/1465937644394512516)**`;
      } else {
        memberMessage = `Hello! You have an active membership (**${tierName}**)!\nPlease message **[DM Velutinx](https://discord.com/users/1380051214766444617)** to redeem your **${currentMonth}** billing cycle request.`;
      }

      await member.send(memberMessage).catch(err => {
        console.error(`Failed to send DM to ${member.tag}:`, err);
        // Don't fail the whole request, but log
      });

      // Admin message with clickable user link
      const admin = await client.users.fetch('1380051214766444617').catch(() => null);
      if (admin) {
        const adminMessage = `📢 **New membership period started for [DM ${member.tag}](${`https://discord.com/users/${discordId}`})**\nTier: ${tierName}\nExpires on ${expiryFormatted}\nPlease reach out to them.`;
        await admin.send(adminMessage).catch(err => {
          console.error(`Failed to send DM to admin:`, err);
        });
      } else {
        console.warn('Admin user not found or not reachable');
      }

      // Log the message
      const { error: insertError } = await supabaseRetry(() =>
        supabase
          .from('member_message_log')
          .insert({
            membership_idx: membershipId,
            discord_id: discordId,
            sent_by: 'manual',
            message_type: 'cycle_start'
          })
      );
      if (insertError) {
        console.error('Failed to insert log:', insertError);
        // Don't return error; message was already sent, just warn
      } else {
        console.log(`Logged message for member ${discordId} (membership_id: ${membershipId})`);
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Send message error:', err);
      res.status(500).json({ error: err.message });
    }
  });
};
