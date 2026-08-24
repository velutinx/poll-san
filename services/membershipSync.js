// services/membershipSync.js

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');
const h = require('../utils/helpers');
const TIER_ROLES = h.weights.tierMapping;
const SUPPORTER_ROLE = h.ids.roles.supporter;
const CREATOR_ROLE = h.ids.roles.creator;
const MEMBER_ROLE = h.ids.roles.member;
const UNVERIFIED_ROLE = h.ids.roles.unverified;
const SYNC_STATE_WORKER_URL = h.urls.CLOUDFLARE_D1_WORKER;
const ADMIN_CHANNEL_ID = h.ids.channels.admin_channel;
const MESSAGING_TABLE = h.tables.PURCHASE_MESSAGING || 'purchase_messaging';

// ─── Retry helper for D1 queries ──────────────────────────────────────
async function queryWithRetry(sql, params = [], method = 'all', maxRetries = 3) {
  let lastError;
  let delay = 500;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const single = (method === 'first');
      const result = await db.query(sql, params, single);
      return result;
    } catch (err) {
      lastError = err;
      const msg = err.message || '';
      if (msg.includes('timeout') || msg.includes('reset') || msg.includes('storage operation')) {
        console.log(`⚠️ D1 ${method} error (attempt ${attempt}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// Cooldown for the full scan (safety net) – not used automatically, but kept for manual calls
let lastEnforcementRun = 0;
const ENFORCEMENT_COOLDOWN = 12 * 60 * 60 * 1000; // 12 hours

// Mutex to prevent concurrent full scans
let isEnforcing = false;

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
    const row = await queryWithRetry(
      `SELECT language FROM ${h.tables.SUCCESSS} WHERE paypal_token = ?`,
      [orderId],
      'first',
      2
    );
    if (!row) return 'en';
    return row.language || 'en';
  } catch (err) {
    console.warn(`[MembershipSync] Language fetch failed for ${orderId}:`, err.message);
    return 'en';
  }
}

async function hasMessageBeenSent(discordId, orderId) {
  try {
    const row = await queryWithRetry(
      `SELECT welcome_sent FROM ${h.tables.MEMBERSHIPS}
       WHERE discord_id = ? AND order_id = ?
       LIMIT 1`,
      [discordId, orderId],
      'first',
      2
    );
    return row?.welcome_sent === 1;
  } catch (err) {
    console.error('[MembershipSync] Failed to check welcome_sent:', err.message);
    return true;
  }
}

async function recordMessageSent(
  discordId,
  orderId,
  language,
  membership,
  discordName,
  sentBy = 'auto',
  messageType = 'cycle_start'
) {
  try {
    await db.query(
      `INSERT INTO ${h.tables.MEMBER_MESSAGE_LOG}
       (discord_id, order_id, language, sent_at, tier, expires_at, discord_name, sent_by, message_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        discordId,
        orderId,
        language,
        new Date().toISOString(),
        membership.tier,
        membership.expires_at,
        discordName,
        sentBy,
        messageType
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
    return { success: true };
  } catch (err) {
    console.error(`[MembershipSync] ❌ Failed to send DM to ${member.user.tag}:`, err.message);
    if (err.message.includes('Cannot send messages to this user') ||
        err.message.includes('no mutual guilds') ||
        err.code === 50007) {
      return { success: false, permanentFailure: true };
    }
    return { success: false, permanentFailure: false };
  }
}

async function markWelcomeSent(discordId, orderId) {
  try {
    await db.query(
      `UPDATE ${h.tables.MEMBERSHIPS}
       SET welcome_sent = 1
       WHERE discord_id = ? AND order_id = ?`,
      [discordId, orderId]
    );
  } catch (err) {
    console.error('[MembershipSync] Failed to mark welcome_sent:', err.message);
  }
}

async function sendMembershipMessage(client, discordId, membership) {
  const tier = membership.tier;
  const expiresAt = new Date(membership.expires_at);
  const orderId = membership.order_id;
  const alreadySent = await hasMessageBeenSent(discordId, orderId);
  if (alreadySent) return;
  const tierNames = { 1: 'Bronze', 2: 'Copper', 3: 'Silver', 4: 'Gold', 5: 'Platinum' };
  const tierName = tierNames[tier] || `Tier ${tier}`;
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

  let member;
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    member = await guild.members.fetch(discordId);
  } catch (err) {
    if (err.code === 10007 || err.message.includes('Unknown Member')) {
      console.log(`[MembershipSync] Member ${discordId} not in guild, marking as sent.`);
      await markWelcomeSent(discordId, orderId);
      await recordMessageSent(
        discordId,
        orderId,
        lang,
        membership,
        'Unknown',
        'auto',
        'cycle_start'
      );
      return;
    }
    console.error(`[MembershipSync] Could not fetch member ${discordId}:`, err.message);
    return;
  }

  const discordName = member.user.tag;
  const result = await sendDM(member, message, lang);

  if (result.success) {
    await markWelcomeSent(discordId, orderId);
    await recordMessageSent(
      discordId,
      orderId,
      lang,
      membership,
      discordName,
      'auto',
      'cycle_start'
    );
  } else if (result.permanentFailure) {
    console.log(`[MembershipSync] Permanent DM failure for ${discordId} (${discordName}), marking as sent.`);
    await markWelcomeSent(discordId, orderId);
    await recordMessageSent(
      discordId,
      orderId,
      lang,
      membership,
      discordName,
      'auto',
      'cycle_start'
    );
  }
}

async function getWebsiteWebhook(channel) {
  const webhooks = await channel.fetchWebhooks();
  let webhook = webhooks.find(w => w.name === 'Website Subscriber');
  if (!webhook) {
    webhook = await channel.createWebhook({
      name: 'Website Subscriber',
      avatar: h.urls.LOGO_URL
    });
  } else {
    if (webhook.avatar !== h.urls.LOGO_URL) {
      await webhook.edit({ avatar: h.urls.LOGO_URL });
    }
  }
  return webhook;
}

async function sendRequestTierWebhook(client, discordId, membership) {
  const tier = membership.tier;
  if (tier !== 2 && tier !== 3) return;

  const expiresAt = new Date(membership.expires_at);
  const orderId = membership.order_id;

  let email = 'unknown';
  try {
    const emailRow = await queryWithRetry(
      `SELECT paypal_email FROM ${h.tables.SUCCESSS} WHERE paypal_token = ?`,
      [orderId],
      'first',
      2
    );
    if (emailRow) email = emailRow.paypal_email;
  } catch (err) {
    console.warn(`Could not fetch email for order ${orderId}:`, err.message);
  }

  let tag = 'Unknown';
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (member) tag = member.user.tag;
  } catch (err) {
    console.warn(`Could not fetch member ${discordId}:`, err.message);
  }

  const tierNames = { 2: 'Copper', 3: 'Silver' };
  const tierDisplay = `Request (${tierNames[tier] || tier})`;

  const userLink = `[${tag}](https://discord.com/users/${discordId})`;
  const message = `${h.releaseEmojis.PIXELSKY} **New Request Member!**\n` +
                  `**Name:** ${userLink}\n` +
                  `**Email:** ${email}\n` +
                  `**Tier:** ${tierDisplay}\n` +
                  `**Expires on:** ${formatDate(expiresAt)}`;

  try {
    const adminChannel = await client.channels.fetch(h.ids.channels.admin_channel);
    const webhook = await getWebsiteWebhook(adminChannel);
    await webhook.send({
      content: message,
      username: 'Website Subscriber',
      avatarURL: h.urls.LOGO_URL,
      allowedMentions: { users: [] },
      flags: [1 << 2]
    });
    console.log(`📨 Sent admin webhook for ${tag} (tier ${tier})`);
  } catch (webhookErr) {
    console.error('Failed to send admin webhook:', webhookErr);
  }
}

