// services/membershipSync.js

const db = require('./database');
const h = require('../utils/helpers');

const TIER_ROLES = h.weights.tierMapping;
const SUPPORTER_ROLE = h.ids.roles.supporter;
const CREATOR_ROLE = h.ids.roles.creator;
const MEMBER_ROLE = h.ids.roles.member;

const MESSAGES = {
  en: {
    welcome_tier1: `${h.releaseEmojis.CONFETTI} Welcome to the {tierName} tier!\nYour membership is active until **{expiryDate}**.\n\nFeel free to explore the packs on **[this channel](https://discord.com/channels/1401446104498700358/1465937644394512516)** and **[join the server](https://discord.gg/XF363uYfSh)** if you haven't.\n\nPlease message DM Velutinx if you have any questions.`,
    welcome_tier2_5: `${h.releaseEmojis.CONFETTI} Welcome to the {tierName} tier!\nYour membership is active until **{expiryDate}**.\n\nFeel free to explore the packs on **[this channel](https://discord.com/channels/1401446104498700358/1465937644394512516)** and **[join the server](https://discord.gg/XF363uYfSh)** if you haven't.\n\nPlease message DM Velutinx to redeem your {currentMonth} billing cycle request.`
  },
  ja: {
    welcome_tier1: `${h.releaseEmojis.CONFETTI} {tierName} ティアへようこそ！\nメンバーシップは **{expiryDate}** まで有効です。\n\nこちらの **[チャンネル](https://discord.com/channels/1401446104498700358/1465937644394512516)** でパックを探索したり、**[サーバーに参加](https://discord.gg/XF363uYfSh)** したりできます（まだの場合）。\n\nご質問があれば、DM Velutinx までお問い合わせください。`,
    welcome_tier2_5: `${h.releaseEmojis.CONFETTI} {tierName} ティアへようこそ！\nメンバーシップは **{expiryDate}** まで有効です。\n\nこちらの **[チャンネル](https://discord.com/channels/1401446104498700358/1465937644394512516)** でパックを探索したり、**[サーバーに参加](https://discord.gg/XF363uYfSh)** したりできます（まだの場合）。\n\n{currentMonth}のリクエストをご利用になるには、DM Velutinx までメッセージを送ってください。`
  },
  zh: {
    welcome_tier1: `${h.releaseEmojis.CONFETTI} 欢迎加入 {tierName} 等级！\n您的会员资格有效至 **{expiryDate}**。\n\n请随时在此 **[频道](https://discord.com/channels/1401446104498700358/1465937644394512516)** 探索图包，并 **[加入服务器](https://discord.gg/XF363uYfSh)**（如果尚未加入）。\n\n如有任何问题，请 DM Velutinx。`,
    welcome_tier2_5: `${h.releaseEmojis.CONFETTI} 欢迎加入 {tierName} 等级！\n您的会员资格有效至 **{expiryDate}**。\n\n请随时在此 **[频道](https://discord.com/channels/1401446104498700358/1465937644394512516)** 探索图包，并 **[加入服务器](https://discord.gg/XF363uYfSh)**（如果尚未加入）。\n\n如需使用 {currentMonth} 的请求额度，请 DM Velutinx。`
  },
  es: {
    welcome_tier1: `${h.releaseEmojis.CONFETTI} ¡Bienvenido al nivel {tierName}!\nTu membresía está activa hasta el **{expiryDate}**.\n\nExplora los packs en **[este canal](https://discord.com/channels/1401446104498700358/1465937644394512516)** y **[únete al servidor](https://discord.gg/XF363uYfSh)** si aún no lo has hecho.\n\nSi tienes alguna pregunta, envía un DM Velutinx.`,
    welcome_tier2_5: `${h.releaseEmojis.CONFETTI} ¡Bienvenido al nivel {tierName}!\nTu membresía está activa hasta el **{expiryDate}**.\n\nExplora los packs en **[este canal](https://discord.com/channels/1401446104498700358/1465937644394512516)** y **[únete al servidor](https://discord.gg/XF363uYfSh)** si aún no lo has hecho.\n\nPara canjear tu solicitud del ciclo de facturación de {currentMonth}, envía un DM Velutinx.`
  }
};

