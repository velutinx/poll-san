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
    welcome_tier1: "🎉 Welcome to the {tierName} tier!\nYour membership is active until **{expiryDate}**.\n\nFeel free to explore the packs on **[this channel](https://discord.com/channels/1401446104498700358/1465937644394512516)** and **[join the server](https://discord.gg/XF363uYfSh)** if you haven't.\n\nPlease message **[DM dorem](https://discord.com/users/842917477977161739)** if you have any questions.",
    welcome_tier2_5: "🎉 Welcome to the {tierName} tier!\nYour membership is active until **{expiryDate}**.\n\nFeel free to explore the packs on **[this channel](https://discord.com/channels/1401446104498700358/1465937644394512516)** and **[join the server](https://discord.gg/XF363uYfSh)** if you haven't.\n\nPlease message **[DM dorem](https://discord.com/users/842917477977161739)** to redeem your {currentMonth} billing cycle request."
  },
  ja: {
    welcome_tier1: "🎉 {tierName} ティアへようこそ！\nメンバーシップは **{expiryDate}** まで有効です。\n\nこちらの **[チャンネル](https://discord.com/channels/1401446104498700358/1465937644394512516)** でパックを探索したり、**[サーバーに参加](https://discord.gg/XF363uYfSh)** したりできます（まだの場合）。\n\nご質問があれば、**[DM dorem](https://discord.com/users/842917477977161739)** までお問い合わせください。",
    welcome_tier2_5: "🎉 {tierName} ティアへようこそ！\nメンバーシップは **{expiryDate}** まで有効です。\n\nこちらの **[チャンネル](https://discord.com/channels/1401446104498700358/1465937644394512516)** でパックを探索したり、**[サーバーに参加](https://discord.gg/XF363uYfSh)** したりできます（まだの場合）。\n\n{currentMonth}のリクエストをご利用になるには、**[DM dorem](https://discord.com/users/842917477977161739)** までメッセージを送ってください。"
  },
  zh: {
    welcome_tier1: "🎉 欢迎加入 {tierName} 等级！\n您的会员资格有效至 **{expiryDate}**。\n\n请随时在此 **[频道](https://discord.com/channels/1401446104498700358/1465937644394512516)** 探索图包，并 **[加入服务器](https://discord.gg/XF363uYfSh)**（如果尚未加入）。\n\n如有任何问题，请 **[私信 dorem](https://discord.com/users/842917477977161739)**。",
    welcome_tier2_5: "🎉 欢迎加入 {tierName} 等级！\n您的会员资格有效至 **{expiryDate}**。\n\n请随时在此 **[频道](https://discord.com/channels/1401446104498700358/1465937644394512516)** 探索图包，并 **[加入服务器](https://discord.gg/XF363uYfSh)**（如果尚未加入）。\n\n如需使用 {currentMonth} 的请求额度，请 **[私信 dorem](https://discord.com/users/842917477977161739)**。"
  },
  es: {
    welcome_tier1: "🎉 ¡Bienvenido al nivel {tierName}!\nTu membresía está activa hasta el **{expiryDate}**.\n\nExplora los packs en **[este canal](https://discord.com/channels/1401446104498700358/1465937644394512516)** y **[únete al servidor](https://discord.gg/XF363uYfSh)** si aún no lo has hecho.\n\nSi tienes alguna pregunta, envíame un **[DM a dorem](https://discord.com/users/842917477977161739)**.",
    welcome_tier2_5: "🎉 ¡Bienvenido al nivel {tierName}!\nTu membresía está activa hasta el **{expiryDate}**.\n\nExplora los packs en **[este canal](https://discord.com/channels/1401446104498700358/1465937644394512516)** y **[únete al servidor](https://discord.gg/XF363uYfSh)** si aún no lo has hecho.\n\nPara canjear tu solicitud del ciclo de facturación de {currentMonth}, envíame un **[DM a dorem](https://discord.com/users/842917477977161739)**."
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

async function recordMessageSent(discordId, orderId, language, membership, discordName) {
  const { error } = await supabaseRetry(() =>
    supabase
      .from('member_message_log')
      .insert({
        discord_id: discordId,
        order_id: orderId,
        language,
        sent_at: new Date().toISOString(),
        tier: membership.tier,
        expires_at: membership.expires_at,
        discord_name: discordName,
      })
  );
  if (error) {
    console.error('[MembershipSync] Failed to record message sent:', error.message);
  }
}

async function sendDM(member, content, lang) { // <--- Add 'lang' here
  try {
    await member.send(content);
    console.log(`[MembershipSync] ✅ DM sent to ${member.user.tag} (lang: ${lang})`);
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
 //  console.log(`[MembershipSync] Message already sent for ${discordId} order ${orderId}, skipping.`);
    return;
  }

  const lang = await getLanguageForOrder(orderId);
  const t = MESSAGES[lang] || MESSAGES.en;

  const messageTemplate = (tier === 1) ? t.welcome_tier1 : t.welcome_tier2_5;
  const currentMonth = new Date().toLocaleString(lang, { month: 'long' });

  let message = messageTemplate
    .replace('{tierName}', tierName)
    .replace('{expiryDate}', formatDate(expiresAt))
    .replace('{currentMonth}', currentMonth);

  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(discordId);
    const discordName = member.user.tag;


const success = await sendDM(member, message, lang);
    if (success) {
      await recordMessageSent(discordId, orderId, lang, membership, discordName);

      // --- RESTORED ADMIN NOTIFICATION ---
      try {
        const dorem = await client.users.fetch('842917477977161739');
        const adminNotifyMsg = `🔔 **New membership period started for** ${discordName}\n` +
                               `**Tier:** ${tierName}\n` +
                               `**Expires on:** ${formatDate(expiresAt)}\n` +
                               `*Please reach out to them.*`;
        
        await dorem.send(adminNotifyMsg);
        console.log(`[MembershipSync] Admin notified about ${discordName}`);
      } catch (err) {
        console.error('[MembershipSync] Failed to send admin notification:', err.message);
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

    const { data: activeMemberships, error: activeError } = await supabaseRetry(() =>
      supabase
        .from('memberships')
        .select('*')
        .gt('expires_at', now)
    );
    if (activeError) throw activeError;

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

    // Send messages to all active members that haven't been messaged yet
    for (const [discordId, membership] of userBestMembership.entries()) {
      await sendMembershipMessage(client, discordId, membership);
    }

    // Role sync (assign highest tier and supporter role)
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
//      console.log('[MembershipSync] Sync completed, no changes.');
    }
  } catch (err) {
    console.error('[MembershipSync] Fatal error:', err);
  }
}

module.exports = { syncMembershipRoles };