async function getPreviousFullState() {
  try {
    const res = await fetch(`${SYNC_STATE_WORKER_URL}/api/sync-state/active-members-full`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.state || {};
  } catch (err) {
    console.error('[MembershipSync] Failed to fetch full state from KV:', err.message);
    return {};
  }
}

async function storeCurrentFullState(state) {
  try {
    const res = await fetch(`${SYNC_STATE_WORKER_URL}/api/sync-state/active-members-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error('[MembershipSync] Failed to store full state in KV:', err.message);
  }
}

async function getLastActiveSet() {
  try {
    const res = await fetch(`${SYNC_STATE_WORKER_URL}/api/sync-state/active-members`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return new Set(data.ids || []);
  } catch (err) {
    console.error('[MembershipSync] Failed to fetch active set from KV:', err.message);
    return new Set();
  }
}

async function storeCurrentActiveSet(ids) {
  try {
    const res = await fetch(`${SYNC_STATE_WORKER_URL}/api/sync-state/active-members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(ids) })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error('[MembershipSync] Failed to store active set in KV:', err.message);
  }
}

async function getDuplicateWarningTimestamps() {
  try {
    const res = await fetch(`${SYNC_STATE_WORKER_URL}/api/sync-state/duplicate-warning-timestamps`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.timestamps || {};
  } catch (err) {
    console.error('[DuplicateWarning] Failed to fetch timestamps from KV:', err.message);
    return {};
  }
}

async function storeDuplicateWarningTimestamps(timestamps) {
  try {
    const res = await fetch(`${SYNC_STATE_WORKER_URL}/api/sync-state/duplicate-warning-timestamps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamps })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error('[DuplicateWarning] Failed to store timestamps in KV:', err.message);
  }
}

async function checkAndWarnDuplicateMemberships(client, activeMemberships) {
  const websiteMemberships = activeMemberships.filter(m => m.source === 'website');
  if (websiteMemberships.length === 0) return;

  const userMemberships = {};
  for (const m of websiteMemberships) {
    if (!userMemberships[m.discord_id]) userMemberships[m.discord_id] = [];
    userMemberships[m.discord_id].push(m);
  }

  const duplicates = {};
  for (const [discordId, memberships] of Object.entries(userMemberships)) {
    if (memberships.length > 1) {
      duplicates[discordId] = memberships;
    }
  }

  if (Object.keys(duplicates).length === 0) return;

  const timestamps = await getDuplicateWarningTimestamps();
  const now = Date.now();
  const COOLDOWN_MS = 24 * 60 * 60 * 1000;

  const toWarn = {};
  for (const [discordId, memberships] of Object.entries(duplicates)) {
    const last = timestamps[discordId] || 0;
    if (now - last > COOLDOWN_MS) {
      toWarn[discordId] = memberships;
    }
  }

  if (Object.keys(toWarn).length === 0) return;

  const adminChannel = await client.channels.fetch(h.ids.channels.admin_channel);
  const webhook = await getWebsiteWebhook(adminChannel);

  for (const [discordId, memberships] of Object.entries(toWarn)) {
    let userTag = discordId;
    try {
      const user = await client.users.fetch(discordId);
      userTag = user.tag;
    } catch {
    }

    const tierNames = { 1: 'Bronze', 2: 'Copper', 3: 'Silver', 4: 'Gold', 5: 'Platinum' };
    const listItems = memberships.map(m => {
      const tierName = tierNames[m.tier] || `Tier ${m.tier}`;
      const orderId = m.order_id || 'unknown';
      return `✨ ${tierName} (${orderId})`;
    }).join(' and ');

    const message = `User @${userTag} has currently two active memberships ${listItems}`;

    await webhook.send({
      content: message,
      username: 'Website Subscriber',
      avatarURL: h.urls.LOGO_URL,
      allowedMentions: { users: [] },
      flags: [1 << 2]
    });

    console.log(`[DuplicateWarning] Sent warning for ${userTag}`);

    timestamps[discordId] = now;
    await storeDuplicateWarningTimestamps(timestamps);
  }
}

// ─── Helper: get member display name and tag ──────────────────────
async function getMemberInfo(client, discordId) {
  let displayName = discordId;
  let userTag = discordId;
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(discordId);
    if (member) {
      displayName = member.displayName; // nickname or username
      userTag = member.user.tag;
    }
  } catch (_) {
    const user = await client.users.fetch(discordId).catch(() => null);
    if (user) {
      displayName = user.username;
      userTag = user.tag;
    }
  }
  return { displayName, userTag };
}

// ─── Messaging approval helpers ──────────────────────────────────

const TIER_NAMES = { 1: 'Bronze', 2: 'Copper', 3: 'Silver', 4: 'Gold', 5: 'Platinum' };

async function shouldNotifyAdmin(discordId, tier) {
  if (tier < 2) return false; // bronze never triggers

  const row = await db.query(
    `SELECT action FROM ${MESSAGING_TABLE}
     WHERE discord_id = ? AND tier = ?`,
    [discordId, tier],
    true
  );

  if (!row) return true;

  // Once messaged or ignored, never ask again for this tier
  if (row.action === 'ignored' || row.action === 'messaged') return false;

  return true;
}

async function recordMessagingAction(discordId, discordTag, discordName, tier, tierName, action, source = null, orderId = null) {
  await db.query(
    `INSERT OR REPLACE INTO ${MESSAGING_TABLE}
     (discord_id, discord_tag, discord_name, tier, tier_name, action, last_notified_at, source, order_id)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
    [discordId, discordTag, discordName, tier, tierName, action, source, orderId]
  );
}

async function notifyAdminWithButtons(client, discordId, tier, membership) {
  const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
  const webhook = await getWebsiteWebhook(adminChannel);

  const { displayName, userTag } = await getMemberInfo(client, discordId);

  const tierName = TIER_NAMES[tier] || `Tier ${tier}`;

  const embed = {
    color: 0x00aaff,
    title: '📨 Membership DM Approval Needed',
    description: `**User:** ${displayName} (${discordId})\n**Tier:** ${tierName}\n**Expires:** ${new Date(membership.expires_at).toLocaleDateString()}`,
    fields: [
      { name: 'Source', value: membership.source || 'unknown', inline: true },
      { name: 'Order ID', value: membership.order_id || 'N/A', inline: true }
    ],
    timestamp: new Date().toISOString()
  };

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`membership_message_${discordId}_${tier}`)
      .setLabel('💬 Message')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`membership_ignore_${discordId}_${tier}`)
      .setLabel('🚫 Ignore')
      .setStyle(ButtonStyle.Danger)
  );

  await webhook.send({
    embeds: [embed],
    components: [row],
    username: 'Membership Manager',
    avatarURL: h.urls.LOGO_URL
  });
}

