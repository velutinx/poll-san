// utils/messaging.js

const supabase = require('../services/supabase');
const { supabaseRetry } = require('./db');
const h = require('./helpers');

const ADMIN_ID = h.ids.users.Velutinx;      // still used for DM fallback if channel missing

async function sendMembershipMessage(client, discordId, membership) {
  const now = new Date().toISOString();

  // Check if already messaged for this membership period
  const { data: existing, error: logError } = await supabaseRetry(() =>
    supabase
      .from(h.tables.MEMBER_MESSAGE_LOG)
      .select('id')
      .eq('discord_id', discordId)
      .eq('expires_at', membership.expires_at)
      .limit(1)
  );

  if (logError) console.error('Log check error:', logError);

  if (existing && existing.length > 0) {
    return false; // Already messaged
  }

  const member = await client.users.fetch(discordId).catch(() => null);
  if (!member) {
    console.warn(`Cannot send message: member ${discordId} not found`);
    return false;
  }

  const tierName = h.weights.tierNames[membership.tier] || `Tier ${membership.tier}`;
  const currentMonth = new Date().toLocaleDateString('en-US', { month: 'long' });

  // ----- 1. Paid member DM (unchanged) -----
  let memberMessage = '';
  if (membership.tier === 1) {
    memberMessage = `Hello! You have an active membership (**${tierName}**)!\nFeel free to browse the channel with all paid requests listed at :link: **[forum posts](https://discord.com/channels/1401446104498700358/1465937644394512516)**`;
  } else {
    memberMessage = `Hello! You have an active membership (**${tierName}**)!\nPlease message **[DM Velutinx](https://discord.com/users/${ADMIN_ID})** to redeem your **${currentMonth}** billing cycle request.`;
  }

  await member.send(memberMessage).catch(err => {
    console.error(`Failed to send DM to ${member.tag}:`, err.message);
  });

  // ----- 2. Admin notification → private channel instead of DM -----
  const adminChannelId = h.ids.channels.admin_channel;
  const adminChannel = client.channels.cache.get(adminChannelId);

  if (adminChannel) {
    const expiryFormatted = new Date(membership.expires_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const adminMessage = `📢 **New membership period started for ${member.tag}** (<@${discordId}>)\n` +
                         `**Tier:** ${tierName}\n` +
                         `**Expires:** ${expiryFormatted}\n` +
                         `Please reach out to them.`;

    await adminChannel.send({
      content: adminMessage,
      allowedMentions: { users: [] }   // no ping, just info
    }).catch(err => console.error('Failed to send admin channel notification:', err));
  } else {
    // Fallback: DM admin if the channel is missing
    console.warn('Admin channel not found, falling back to DM');
    const admin = await client.users.fetch(ADMIN_ID).catch(() => null);
    if (admin) {
      const expiryFormatted = new Date(membership.expires_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const adminMessage = `📢 **New membership period started for [DM ${member.tag}](${`https://discord.com/users/${discordId}`})**\nTier: ${tierName}\nExpires on ${expiryFormatted}\nPlease reach out to them.`;
      await admin.send(adminMessage).catch(err => console.error(`Failed to send DM to admin:`, err.message));
    }
  }

  // ----- 3. Log the action -----
  const { error: insertError } = await supabaseRetry(() =>
    supabase
      .from(h.tables.MEMBER_MESSAGE_LOG)
      .insert({
        discord_id: discordId,
        discord_name: member.tag,
        tier: tierName,
        expires_at: membership.expires_at,
        sent_by: 'auto',
        message_type: 'cycle_start'
      })
  );

  if (insertError) {
    console.error('Failed to insert log:', insertError.message);
  } else {
    console.log(`Logged auto message for ${discordId} (expires: ${membership.expires_at})`);
  }

  return true;
}

module.exports = { sendMembershipMessage };
