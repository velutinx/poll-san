const supabase = require('./supabase');
const db = require('../utils/db');
const supabaseRetry = db.supabaseRetry;

const TIER_ROLES = {
  1: '1465444240845963326',
  2: '1465670134743044139',
  3: '1465904476417163457',
  4: '1465904548320378956',
  5: '1465952085026541804'
};
const SUPPORTER_ROLE = '1466155709547675795';

// Translation dictionary for user messages
const MESSAGES = {
  en: {
    welcome: "🎉 Welcome to the {tierName} tier! Your membership is active until **{expiryDate}**. You can now access exclusive content and perks.\n\n",
    recurring: "Your subscription is recurring and will automatically renew each month. You can cancel anytime from your PayPal account.\n\n",
    joinDiscord: "**Join our Discord server:** {inviteLink}\nMake sure to link your Discord account (you already did!) to get your role.",
    footer: "Thank you for your support! 🖤"
  },
  ja: {
    welcome: "🎉 {tierName} ティアへようこそ！あなたのメンバーシップは **{expiryDate}** まで有効です。これで限定コンテンツや特典にアクセスできます。\n\n",
    recurring: "サブスクリプションは毎月自動更新されます。いつでもPayPalアカウントから解約できます。\n\n",
    joinDiscord: "**Discordサーバーに参加:** {inviteLink}\nあなたのDiscordアカウントはすでに連携されています。ロールが自動で付与されます。",
    footer: "ご支援ありがとうございます！ 🖤"
  },
  zh: {
    welcome: "🎉 欢迎加入 {tierName} 等级！您的会员资格有效至 **{expiryDate}**。您现在可以访问独家内容和特权。\n\n",
    recurring: "订阅每月自动续费。您可以随时从 PayPal 账户取消。\n\n",
    joinDiscord: "**加入我们的 Discord 服务器:** {inviteLink}\n您的 Discord 账号已关联，角色将自动分配。",
    footer: "感谢您的支持！ 🖤"
  },
  es: {
    welcome: "🎉 ¡Bienvenido al nivel {tierName}! Tu membresía está activa hasta el **{expiryDate}**. Ahora puedes acceder a contenido exclusivo y beneficios.\n\n",
    recurring: "Tu suscripción se renueva automáticamente cada mes. Puedes cancelarla en cualquier momento desde tu cuenta de PayPal.\n\n",
    joinDiscord: "**Únete a nuestro servidor de Discord:** {inviteLink}\nTu cuenta de Discord ya está vinculada. El rol se asignará automáticamente.",
    footer: "¡Gracias por tu apoyo! 🖤"
  }
};

// Helper: format date to user‑friendly string
function formatDate(date) {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// Helper: get language for a given order ID from successs table
async function getLanguageForOrder(orderId) {
  if (!orderId) return 'en';
  const { data, error } = await supabaseRetry(() =>
    supabase
      .from('successs')
      .select('language')
      .eq('paypal_token', orderId)
      .single()
  );
  if (error || !data) {
    console.warn(`[MembershipSync] Could not fetch language for order ${orderId}:`, error?.message);
    return 'en';
  }
  return data.language || 'en';
}

// Helper: send a DM to a user
async function sendDM(member, content) {
  try {
    await member.send(content);
    console.log(`[MembershipSync] DM sent to ${member.user.tag}`);
  } catch (err) {
    console.error(`[MembershipSync] Failed to send DM to ${member.user.tag}:`, err.message);
  }
}

// Main function to send welcome message
async function sendMembershipMessage(client, discordId, membership) {
  const tier = membership.tier;
  const expiresAt = new Date(membership.expires_at);
  const tierNames = { 1: 'Bronze', 2: 'Copper', 3: 'Silver', 4: 'Gold', 5: 'Platinum' };
  const tierName = tierNames[tier] || `Tier ${tier}`;

  // Fetch language from the order
  const lang = await getLanguageForOrder(membership.order_id);
  const t = MESSAGES[lang] || MESSAGES.en;

  // Build message
  let message = t.welcome
    .replace('{tierName}', tierName)
    .replace('{expiryDate}', formatDate(expiresAt));

  if (membership.recurring) {
    message += t.recurring;
  }

  const inviteLink = 'https://discord.gg/your-invite'; // Replace with your server invite
  message += t.joinDiscord.replace('{inviteLink}', inviteLink);
  message += '\n\n' + t.footer;

  // Send DM
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(discordId);
    await sendDM(member, message);
  } catch (err) {
    console.error(`[MembershipSync] Could not send DM to ${discordId}:`, err.message);
  }
}

// Existing syncMembershipRoles function (unchanged except the call to sendMembershipMessage)
async function getLastActiveSet() {
  const { data, error } = await supabaseRetry(() =>
    supabase
      .from('sync_state')
      .select('value')
      .eq('key', 'active_members')
      .single()
  );
  if (error) {
    console.error('[MembershipSync] Failed to fetch sync state:', error.message);
    return new Set();
  }
  return new Set(data?.value?.ids || []);
}

