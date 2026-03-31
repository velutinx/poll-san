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
  en: {1
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

function formatDate(date) {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

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

async function hasMessageBeenSent(discordId, orderId) {
  const { data, error } = await supabaseRetry(() =>
    supabase
      .from('member_message_log')
      .select('id')
      .eq('discord_id', discordId)
      .eq('order_id', orderId)
      .maybeSingle()
  );
  if (error) {
    console.error('[MembershipSync] Failed to check message sent status:', error.message);
    return false;
  }
  return !!data;
}

async function recordMessageSent(discordId, orderId, language) {
  const { error } = await supabaseRetry(() =>
    supabase
      .from('member_message_log')
      .insert({ discord_id: discordId, order_id: orderId, language, sent_at: new Date().toISOString() })
  );
  if (error) {
    console.error('[MembershipSync] Failed to record message sent:', error.message);
  }
}

async function sendDM(member, content) {
  try {
    await member.send(content);
    console.log(`[MembershipSync] ✅ DM sent to ${member.user.tag}`);
    return true;
  } catch (err) {
    console.error(`[MembershipSync] ❌ Failed to send DM to ${member.user.tag}:`, err.message);
    return false;
  }
}

async function sendMembershipMessage(client, discordId, membership) {
  const tier = membership.tier;
  const expiresAt = new Date(membership.expires_at);
  const orderId = membership.order_id;
  const tierNames = { 1: 'Bronze', 2: 'Copper', 3: 'Silver', 4: 'Gold', 5: 'Platinum' };
  const tierName = tierNames[tier] || `Tier ${tier}`;

  const alreadySent = await hasMessageBeenSent(discordId, orderId);
  if (alreadySent) {
    console.log(`[MembershipSync] Message already sent for ${discordId} order ${orderId}, skipping.`);
    return;
  }

  const lang = await getLanguageForOrder(orderId);
  const t = MESSAGES[lang] || MESSAGES.en;

  // Choose template based on tier
  const messageTemplate = (tier === 1) ? t.welcome_tier1 : t.welcome_tier2_5;

  // Get current month name for the placeholder (e.g., "March")
  const currentMonth = new Date().toLocaleString(lang, { month: 'long' });

  let message = messageTemplate
    .replace('{tierName}', tierName)
    .replace('{expiryDate}', formatDate(expiresAt))
    .replace('{currentMonth}', currentMonth);

  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(discordId);
    const success = await sendDM(member, message);
    if (success) {
      await recordMessageSent(discordId, orderId, lang);
      console.log(`[MembershipSync] Welcome message recorded for ${discordId} order ${orderId} (lang: ${lang})`);
    } else {
      console.error(`[MembershipSync] Failed to send DM to ${discordId} for order ${orderId}`);
    }
  } catch (err) {
    console.error(`[MembershipSync] Could not send DM to ${discordId}:`, err.message);
  }
}

// ========== Helper functions for sync state ==========
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

// ========== Main sync function ==========
async function syncMembershipRoles(client) {
  let changesMade = false;

  try {
    const now = new Date().toISOString();

    // Fetch all memberships with expires_at > now
    const { data: activeMemberships, error: activeError } = await supabaseRetry(() =>
      supabase
        .from('memberships')
        .select('*')
        .gt('expires_at', now)
    );
    if (activeError) throw activeError;

    // Group by discord_id, keep highest tier membership
    const userBestMembership = new Map();
    for (const membership of activeMemberships) {
      const discordId = membership.discord_id;
      const currentBest = userBestMembership.get(discordId);
      if (!currentBest || currentBest.tier < membership.tier) {
        userBestMembership.set(discordId, membership);
      }
    }

    const currentActiveIds = new Set(userBestMembership.keys());
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

    // --- Send messages to ALL active members that haven't been messaged yet ---
    for (const [discordId, membership] of userBestMembership.entries()) {
      await sendMembershipMessage(client, discordId, membership);
    }

    // --- Role sync (unchanged) ---
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    for (const [discordId, membership] of userBestMembership.entries()) {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;

      const currentRoleIds = member.roles.cache.map(r => r.id);
      const targetRoleId = TIER_ROLES[membership.tier];
      const hasTargetRole = currentRoleIds.includes(targetRoleId);
      const hasSupporter = currentRoleIds.includes(SUPPORTER_ROLE);

      if (!hasTargetRole) {
        await member.roles.add(targetRoleId);
        console.log(`[MembershipSync] Added role ${targetRoleId} to ${member.user.tag} (tier ${membership.tier})`);
        changesMade = true;
      }

      if (!hasSupporter) {
        await member.roles.add(SUPPORTER_ROLE);
        console.log(`[MembershipSync] Added supporter role to ${member.user.tag}`);
        changesMade = true;
      }

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
    } else {
      console.log('[MembershipSync] Sync completed, no changes.');
    }
  } catch (err) {
    console.error('[MembershipSync] Fatal error:', err);
  }
}

module.exports = { syncMembershipRoles };
