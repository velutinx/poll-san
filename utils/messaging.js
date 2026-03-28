// utils/messaging.js
const supabase = require('../services/supabase');
const { supabaseRetry } = require('./db');

const ADMIN_ID = '1380051214766444617'; // Velutinx

const tierNames = {
  1: 'Bronze',
  2: 'Copper',
  3: 'Silver',
  4: 'Gold',
  5: 'Platinum'
};

async function sendMembershipMessage(client, discordId, membership) {
  const now = new Date().toISOString();

  // Check if already messaged for this membership period
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
    console.log(`Already messaged for membership period ${membership.expires_at} for ${discordId}`);
    return false; // Already messaged
  }

  // Send DM to member
  const member = await client.users.fetch(discordId).catch(() => null);
  if (!member) {
    console.warn(`Cannot send message: member ${discordId} not found`);
    return false;
  }

  const tierName = tierNames[membership.tier] || `Tier ${membership.tier}`;
  const currentMonth = new Date().toLocaleDateString('en-US', { month: 'long' });

  let memberMessage = '';
  if (membership.tier === 1) {
    memberMessage = `Hello! You have an active membership (**${tierName}**)!\nFeel free to browse the channel with all paid requests listed at :link: **[forum posts](https://discord.com/channels/1401446104498700358/1465937644394512516)**`;
  } else {
    memberMessage = `Hello! You have an active membership (**${tierName}**)!\nPlease message **[DM Velutinx](https://discord.com/users/${ADMIN_ID})** to redeem your **${currentMonth}** billing cycle request.`;
  }

  await member.send(memberMessage).catch(err => {
    console.error(`Failed to send DM to ${member.tag}:`, err);
  });

  // Admin message
  const admin = await client.users.fetch(ADMIN_ID).catch(() => null);
  if (admin) {
    const expiryFormatted = new Date(membership.expires_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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
        sent_by: 'auto',
        message_type: 'cycle_start'
      })
  );
  if (insertError) {
    console.error('Failed to insert log:', insertError);
  } else {
    console.log(`Logged auto message for ${discordId} (expires: ${membership.expires_at})`);
  }

  return true;
}

module.exports = { sendMembershipMessage };