async function storeCurrentActiveSet(ids) {
  const { error } = await supabaseRetry(() =>
    supabase
      .from('sync_state')
      .upsert({
        key: 'active_members',
        value: { ids: Array.from(ids), updated_at: new Date().toISOString() }
      }, { onConflict: 'key' })
  );
  if (error) {
    console.error('[MembershipSync] Failed to store sync state:', error.message);
  }
}

async function syncMembershipRoles(client) {
  let changesMade = false;

  try {
    const now = new Date().toISOString();

    // Fetch all memberships with expires_at > now (regardless of status)
    const { data: activeMemberships, error: activeError } = await supabaseRetry(() =>
      supabase
        .from('memberships')
        .select('*')
        .gt('expires_at', now)
    );
    if (activeError) throw activeError;

    // Group by discord_id, keep the highest tier membership (store full record)
    const userBestMembership = new Map(); // discordId -> membership object
    for (const membership of activeMemberships) {
      const discordId = membership.discord_id;
      const currentBest = userBestMembership.get(discordId);
      if (!currentBest || currentBest.tier < membership.tier) {
        userBestMembership.set(discordId, membership);
      }
    }

    const currentActiveIds = new Set(userBestMembership.keys());

    // Log new members (for informational purposes)
    const previousActiveIds = await getLastActiveSet();
    const newIds = [...currentActiveIds].filter(id => !previousActiveIds.has(id));
    if (newIds.length > 0) {
      changesMade = true;
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      for (const discordId of newIds) {
        try {
          const member = await guild.members.fetch(discordId).catch(() => null);
          const tier = userBestMembership.get(discordId).tier;
          const tag = member ? member.user.tag : 'Unknown';
          console.log(`🎉 [MembershipSync] NEW ACTIVE MEMBER: ${tag} (${discordId}) - Tier ${tier}`);
        } catch (err) {
          console.log(`🎉 [MembershipSync] NEW ACTIVE MEMBER: ${discordId} (could not fetch member) - Tier ${userBestMembership.get(discordId).tier}`);
        }
      }
    }

    // --- Send welcome messages for all active members (if not already sent) ---
    // We should only send once per membership. Using a flag in the database would be better,
    // but for simplicity, we can check if the member is new (by comparing to previous set)
    // and only send to those new members. We'll send only to newly added users.
    for (const discordId of newIds) {
      const membership = userBestMembership.get(discordId);
      await sendMembershipMessage(client, discordId, membership);
    }

    // --- Role sync (assign roles based on best tier) ---
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    for (const [discordId, membership] of userBestMembership.entries()) {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;

      const currentRoleIds = member.roles.cache.map(r => r.id);
      const targetRoleId = TIER_ROLES[membership.tier];
      const hasTargetRole = currentRoleIds.includes(targetRoleId);
      const hasSupporter = currentRoleIds.includes(SUPPORTER_ROLE);

      // Add target role if missing
      if (!hasTargetRole) {
        await member.roles.add(targetRoleId);
        console.log(`[MembershipSync] Added role ${targetRoleId} to ${member.user.tag} (tier ${membership.tier})`);
        changesMade = true;
      }

      // Add supporter role if missing (only for tier >= 1? Actually for all members)
      if (!hasSupporter) {
        await member.roles.add(SUPPORTER_ROLE);
        console.log(`[MembershipSync] Added supporter role to ${member.user.tag}`);
        changesMade = true;
      }

      // Remove any other tier roles that are not the highest
      for (const roleId of Object.values(TIER_ROLES)) {
        if (roleId !== targetRoleId && currentRoleIds.includes(roleId)) {
          await member.roles.remove(roleId);
          console.log(`[MembershipSync] Removed lower tier role ${roleId} from ${member.user.tag}`);
          changesMade = true;
        }
      }
    }

    // Clean up inactive users
    const inactiveUserIds = [...previousActiveIds].filter(id => !currentActiveIds.has(id));
    for (const discordId of inactiveUserIds) {
      try {
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) continue;

        const currentRoleIds = member.roles.cache.map(r => r.id);
        const tierRoleIds = Object.values(TIER_ROLES);
        const hasTierRole = currentRoleIds.some(id => tierRoleIds.includes(id));
        const hasSupporter = currentRoleIds.includes(SUPPORTER_ROLE);

        if (hasTierRole || hasSupporter) {
          for (const roleId of tierRoleIds) {
            if (currentRoleIds.includes(roleId)) {
              await member.roles.remove(roleId);
            }
          }
          if (hasSupporter) {
            await member.roles.remove(SUPPORTER_ROLE);
          }
          console.log(`[MembershipSync] Removed all membership roles from ${member.user.tag} (inactive)`);
          changesMade = true;
        }
      } catch (err) {
        console.error(`[MembershipSync] Error cleaning roles for user ${discordId}:`, err.message);
      }
    }

    await storeCurrentActiveSet(currentActiveIds);
    if (changesMade) {
      console.log('[MembershipSync] Sync completed with changes.');
    }
  } catch (err) {
    console.error('[MembershipSync] Fatal error:', err);
  }
}

module.exports = { syncMembershipRoles };