function formatDate(date) {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

async function getLanguageForOrder(orderId) {
  if (!orderId) return 'en';
  try {
    const row = await db.query(
      `SELECT language FROM ${h.tables.SUCCESSS} WHERE paypal_token = ?`,
      [orderId],
      true   // single row
    );
    if (!row) {
      console.warn(`[MembershipSync] Language fetch: no row for order ${orderId}`);
      return 'en';
    }
    return row.language || 'en';
  } catch (err) {
    console.warn(`[MembershipSync] Language fetch failed for ${orderId}:`, err.message);
    return 'en';
  }
}

async function hasMessageBeenSent(discordId, orderId) {
  try {
    const row = await db.query(
      `SELECT id FROM ${h.tables.MEMBER_MESSAGE_LOG}
       WHERE discord_id = ? AND order_id = ?
       LIMIT 1`,
      [discordId, orderId],
      true
    );
    return !!row;
  } catch (err) {
    console.error('[MembershipSync] Failed to check message sent status:', err.message);
    return true;  // assume sent to avoid spam
  }
}

async function recordMessageSent(discordId, orderId, language, membership, discordName) {
  try {
    await db.query(
      `INSERT INTO ${h.tables.MEMBER_MESSAGE_LOG}
       (discord_id, order_id, language, sent_at, tier, expires_at, discord_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        discordId,
        orderId,
        language,
        new Date().toISOString(),
        membership.tier,
        membership.expires_at,
        discordName
      ]
    );
  } catch (err) {
    console.error('[MembershipSync] Failed to record message sent:', err.message);
  }
}

async function sendDM(member, content, lang) {
  try {
    await member.send({ content, flags: ["SuppressEmbeds"] });
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
  if (alreadySent) return;

  const lang = await getLanguageForOrder(orderId);
  const t = MESSAGES[lang] || MESSAGES.en;

  const OWNER_ID = h.ids.users.Velutinx;
  const ownerDmLink = `[DM Velutinx](https://discord.com/users/${OWNER_ID})`;

  const messageTemplate = (tier === 1) ? t.welcome_tier1 : t.welcome_tier2_5;
  const currentMonth = new Date().toLocaleString(lang, { month: 'long' });

  let message = messageTemplate
    .replace('{tierName}', tierName)
    .replace('{expiryDate}', formatDate(expiresAt))
    .replace('{currentMonth}', currentMonth)
    .replace(/DM Velutinx/g, ownerDmLink);

  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(discordId);
    const discordName = member.user.tag;

    const success = await sendDM(member, message, lang);
    if (success) {
      await recordMessageSent(discordId, orderId, lang, membership, discordName);

      if (tier === 2 || tier === 3) {
        try {
          const adminChannelId = h.ids.channels.admin_channel;
          const adminChannel = await client.channels.fetch(adminChannelId);
          const userLink = `[${discordName}](https://discord.com/users/${discordId})`;
          const adminMsg = `${h.releaseEmojis.SPARKLES} **New membership period started for** ${userLink}\n` +
                 `**Tier:** ${tierName}\n` +
                 `**Expires on:** ${formatDate(expiresAt)}\n` +
                 `*Please reach out to them.*`;

          await adminChannel.send({
            content: adminMsg,
            allowedMentions: { users: [] },
            flags: [1 << 2]
          });
        } catch (channelErr) {
          console.error('[MembershipSync] Could not send to admin channel:', channelErr.message);
        }
      }
    }
  } catch (err) {
    console.error(`[MembershipSync] Could not handle DM for ${discordId}:`, err.message);
  }
}

async function getLastActiveSet() {
  try {
    const row = await db.query(
      `SELECT value FROM ${h.tables.SYNC_STATE} WHERE key = 'active_members'`,
      [],
      true
    );
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      return new Set(parsed.ids || []);
    }
    return new Set();
  } catch (err) {
    console.error('[MembershipSync] Failed to fetch sync state:', err.message);
    return new Set();
  }
}

async function storeCurrentActiveSet(ids) {
  const json = JSON.stringify({ ids: Array.from(ids), updated_at: new Date().toISOString() });
  try {
    await db.query(
      `INSERT INTO ${h.tables.SYNC_STATE} (key, value)
       VALUES ('active_members', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [json]
    );
  } catch (err) {
    console.error('[MembershipSync] Failed to store sync state:', err.message);
  }
}

async function syncMembershipRoles(client) {
  let changesMade = false;

  try {
    const now = new Date().toISOString();

    const activeMemberships = await db.query(
      `SELECT discord_id, tier, expires_at, order_id
       FROM ${h.tables.MEMBERSHIPS}
       WHERE expires_at > ?`,
      [now]
    );

    if (!activeMemberships || activeMemberships.length === 0) {
      await storeCurrentActiveSet(new Set());
      return;
    }

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
          console.log(`${h.releaseEmojis.CONFETTI} [MembershipSync] NEW ACTIVE MEMBER: ${tag} (${discordId}) - Tier ${tier}`);
        } catch (err) {}
      }
    }

    for (const [discordId, membership] of userBestMembership.entries()) {
      // Skip sending messages to Creator role
      try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (member && member.roles.cache.has(CREATOR_ROLE)) {
          console.log(`[MembershipSync] Skipping DM and role sync for Creator ${member.user.tag} (${discordId})`);
          continue;
        }
      } catch (err) {
        console.warn(`[MembershipSync] Could not check Creator role for ${discordId}, proceeding anyway`);
      }
      await sendMembershipMessage(client, discordId, membership);
      await new Promise(res => setTimeout(res, 500));
    }

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    for (const [discordId, membership] of userBestMembership.entries()) {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;
      if (member.roles.cache.has(CREATOR_ROLE)) {
        console.log(`[MembershipSync] Skipping role sync for Creator ${member.user.tag}`);
        continue;
      }

      const currentRoleIds = member.roles.cache.map(r => r.id);
      const targetRoleId = TIER_ROLES[membership.tier];
      const hasTargetRole = currentRoleIds.includes(targetRoleId);
      const hasSupporter = currentRoleIds.includes(SUPPORTER_ROLE);

      if (!hasTargetRole && targetRoleId) {
        await member.roles.add(targetRoleId);
        changesMade = true;
      }

      if (!hasSupporter) {
        await member.roles.add(SUPPORTER_ROLE);
        changesMade = true;
      }

      for (const roleId of Object.values(TIER_ROLES)) {
        if (roleId !== targetRoleId && currentRoleIds.includes(roleId)) {
          await member.roles.remove(roleId);
          changesMade = true;
        }
      }
    }

    const inactiveUserIds = [...previousActiveIds].filter(id => !currentActiveIds.has(id));
    for (const discordId of inactiveUserIds) {
      try {
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) {
          console.log(`[MembershipSync] Inactive user ${discordId} not found in guild, skipping.`);
          continue;
        }
        if (member.roles.cache.has(CREATOR_ROLE)) {
          console.log(`[MembershipSync] Skipping inactive Creator ${member.user.tag} (${discordId})`);
          continue;
        }

        const currentRoleIds = member.roles.cache.map(r => r.id);
        const tierRoleIds = Object.values(TIER_ROLES);
        const hasTierRole = currentRoleIds.some(id => tierRoleIds.includes(id));
        const hasSupporter = currentRoleIds.includes(SUPPORTER_ROLE);

        if (hasTierRole || hasSupporter) {
          for (const roleId of tierRoleIds) {
            if (currentRoleIds.includes(roleId)) {
              await member.roles.remove(roleId);
              changesMade = true;
            }
          }
          if (hasSupporter) {
            await member.roles.remove(SUPPORTER_ROLE);
            changesMade = true;
          }
        }

        if (!member.roles.cache.has(MEMBER_ROLE)) {
          await member.roles.add(MEMBER_ROLE);
          changesMade = true;
          console.log(`[MembershipSync] ✅ Added Member role to ${member.user.tag} (${discordId})`);
        } else {
          console.log(`[MembershipSync] ℹ️ ${member.user.tag} already has Member role, no action needed.`);
        }
      } catch (err) {
        console.error(`[MembershipSync] ❌ Error processing inactive user ${discordId}:`, err.message);
      }
    }

    await storeCurrentActiveSet(currentActiveIds);
  } catch (err) {
    console.error('[MembershipSync] Fatal error:', err.message);
  }
}

module.exports = { syncMembershipRoles };