// ─── Process all active memberships for messaging ───────────────────
async function processMembershipMessaging(client, userBestMembership) {
  const processed = new Set();

  for (const [discordId, membership] of userBestMembership.entries()) {
    if (processed.has(discordId)) continue;
    const tier = membership.tier;

    if (!(await shouldNotifyAdmin(discordId, tier))) continue;

    await notifyAdminWithButtons(client, discordId, tier, membership);
    processed.add(discordId);
  }
}

// ─── Handlers for button interactions (exported) ──────────────────
async function handleMessageButton(interaction, discordId, tier) {
  await interaction.deferUpdate();
  const client = interaction.client;

  const membership = await db.query(
    `SELECT * FROM ${h.tables.MEMBERSHIPS}
     WHERE discord_id = ? AND tier = ? ORDER BY expires_at DESC LIMIT 1`,
    [discordId, tier],
    true
  );
  if (!membership) {
    return interaction.followUp({ content: 'Membership not found.', ephemeral: true });
  }

  const { displayName, userTag } = await getMemberInfo(client, discordId);
  const tierName = TIER_NAMES[tier] || `Tier ${tier}`;

  await sendMembershipMessage(client, discordId, membership);
  await recordMessagingAction(discordId, userTag, displayName, tier, tierName, 'messaged', membership.source, membership.order_id);

  await interaction.editReply({
    content: `✅ DM sent to @${displayName} and recorded as "messaged".`,
    components: []
  });
}

