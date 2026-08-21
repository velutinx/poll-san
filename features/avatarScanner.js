// features/avatarScanner.js

const {
    EmbedBuilder,
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');
const { ids, sightengine, releaseEmojis } = require('../utils/helpers');
const db = require('../services/database');
const ALERT_EMOJI = releaseEmojis.ALERT;
const NUDITY_THRESHOLD = 0.3;
const MASS_SCAN_THRESHOLD = 0.3;
const SCAN_DELAY_MS = 2000;
const MONTHLY_CREDITS = 2000;
const NSFW_TIMEOUT_MS = 15000;
const DEFAULT_PROMPT_HOURS = [14, 16, 18];
let PROMPT_HOURS = DEFAULT_PROMPT_HOURS;
if (process.env.MONTHLY_SCAN_PROMPT_HOURS) {
    try {
        const parsed = process.env.MONTHLY_SCAN_PROMPT_HOURS.split(',').map(Number);
        if (parsed.every(n => !isNaN(n) && n >= 0 && n <= 23)) {
            PROMPT_HOURS = parsed;
            console.log(`[AvatarScan] Using custom prompt hours (UTC): ${PROMPT_HOURS.join(', ')}`);
        } else {
            console.warn('[AvatarScan] Invalid MONTHLY_SCAN_PROMPT_HOURS, using defaults:', DEFAULT_PROMPT_HOURS);
        }
    } catch (e) {
        console.warn('[AvatarScan] Error parsing MONTHLY_SCAN_PROMPT_HOURS, using defaults');
    }
}
const MAX_TIMEOUT = 2147483647;
function safeTimeout(callback, delayMs) {
    if (delayMs <= MAX_TIMEOUT) {
        return setTimeout(callback, delayMs);
    }
    return setTimeout(() => safeTimeout(callback, delayMs - MAX_TIMEOUT), MAX_TIMEOUT);
}
const creditMutex = {
    _queue: [],
    _locked: false,
    acquire() {
        return new Promise((resolve) => {
            this._queue.push(resolve);
            if (!this._locked) this._next();
        });
    },
    _next() {
        if (this._queue.length === 0) {
            this._locked = false;
            return;
        }
        this._locked = true;
        const resolve = this._queue.shift();
        resolve(() => this._next());
    }
};
async function scanWithSightengine(url) {
    const formData = new URLSearchParams();
    formData.append('url', url);
    formData.append('models', 'nudity-2.1');
    formData.append('api_user', sightengine.apiUser);
    formData.append('api_secret', sightengine.apiSecret);
    const res = await fetch('https://api.sightengine.com/1.0/check.json', {
        method: 'POST',
        body: formData,
    });
    await incrementCreditsUsed(1);
    return res.json();
}
async function scanWithNSFWCheckers(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NSFW_TIMEOUT_MS);
    try {
        const imageRes = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!imageRes.ok) throw new Error(`Failed to download image: ${imageRes.status}`);
        const imageBuffer = await imageRes.arrayBuffer();
        const formData = new FormData();
        formData.append('image', new Blob([imageBuffer]), 'avatar.webp');
        const res = await fetch('https://api.nsfwcheckers.workers.dev', {
            method: 'POST',
            body: formData,
            signal: controller.signal,
        });
        clearTimeout(timeout);
        return res.json();
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            console.warn(`[NSFWCheckers] Timeout scanning ${url}`);
            return null;
        }
        throw err;
    }
}
function getAvatarHash(member) {
    return member.user.avatar || 'default';
}
function getSightNudityScore(sightResult) {
    if (!sightResult || !sightResult.nudity) return 0;
    const n = sightResult.nudity;
    if (typeof n.raw === 'number') return n.raw;
    if (typeof n.none === 'number') return 1 - n.none;
    const probs = [
        n.sexual_activity,
        n.erotica,
        n.suggestive,
        n.sexual_display,
        n.very_suggestive,
        n.mildly_suggestive
    ].filter(v => typeof v === 'number');
    return probs.length > 0 ? Math.max(...probs) : 0;
}
async function dbAddFlaggedUser(userId, avatarHash, discordTag) {
    await db.query(
        `INSERT OR REPLACE INTO avatar_flagged_users (user_id, avatar_hash, discord_tag, flagged_at)
         VALUES (?, ?, ?, ?)`,
        [userId, avatarHash, discordTag, new Date().toISOString()]
    );
}
async function dbRemoveFlaggedUser(userId) {
    await db.query(
        `DELETE FROM avatar_flagged_users WHERE user_id = ?`,
        [userId]
    );
}
async function dbGetFlaggedUser(userId) {
    return await db.query(
        `SELECT * FROM avatar_flagged_users WHERE user_id = ?`,
        [userId],
        true
    );
}
async function dbAddIgnoredUser(userId, avatarHash, discordTag) {
    await db.query(
        `INSERT OR REPLACE INTO avatar_flagged_ignore (user_id, avatar_hash, discord_tag, ignored_at)
         VALUES (?, ?, ?, ?)`,
        [userId, avatarHash, discordTag, new Date().toISOString()]
    );
}
async function dbGetIgnoredUser(userId) {
    return await db.query(
        `SELECT * FROM avatar_flagged_ignore WHERE user_id = ?`,
        [userId],
        true
    );
}
async function getSetting(key) {
    const row = await db.query(
        `SELECT value FROM avatar_flagged_settings WHERE key = ?`,
        [key],
        true
    );
    return row?.value ?? null;
}
async function setSetting(key, value) {
    await db.query(
        `INSERT OR REPLACE INTO avatar_flagged_settings (key, value) VALUES (?, ?)`,
        [key, value]
    );
}
async function getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
async function getCreditsUsed() {
    const value = await getSetting('sightengine_credits_used');
    return parseInt(value || '0', 10);
}
async function getResetMonth() {
    return getSetting('sightengine_credits_reset_month');
}
async function incrementCreditsUsed(amount) {
    const release = await creditMutex.acquire();
    try {
        const currentMonth = await getCurrentMonth();
        const resetMonth = await getResetMonth();
        if (resetMonth !== currentMonth) {
            await setSetting('sightengine_credits_used', amount.toString());
            await setSetting('sightengine_credits_reset_month', currentMonth);
        } else {
            const used = await getCreditsUsed();
            await setSetting('sightengine_credits_used', (used + amount).toString());
        }
    } finally {
        release();
    }
}
async function getCreditsRemaining() {
    const used = await getCreditsUsed();
    return Math.max(0, MONTHLY_CREDITS - used);
}
async function applyDenyOverwrites(guild, member) {
    const helpers = require('../utils/helpers');
    const channelIds = [...(helpers.avatarRestrictedChannels || [])];
    const categoryIds = helpers.avatarRestrictedCategories || [];
    for (const categoryId of categoryIds) {
        const category = guild.channels.cache.get(categoryId);
        if (category && (category.type === 4 || category.type === 'GUILD_CATEGORY' || category.type === 'CategoryChannel')) {
            const children = guild.channels.cache.filter(
                c => c.parentId === category.id && c.isTextBased()
            );
            for (const child of children.values()) {
                if (!channelIds.includes(child.id)) channelIds.push(child.id);
            }
        }
    }
    for (const channelId of channelIds) {
        const channel = guild.channels.cache.get(channelId);
        if (channel && channel.isTextBased()) {
            await channel.permissionOverwrites.create(member, {
                ViewChannel: false
            }).catch(() => {});
        }
    }
}
async function removeDenyOverwrites(guild, member) {
    const helpers = require('../utils/helpers');
    const channelIds = [...(helpers.avatarRestrictedChannels || [])];
    const categoryIds = helpers.avatarRestrictedCategories || [];
    for (const categoryId of categoryIds) {
        const category = guild.channels.cache.get(categoryId);
        if (category && (category.type === 4 || category.type === 'GUILD_CATEGORY' || category.type === 'CategoryChannel')) {
            const children = guild.channels.cache.filter(
                c => c.parentId === category.id && c.isTextBased()
            );
            for (const child of children.values()) {
                if (!channelIds.includes(child.id)) channelIds.push(child.id);
            }
        }
    }
    for (const channelId of channelIds) {
        const channel = guild.channels.cache.get(channelId);
        if (channel) {
            const overwrite = channel.permissionOverwrites.cache.get(member.id);
            if (overwrite) {
                await overwrite.delete().catch(() => {});
            }
        }
    }
}
async function sendWarningToUser(client, userId, customMessage) {
    try {
        const user = await client.users.fetch(userId);
        const msg = customMessage || (
            `${ALERT_EMOJI} **Notice from Velutinx's server**\n\n` +
            `Your profile picture has been flagged as potentially inappropriate. ` +
            `Please change it to something more suitable to continue having unrestricted access to the server.\n\n` +
            `Your access to content channels remains unaffected, but communication may be limited until this is resolved.\n\n` +
            `If you have any questions, please message <@1380051214766444617>.`
        );
        await user.send(msg);
        return true;
    } catch (err) {
        console.error(`[AvatarScan] Could not DM user ${userId}:`, err.message);
        return false;
    }
}
async function alertOwner(client, member, sightResult, nsfwCheckersResult, {
    extraText = '',
    includeCredits = true,
    isFlagged = true
} = {}) {
    const owner = await client.users.fetch(ids.users.Velutinx).catch(() => null);
    if (!owner) return;
    const sightNudity = getSightNudityScore(sightResult);
    const nsfwCheckersScore = nsfwCheckersResult?.score ?? 'N/A';
    const nsfwCheckersVerdict = nsfwCheckersResult?.nsfw ?? 'N/A';
    let sightFieldName = 'Sightengine';
    if (includeCredits && sightResult) {
        const remaining = await getCreditsRemaining();
        sightFieldName = `Sightengine (${remaining} remaining this month)`;
    }
    const embed = new EmbedBuilder()
        .setTitle(isFlagged ? `${ALERT_EMOJI} NSFW Avatar Detected` : `${ALERT_EMOJI} Avatar Scan Result`)
        .setColor(isFlagged ? 0xFF0000 : 0x00FF00)
        .setThumbnail(member.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            { name: 'User', value: `${member.user.tag} (${member.id})` },
            { name: 'Avatar URL', value: member.displayAvatarURL({ dynamic: true, size: 1024 }) },
            { name: sightFieldName, value: `${sightResult ? sightNudity.toFixed(2) : 'N/A'} (sexual: ${sightResult ? (sightResult.nudity?.sexual_activity || 0).toFixed(2) : 'N/A'})` },
            { name: 'NSFWCheckers', value: `${nsfwCheckersVerdict} (score: ${typeof nsfwCheckersScore === 'number' ? nsfwCheckersScore.toFixed(2) : nsfwCheckersScore})` },
            { name: 'Scan Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
        );
    if (extraText) embed.setDescription(extraText);
    const components = [];
    if (isFlagged) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`warn_avatar_${member.id}`)
                .setLabel(`${ALERT_EMOJI} Warn User`)
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`ignore_avatar_${member.id}`)
                .setLabel('🔍 Add to Ignore')
                .setStyle(ButtonStyle.Secondary)
        );
        components.push(row);
    } else {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ignore_avatar_${member.id}`)
                .setLabel('🔍 Add to Ignore')
                .setStyle(ButtonStyle.Secondary)
        );
        components.push(row);
    }
    owner.send({ embeds: [embed], components }).catch(() => {});
}
async function alertOwnerAvatarChange(client, member, oldHash, newHash) {
    if (!oldHash && !newHash) {
        console.log(`[AvatarScanner] Skipping avatar change alert for ${member.user.tag} – no valid hash change.`);
        return;
    }
    const owner = await client.users.fetch(ids.users.Velutinx).catch(() => null);
    if (!owner) return;
    const embed = new EmbedBuilder()
        .setTitle(`${ALERT_EMOJI} Flagged User Changed Avatar`)
        .setColor(0xFFA500)
        .setThumbnail(member.displayAvatarURL({ dynamic: true, size: 256 }))
        .setDescription(`${member.user.tag} (${member.id}) changed their profile picture.`)
        .addFields(
            { name: 'New Avatar URL', value: member.displayAvatarURL({ dynamic: true, size: 1024 }) || 'No avatar' },
            { name: 'Old Hash', value: oldHash || 'None' },
            { name: 'New Hash', value: newHash || 'None' }
        );
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`accept_avatar_${member.id}`)
            .setLabel(`${releaseEmojis?.getRandomVerify?.() || '✅'} Accept`)
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`deny_avatar_${member.id}`)
            .setLabel(`${releaseEmojis?.BATSU || '❌'} Deny`)
            .setStyle(ButtonStyle.Danger)
    );
    owner.send({ embeds: [embed], components: [row] }).catch(() => {});
}
async function processMember(client, member, threshold = NUDITY_THRESHOLD, skipCleanAlert = false) {
    if (member.user.bot) return;
    const avatarUrl = member.displayAvatarURL({ dynamic: true, size: 1024 });
    if (!avatarUrl || avatarUrl.includes('discord.com/assets/')) return;

    const isTestAccount = member.id === '1478242857964802170';
    try {
        const [sightResult, nsfwCheckersResult] = await Promise.all([
            scanWithSightengine(avatarUrl),
            scanWithNSFWCheckers(avatarUrl).catch(() => null)
        ]);
        const sightNudity = getSightNudityScore(sightResult);
        const nsfwCheckersScore = nsfwCheckersResult?.score ?? null;
        const flagged =
            isTestAccount ||
            sightNudity >= threshold ||
            (nsfwCheckersScore !== null && nsfwCheckersScore >= threshold);
        if (flagged || !skipCleanAlert) {
            await alertOwner(client, member, sightResult, nsfwCheckersResult, {
                isFlagged: flagged,
                extraText: ''
            });
        }
        if (flagged) console.log(`[AvatarScan] Flagged: ${member.user.tag}`);
    } catch (err) {
        console.error(`[AvatarScan] Error scanning ${member.user.tag}:`, err.message);
    }
}
async function scanAllMembersWithFreeAPI(client) {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const fetchMembers = async () => {
    let attempts = 0;
    while (attempts < 3) {
      try {
        return await guild.members.fetch();
      } catch (err) {
        if (err.name === 'GatewayRateLimitError' && err.data?.retry_after) {
          const waitMs = (err.data.retry_after + 0.5) * 1000;
          await new Promise(resolve => setTimeout(resolve, waitMs));
          attempts++;
        } else {
          throw err;
        }
      }
    }
    throw new Error('Failed to fetch members after 3 retries');
  };

  let members;
  try {
    members = await fetchMembers();
  } catch (err) {
    console.error('[MassScan] Could not fetch members, aborting scan:', err.message);
    throw err;
  }

  const memberArray = [...members.values()];
  let scanned = 0;
  let flagged = 0;

  for (const member of memberArray) {
    if (member.user.bot) continue;

    const avatarUrl = member.displayAvatarURL({ dynamic: true, size: 1024 });
    if (!avatarUrl || avatarUrl.includes('discord.com/assets/')) continue;

    const ignoredEntry = await dbGetIgnoredUser(member.id);
    if (ignoredEntry && ignoredEntry.avatar_hash === getAvatarHash(member)) continue;

    try {
      const nsfwCheckersResult = await scanWithNSFWCheckers(avatarUrl);
      const score = nsfwCheckersResult?.score ?? null;
      if (score !== null && score >= MASS_SCAN_THRESHOLD) {
        console.log(`[MassScan] Flagged (free): ${member.user.tag} (score: ${score.toFixed(2)})`);
        await alertOwner(client, member, null, nsfwCheckersResult, {
          isFlagged: true,
          includeCredits: false,
          extraText: '🔍 **Mass scan (free API only)**'
        });
        flagged++;
      }
    } catch (err) {
      console.error(`[MassScan] Error scanning ${member.user.tag}:`, err.message);
    }

    scanned++;
    if (scanned < memberArray.length) {
      await new Promise(resolve => setTimeout(resolve, SCAN_DELAY_MS));
    }
  }

  // Only log if flagged > 0
  if (flagged > 0) {
    console.log(`[MassScan] Finished scanning ${scanned} members, flagged ${flagged}.`);
  }
}

// ─── Monthly Sightengine scan (prompted by owner) ──────────────────
async function performMonthlyScan(client) {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const members = await guild.members.fetch();
  const memberArray = [...members.values()];
  let scanned = 0;
  let flagged = 0;

  const creditsBefore = await getCreditsRemaining();

  for (const member of memberArray) {
    if (member.user.bot) continue;

    const avatarUrl = member.displayAvatarURL({ dynamic: true, size: 1024 });
    if (!avatarUrl || avatarUrl.includes('discord.com/assets/')) continue;

    const ignoredEntry = await dbGetIgnoredUser(member.id);
    if (ignoredEntry && ignoredEntry.avatar_hash === getAvatarHash(member)) continue;

    try {
      const sightResult = await scanWithSightengine(avatarUrl);
      const nudity = getSightNudityScore(sightResult);
      if (nudity >= 0.3) {
        console.log(`[MonthlyScan] Flagged: ${member.user.tag} (nudity: ${nudity.toFixed(2)})`);
        await alertOwner(client, member, sightResult, null, {
          isFlagged: true,
          extraText: '🔍 **Monthly Sightengine scan**'
        });
        flagged++;
      }
    } catch (err) {
      console.error(`[MonthlyScan] Error scanning ${member.user.tag}:`, err.message);
    }

    scanned++;
    if (scanned < memberArray.length) {
      await new Promise(resolve => setTimeout(resolve, SCAN_DELAY_MS));
    }
  }

  const creditsAfter = await getCreditsRemaining();
  const used = creditsBefore - creditsAfter;

  // Only log if flagged > 0
  if (flagged > 0) {
    console.log(`[MonthlyScan] Finished scanning ${scanned} members, flagged ${flagged}. Used ${used} credits.`);
  }

  return { scanned, flagged, used };
}
async function shouldRunMassScanToday() {
    const lastScanDate = await getSetting('mass_scan_free_date');
    const today = new Date().toISOString().slice(0, 10);
    return lastScanDate !== today;
}
async function markMassScanDoneToday() {
    const today = new Date().toISOString().slice(0, 10);
    await setSetting('mass_scan_free_date', today);
}
async function sendMonthlyPrompt(client) {
    const owner = await client.users.fetch(ids.users.Velutinx).catch(() => null);
    if (!owner) return;
    const guild = client.guilds.cache.first();
    const memberCount = guild ? guild.memberCount : 'unknown';
    const remaining = await getCreditsRemaining();
    const embed = new EmbedBuilder()
        .setTitle(`${ALERT_EMOJI} Monthly Global Scan Available`)
        .setColor(0x0099FF)
        .setDescription(
            `It's the end of the month! You can run a full global scan using **Sightengine only** (threshold 0.3).\n` +
            `This will scan all members, excluding ignored users with unchanged avatars.`
        )
        .addFields(
            { name: 'Server Members', value: `${memberCount}`, inline: true },
            { name: 'Sightengine Credits Left', value: `${remaining} / ${MONTHLY_CREDITS}`, inline: true },
            { name: 'Estimated Scan Cost', value: `Up to ${memberCount} credits`, inline: true }
        );
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('monthly_scan_accept')
            .setLabel('🚀 Run Global Scan')
            .setStyle(ButtonStyle.Success)
    );
    await owner.send({ embeds: [embed], components: [row] });
}
async function checkMonthlyScanPrompt(client) {
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const utcDate = now.getUTCDate();
    const utcHours = now.getUTCHours();
    const lastDayOfMonth = new Date(utcYear, utcMonth + 1, 0).getUTCDate();
    const oneDayBeforeLast = lastDayOfMonth - 1;
    const todayStr = now.toISOString().slice(0, 10);
    const alreadyPromptedToday = await getSetting('monthly_scan_prompt_day') === todayStr;
    const alreadyAccepted = await getSetting('monthly_scan_accepted') === 'true';
    if (utcDate === oneDayBeforeLast) {
        if (!alreadyPromptedToday && !alreadyAccepted) {
            await sendMonthlyPrompt(client);
            await setSetting('monthly_scan_prompt_day', todayStr);
        }
        return;
    }
    if (utcDate === lastDayOfMonth) {
        if (alreadyAccepted) return;
        if (PROMPT_HOURS.includes(utcHours)) {
            const lastPromptHour = await getSetting('monthly_scan_last_prompt_hour');
            if (lastPromptHour !== utcHours.toString()) {
                await sendMonthlyPrompt(client);
                await setSetting('monthly_scan_last_prompt_hour', utcHours.toString());
                await setSetting('monthly_scan_prompt_day', todayStr);
            }
        }
    }
}
async function handleScanCommand(message) {
    if (message.author.id !== ids.users.Velutinx) return;
    if (!message.content.startsWith('!scan')) return;
    const input = message.content.slice('!scan'.length).trim();
    let target;
    if (message.mentions.members.size > 0) {
        target = message.mentions.members.first();
    } else if (input && /^\d{17,21}$/.test(input)) {
        try {
            target = await message.guild.members.fetch(input);
        } catch {
            return message.reply(`${releaseEmojis?.BATSU || '❌'} User not found in this server.`);
        }
    } else if (!input) {
        target = message.member;
    } else {
        return message.reply(`${releaseEmojis?.BATSU || '❌'} Provide a valid user ID or mention.`);
    }

    const reply = await message.reply(`🔍 Scanning avatar of ${target.user.tag}...`);
    await processMember(message.client, target, NUDITY_THRESHOLD, false);
    reply.edit(`${releaseEmojis?.getRandomVerify?.() || '✅'} Scan complete for <@${target.id}>. Check your DM for details.`).catch(() => {});
}
async function handleWarnButton(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const targetUserId = interaction.customId.replace('warn_avatar_', '');
    const guild = interaction.client.guilds.cache.first();
    if (!guild) return interaction.editReply({ content: 'Guild not found.' });
    const member = await guild.members.fetch(targetUserId).catch(() => null);
    if (!member) return interaction.editReply({ content: 'User not found in server.' });
    const dmSuccess = await sendWarningToUser(interaction.client, targetUserId);
    const avatarHash = getAvatarHash(member);
    await dbAddFlaggedUser(targetUserId, avatarHash, member.user.tag);
    await applyDenyOverwrites(guild, member);
    let replyMsg = '';
    replyMsg += dmSuccess ? `${releaseEmojis?.getRandomVerify?.() || '✅'} Warning sent to <@${targetUserId}>.` : `${releaseEmojis?.BATSU || '❌'} Failed to DM <@${targetUserId}>.`;
    replyMsg += ` Channel restrictions applied.`;
    await interaction.editReply({ content: replyMsg });
}
async function handleIgnoreButton(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const targetUserId = interaction.customId.replace('ignore_avatar_', '');
        const guild = interaction.client.guilds.cache.first();
        if (!guild) {
            return interaction.editReply({ content: 'Guild not found.' });
        }
        const member = await guild.members.fetch(targetUserId).catch(() => null);
        if (!member) {
            return interaction.editReply({ content: 'User not found in server.' });
        }
        await dbAddIgnoredUser(targetUserId, getAvatarHash(member), member.user.tag);
        await interaction.editReply({
            content: `${releaseEmojis?.getRandomVerify?.() || '✅'} <@${targetUserId}> has been added to the ignore list. Future scans will skip them unless they change their avatar.`
        });
    } catch (err) {
        console.error('Ignore button error:', err);
        await interaction.editReply({ content: 'An error occurred while adding to ignore list.' }).catch(() => {});
    }
}
async function handleAcceptButton(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const targetUserId = interaction.customId.replace('accept_avatar_', '');
    const guild = interaction.client.guilds.cache.first();
    if (!guild) return interaction.editReply({ content: 'Guild not found.' });
    const member = await guild.members.fetch(targetUserId).catch(() => null);
    if (!member) return interaction.editReply({ content: 'User not in server.' });
    await sendWarningToUser(interaction.client, targetUserId,
        `${releaseEmojis?.getRandomVerify?.() || '✅'} Your profile picture has been approved. You now have unrestricted access again. Thank you!`
    );
    await removeDenyOverwrites(guild, member);
    await dbRemoveFlaggedUser(targetUserId);
    await interaction.editReply({ content: `${releaseEmojis?.getRandomVerify?.() || '✅'} <@${targetUserId}> has been accepted. Their restrictions are lifted.` });
}
async function handleDenyButton(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const targetUserId = interaction.customId.replace('deny_avatar_', '');
    const guild = interaction.client.guilds.cache.first();
    if (!guild) return interaction.editReply({ content: 'Guild not found.' });
    const member = await guild.members.fetch(targetUserId).catch(() => null);
    if (!member) {
        await dbRemoveFlaggedUser(targetUserId);
        return interaction.editReply({ content: 'User no longer in server.' });
    }
    await sendWarningToUser(interaction.client, targetUserId,
        `${releaseEmojis?.BATSU || '❌'} Your new profile picture is still not acceptable. Please change it to a more appropriate one.`
    );
    const newHash = getAvatarHash(member);
    await dbAddFlaggedUser(targetUserId, newHash, member.user.tag);
    await interaction.editReply({ content: `${releaseEmojis?.BATSU || '❌'} <@${targetUserId}> has been informed. Awaiting a new avatar change.` });
}
async function handleMonthlyScanAccept(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (interaction.user.id !== ids.users.Velutinx) {
        return interaction.editReply({ content: 'Only the server owner can accept this.' });
    }
    const alreadyAccepted = await getSetting('monthly_scan_accepted');
    if (alreadyAccepted === 'true') {
        return interaction.editReply({ content: `${releaseEmojis?.getRandomVerify?.() || '✅'} Monthly scan has already been accepted.` });
    }
    await setSetting('monthly_scan_accepted', 'true');
    await interaction.editReply({ content: `${releaseEmojis?.getRandomVerify?.() || '✅'} Monthly global scan started! You will receive results via DM as users are flagged.` });
    const client = interaction.client;
    performMonthlyScan(client).then(async (result) => {
        const remaining = await getCreditsRemaining();
        client.users.fetch(ids.users.Velutinx).then(owner => {
            owner.send(`📊 Monthly scan completed.\nScanned: ${result.scanned}\nFlagged: ${result.flagged}\nCredits used: ${result.used}\nRemaining: ${remaining}`);
        }).catch(() => {});
    }).catch(err => {
        console.error('[MonthlyScan] Fatal error:', err);
    });
}
async function onUserUpdate(oldUser, newUser) {
    if (oldUser.avatar === newUser.avatar) return;
    const userId = newUser.id;
    const dbEntry = await dbGetFlaggedUser(userId);
    if (!dbEntry) return;
    const guild = oldUser.client.guilds.cache.first();
    if (!guild) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    await alertOwnerAvatarChange(oldUser.client, member, oldUser.avatar, newUser.avatar);
}
let monthlyCheckInterval = null;
function startMonthlyCheck(client) {
    checkMonthlyScanPrompt(client).catch(() => {});
    monthlyCheckInterval = setInterval(() => {
        checkMonthlyScanPrompt(client).catch(() => {});
    }, 900000);
    const scheduleMonthReset = () => {
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const msUntilNext = nextMonth - now;
        safeTimeout(async () => {
            await setSetting('monthly_scan_accepted', 'false');
            await setSetting('monthly_scan_prompt_day', '');
            await setSetting('monthly_scan_last_prompt_hour', '');
            scheduleMonthReset();
        }, msUntilNext);
    };
    scheduleMonthReset();
}
function init(client) {
    client.on('messageCreate', handleScanCommand);
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isButton()) return;
        if (interaction.customId === 'enter_giveaway') return;
        const avatarScannerButtons = [
            'monthly_scan_accept',
            'warn_avatar_',
            'ignore_avatar_',
            'accept_avatar_'
        ];
        if (
            !avatarScannerButtons.some(id =>
                interaction.customId.startsWith(id)
            )
        ) {
            return;
        }
        if (interaction.user.id !== ids.users.Velutinx) {
            return interaction.reply({
                content: 'Only the server owner can use these buttons.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (interaction.customId.startsWith('warn_avatar_')) {
            await handleWarnButton(interaction);
        } else if (interaction.customId.startsWith('ignore_avatar_')) {
            await handleIgnoreButton(interaction);
        } else if (interaction.customId.startsWith('accept_avatar_')) {
            await handleAcceptButton(interaction);
        } else if (interaction.customId.startsWith('deny_avatar_')) {
            await handleDenyButton(interaction);
        } else if (interaction.customId === 'monthly_scan_accept') {
            await handleMonthlyScanAccept(interaction);
        }
    });
    client.on(Events.UserUpdate, onUserUpdate);
    client.once(Events.ClientReady, async () => {
        setTimeout(async () => {
            try {
                if (await shouldRunMassScanToday()) {
                    await markMassScanDoneToday();
                    await scanAllMembersWithFreeAPI(client);
                }
            } catch (err) {
                console.error('[MassScan] Fatal error during daily free mass scan:', err);
            }
        }, 30000);
        startMonthlyCheck(client);
    });
}
module.exports = { init, processMember, NUDITY_THRESHOLD };