async function handleIgnoreButton(interaction, discordId, tier) {
  await interaction.deferUpdate();
  const client = interaction.client;

  const { displayName, userTag } = await getMemberInfo(client, discordId);
  const tierName = TIER_NAMES[tier] || `Tier ${tier}`;

  const membership = await db.query(
    `SELECT source, order_id FROM ${h.tables.MEMBERSHIPS}
     WHERE discord_id = ? AND tier = ? ORDER BY expires_at DESC LIMIT 1`,
    [discordId, tier],
    true
  );

  await recordMessagingAction(
    discordId,
    userTag,
    displayName,
    tier,
    tierName,
    'ignored',
    membership?.source || null,
    membership?.order_id || null
  );

  await interaction.editReply({
    content: `🚫 Ignored @${displayName} for tier ${tierName}. No future notifications for this tier.`,
    components: []
  });
}

// ─── MAIN SYNC (with retry and safe abort) ──────────────────────────
async function syncMembershipRoles(client) {
  let changesMade = false;

  try {
    const GRACE_DAYS = 4;
    const graceDate = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    let activeMemberships;
    try {
      activeMemberships = await queryWithRetry(
        `SELECT discord_id, tier, expires_at, order_id, updated_at, months,
                recurring, plan_id, status, source, discord_tag
         FROM ${h.tables.MEMBERSHIPS}
         WHERE expires_at > ?`,
        [graceDate],
        'all',
        3
      );
    } catch (err) {
      console.error('[MembershipSync] ❌ Failed to fetch active memberships after retries:', err.message);
      return;
    }

    if (!activeMemberships || activeMemberships.length === 0) {
      console.warn('[MembershipSync] ⚠️ No active memberships found – aborting sync to preserve roles.');
      return;
    }

    await checkAndWarnDuplicateMemberships(client, activeMemberships);

    const userBestMembership = new Map();
    for (const membership of activeMemberships) {
      const discordId = membership.discord_id;
      const currentBest = userBestMembership.get(discordId);
      if (!currentBest || currentBest.tier < membership.tier) {
        userBestMembership.set(discordId, membership);
      }
    }

    const currentFullState = Object.fromEntries(userBestMembership);
    const currentActiveIds = new Set(Object.keys(currentFullState));
    const previousFullState = await getPreviousFullState();
    const previousActiveIds = new Set(Object.keys(previousFullState));
    const toUpsert = [];
    const toDelete = [];

    for (const [discordId, membership] of Object.entries(currentFullState)) {
      const prev = previousFullState[discordId];
      if (!prev) {
        toUpsert.push(membership);
      } else if (prev.tier !== membership.tier || prev.expires_at !== membership.expires_at) {
        toUpsert.push(membership);
      }
    }

    for (const discordId of Object.keys(previousFullState)) {
      if (!currentFullState[discordId]) {
        toDelete.push(discordId);
      }
    }

    // ─── Process messaging approval for all active members ──────
    await processMembershipMessaging(client, userBestMembership);

    // ─── Continue with role sync and DB updates ──────────────────────
    const newIds = [...currentActiveIds].filter(id => !previousActiveIds.has(id));

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const tagMap = new Map();
    for (const discordId of currentActiveIds) {
      try {
        const member = await guild.members.fetch(discordId);
        if (member) tagMap.set(discordId, member.user.tag);
      } catch (err) {
        tagMap.set(discordId, null);
      }
    }

    if (toUpsert.length > 0) {
      const stmt = `
        INSERT INTO ${h.tables.MEMBERSHIPS}
        (discord_id, tier, order_id, updated_at, expires_at, months, recurring, plan_id, status, source, discord_tag)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(discord_id) DO UPDATE SET
          tier = excluded.tier,
          order_id = excluded.order_id,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at,
          months = excluded.months,
          recurring = excluded.recurring,
          plan_id = excluded.plan_id,
          status = excluded.status,
          source = excluded.source,
          discord_tag = excluded.discord_tag
      `;
      for (const membership of toUpsert) {
        const row = [
          membership.discord_id,
          membership.tier,
          membership.order_id || null,
          membership.updated_at || new Date().toISOString(),
          membership.expires_at,
          membership.months || 1,
          membership.recurring ?? 0,
          membership.plan_id || null,
          membership.status || 'ACTIVE',
          membership.source || 'website',
          tagMap.get(membership.discord_id) || membership.discord_tag || null
        ];
        await db.query(stmt, row);
      }
      changesMade = true;
    }

    if (toDelete.length > 0) {
      const placeholders = toDelete.map(() => '?').join(',');
      await db.query(
        `DELETE FROM ${h.tables.MEMBERSHIPS} WHERE discord_id IN (${placeholders})`,
        toDelete
      );
      changesMade = true;
    }

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

    for (const discordId of toDelete) {
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
        }
      } catch (err) {
        console.error(`[MembershipSync] ❌ Error processing inactive user ${discordId}:`, err.message);
      }
    }

    if (changesMade) {
      await storeCurrentFullState(currentFullState);
      await storeCurrentActiveSet(currentActiveIds);
    }

  } catch (err) {
    console.error('[MembershipSync] Fatal error:', err.message);
  }
}

// ─── Helper: add a role with retry on 429 ──────────────────────────
async function addRoleWithRetry(member, roleId, maxAttempts = 3) {
  let attempts = 0;
  while (attempts < maxAttempts) {
    try {
      await member.roles.add(roleId);
      return;
    } catch (err) {
      if (err.code === 429) {
        const wait = (err.retryAfter || 2) * 1000 + 500;
        console.warn(`[RateLimit] Waiting ${wait}ms before retrying add role ${roleId} for ${member.id}`);
        await new Promise(resolve => setTimeout(resolve, wait));
        attempts++;
      } else {
        throw err;
      }
    }
  }
  console.error(`[enforceRolesForMember] Failed to add role ${roleId} after ${maxAttempts} attempts`);
}

// ─── Helper: remove a role with retry on 429 ────────────────────────
async function removeRoleWithRetry(member, roleId, maxAttempts = 3) {
  let attempts = 0;
  while (attempts < maxAttempts) {
    try {
      await member.roles.remove(roleId);
      return;
    } catch (err) {
      if (err.code === 429) {
        const wait = (err.retryAfter || 2) * 1000 + 500;
        console.warn(`[RateLimit] Waiting ${wait}ms before retrying remove role ${roleId} for ${member.id}`);
        await new Promise(resolve => setTimeout(resolve, wait));
        attempts++;
      } else {
        throw err;
      }
    }
  }
  console.error(`[enforceRolesForMember] Failed to remove role ${roleId} after ${maxAttempts} attempts`);
}

// ─── ENHANCED REAL‑TIME ROLE FIX (with safe DB error handling) ──────
async function enforceRolesForMember(member) {
  if (member.user.bot) return;
  if (member.roles.cache.has(CREATOR_ROLE)) return;

  const now = new Date().toISOString();

  let activeMembership = null;
  try {
    activeMembership = await queryWithRetry(
      `SELECT tier FROM ${h.tables.MEMBERSHIPS}
       WHERE discord_id = ? AND expires_at > ? AND status = 'ACTIVE'
       ORDER BY tier DESC
       LIMIT 1`,
      [member.id, now],
      'first',
      2
    );
  } catch (err) {
    console.error(`[enforceRolesForMember] ❌ DB query failed for ${member.id}:`, err.message);
    return;
  }

  if (activeMembership) {
    const tier = activeMembership.tier;
    const tierRoleId = h.weights.tierMapping[String(tier)];
    if (!tierRoleId) {
      console.warn(`[enforceRolesForMember] No role mapping for tier ${tier}`);
      return;
    }

    const hasTierRole = member.roles.cache.has(tierRoleId);
    const hasSupporter = member.roles.cache.has(SUPPORTER_ROLE);
    const hasMember = member.roles.cache.has(MEMBER_ROLE);
    const hasUnverified = member.roles.cache.has(UNVERIFIED_ROLE);

    if (hasTierRole && hasSupporter && !hasMember && !hasUnverified) {
      return;
    }

    const addRoles = [];
    const removeRoles = [];

    if (!hasTierRole) addRoles.push(tierRoleId);
    if (!hasSupporter) addRoles.push(SUPPORTER_ROLE);
    if (hasMember) removeRoles.push(MEMBER_ROLE);
    if (hasUnverified) removeRoles.push(UNVERIFIED_ROLE);

    for (const roleId of addRoles) {
      await addRoleWithRetry(member, roleId);
    }
    for (const roleId of removeRoles) {
      await removeRoleWithRetry(member, roleId);
    }

    return;
  }

  const hasSupporter = member.roles.cache.has(SUPPORTER_ROLE);
  const hasMember = member.roles.cache.has(MEMBER_ROLE);
  const hasUnverified = member.roles.cache.has(UNVERIFIED_ROLE);

  if (!hasSupporter && !hasMember && !hasUnverified) {
    await addRoleWithRetry(member, MEMBER_ROLE);
  }
}

// ─── FULL SCAN (SAFETY NET) – rarely needed, now with mutex ──────
async function enforceRolesForAllMembers(client) {
  if (isEnforcing) {
    console.log('[MembershipSync] Full enforcement already running, skipping.');
    return;
  }
  isEnforcing = true;
  try {
    const now = Date.now();
    if (now - lastEnforcementRun < ENFORCEMENT_COOLDOWN) {
      console.log('[MembershipSync] Full enforcement scan skipped (cooldown active).');
      return;
    }
    lastEnforcementRun = now;

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const members = await guild.members.fetch();
    let fixedCount = 0;
    let delay = 1000;

    for (const [, member] of members) {
      if (member.user.bot) continue;
      if (member.roles.cache.has(CREATOR_ROLE)) continue;

      const hasSupporter = member.roles.cache.has(SUPPORTER_ROLE);
      const hasMember = member.roles.cache.has(MEMBER_ROLE);
      const hasUnverified = member.roles.cache.has(UNVERIFIED_ROLE);

      if (!hasSupporter && !hasMember && !hasUnverified) {
        try {
          await member.roles.add(MEMBER_ROLE);
          fixedCount++;
          console.log(`[MembershipSync] Added Member to ${member.user.tag} (was roleless)`);
        } catch (addErr) {
          if (addErr.code === 429) {
            const retryAfter = addErr.retryAfter || 5;
            console.warn(`[MembershipSync] Rate limited, waiting ${retryAfter}s...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000 + 500));
            try {
              await member.roles.add(MEMBER_ROLE);
              fixedCount++;
              console.log(`[MembershipSync] Added Member to ${member.user.tag} (was roleless) after wait.`);
            } catch (retryErr) {
              console.error(`[MembershipSync] Failed to add Member to ${member.user.tag} after retry:`, retryErr.message);
            }
          } else {
            console.error(`[MembershipSync] Failed to add Member to ${member.user.tag}:`, addErr.message);
          }
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay + 200, 3000);
      }
    }

    if (fixedCount > 0) {
      console.log(`[MembershipSync] Fixed roles for ${fixedCount} members.`);
    }
  } catch (err) {
    console.error('[MembershipSync] Full enforcement scan failed:', err.message);
    if (err.message?.includes('rate limited')) {
      console.warn('[MembershipSync] Full scan rate limited, will respect the cooldown before retrying.');
    }
  } finally {
    isEnforcing = false;
  }
}

module.exports = {
  syncMembershipRoles,
  enforceRolesForAllMembers,
  enforceRolesForMember,
  handleMessageButton,
  handleIgnoreButton
};
