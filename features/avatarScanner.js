// features/avatarScanner.js
const {
    EmbedBuilder,
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');
const { ids, sightengine } = require('../utils/helpers');
const supabase = require('../services/supabase');

// ========== CONFIG ==========
const NUDITY_THRESHOLD = 0.5;
const MASS_SCAN_THRESHOLD = 0.3;
const SCAN_DELAY_MS = 2000;
const MONTHLY_CREDITS = 2000;
const PROMPT_HOURS = [14, 16, 18];      // 2 PM, 4 PM, 6 PM (GMT-7)

// ========== SIGHTENGINE SCAN ==========
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

// ========== NSFWCheckers (FREE FOREVER, no API key) ==========
async function scanWithNSFWCheckers(url) {
    const imageRes = await fetch(url);
    if (!imageRes.ok) throw new Error(`Failed to download image: ${imageRes.status}`);
    const imageBuffer = await imageRes.arrayBuffer();

    const formData = new FormData();
    formData.append('image', new Blob([imageBuffer]), 'avatar.webp');

    const res = await fetch('https://api.nsfwcheckers.workers.dev', {
        method: 'POST',
        body: formData,
    });
    return res.json();
}

// ========== AVATAR HASH HELPER ==========
function getAvatarHash(member) {
    return member.user.avatar || 'default';
}

// ========== DATABASE OPERATIONS (flagged) ==========
async function dbAddFlaggedUser(userId, avatarHash, discordTag) {
    await supabase.from('avatar_flagged_users').upsert({
        user_id: userId,
        avatar_hash: avatarHash,
        discord_tag: discordTag,
        flagged_at: new Date().toISOString()
    });
}

async function dbRemoveFlaggedUser(userId) {
    await supabase.from('avatar_flagged_users').delete().eq('user_id', userId);
}

async function dbGetFlaggedUser(userId) {
    const { data } = await supabase.from('avatar_flagged_users')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
    return data;
}

// ========== DATABASE OPERATIONS (ignored) ==========
async function dbAddIgnoredUser(userId, avatarHash, discordTag) {
    await supabase.from('avatar_flagged_ignore').upsert({
        user_id: userId,
        avatar_hash: avatarHash,
        discord_tag: discordTag,
        ignored_at: new Date().toISOString()
    });
}

async function dbGetIgnoredUser(userId) {
    const { data } = await supabase.from('avatar_flagged_ignore')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
    return data;
}

// ========== DATABASE OPERATIONS (settings) ==========
async function getSetting(key) {
    const { data } = await supabase.from('avatar_flagged_settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();
    return data?.value ?? null;
}

async function setSetting(key, value) {
    await supabase.from('avatar_flagged_settings').upsert({ key, value });
}

// ========== CREDIT TRACKING ==========
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
    const currentMonth = await getCurrentMonth();
    const resetMonth = await getResetMonth();

    if (resetMonth !== currentMonth) {
        await setSetting('sightengine_credits_used', amount.toString());
        await setSetting('sightengine_credits_reset_month', currentMonth);
    } else {
        const used = await getCreditsUsed();
        await setSetting('sightengine_credits_used', (used + amount).toString());
    }
}

async function getCreditsRemaining() {
    const used = await getCreditsUsed();
    return Math.max(0, MONTHLY_CREDITS - used);
}

// ========== CHANNEL OVERWRITE MANAGEMENT ==========
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
                if (!channelIds.includes(child.id)) {
                    channelIds.push(child.id);
                }
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
                if (!channelIds.includes(child.id)) {
                    channelIds.push(child.id);
                }
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

// ========== WARNING MESSAGE ==========
async function sendWarningToUser(client, userId, customMessage) {
    try {
        const user = await client.users.fetch(userId);
        const msg = customMessage || (
            `⚠️ **Notice from Velutinx's server**\n\n` +
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

// ========== ALERT OWNER – INITIAL FLAG (with Warn + Ignore buttons) ==========
async function alertOwner(client, member, sightResult, nsfwCheckersResult, extraText = '', includeCredits = true) {
    const owner = await client.users.fetch(ids.users.Velutinx).catch(() => null);
    if (!owner) return;

    const sightNudity = sightResult ? (sightResult.nudity?.raw || 0) : 'N/A';
    const nsfwCheckersScore = nsfwCheckersResult?.score ?? 'N/A';
    const nsfwCheckersVerdict = nsfwCheckersResult?.nsfw ?? 'N/A';

    const embed = new EmbedBuilder()
        .setTitle('⚠️ NSFW Avatar Detected')
        .setColor(0xFF0000)
        .setThumbnail(member.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            { name: 'User', value: `${member.user.tag} (${member.id})` },
            { name: 'Avatar URL', value: member.displayAvatarURL({ dynamic: true, size: 1024 }) },
            { name: 'Sightengine', value: `${typeof sightNudity === 'number' ? sightNudity.toFixed(2) : sightNudity} (sexual: ${typeof sightNudity === 'number' ? (sightResult.nudity?.sexual_activity || 0).toFixed(2) : 'N/A'})` },
            { name: 'NSFWCheckers', value: `${nsfwCheckersVerdict} (score: ${typeof nsfwCheckersScore === 'number' ? nsfwCheckersScore.toFixed(2) : nsfwCheckersScore})` },
            { name: 'Scan Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
        );

    if (extraText) embed.setDescription(extraText);

    if (includeCredits && sightResult) {
        const remaining = await getCreditsRemaining();
        embed.addFields({ name: 'Sightengine Credits', value: `${remaining} remaining this month` });
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`warn_avatar_${member.id}`)
            .setLabel('⚠️ Warn User')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`ignore_avatar_${member.id}`)
            .setLabel('🔄 Ignore (False Flag)')
            .setStyle(ButtonStyle.Secondary)
    );

    owner.send({ embeds: [embed], components: [row] }).catch(() => {});
}

// ========== ALERT OWNER – AVATAR CHANGE DETECTED ==========
async function alertOwnerAvatarChange(client, member, oldHash, newHash) {
    const owner = await client.users.fetch(ids.users.Velutinx).catch(() => null);
    if (!owner) return;

    const embed = new EmbedBuilder()
        .setTitle('🔄 Flagged User Changed Avatar')
        .setColor(0xFFA500)
        .setThumbnail(member.displayAvatarURL({ dynamic: true, size: 256 }))
        .setDescription(`${member.user.tag} (${member.id}) changed their profile picture.`)
        .addFields(
            { name: 'New Avatar URL', value: member.displayAvatarURL({ dynamic: true, size: 1024 }) },
            { name: 'Old Hash', value: oldHash },
            { name: 'New Hash', value: newHash }
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`accept_avatar_${member.id}`)
            .setLabel('✅ Accept')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`deny_avatar_${member.id}`)
            .setLabel('❌ Deny')
            .setStyle(ButtonStyle.Danger)
    );

    owner.send({ embeds: [embed], components: [row] }).catch(() => {});
}

// ========== PROCESS MEMBER (normal scan) ==========
async function processMember(client, member, threshold = NUDITY_THRESHOLD) {
    if (member.user.bot) return;
    const avatarUrl = member.displayAvatarURL({ dynamic: true, size: 1024 });
    if (!avatarUrl || avatarUrl.includes('discord.com/assets/')) return;

    const isTestAccount = member.id === '1478242857964802170';

    try {
        const [sightResult, nsfwCheckersResult] = await Promise.all([
            scanWithSightengine(avatarUrl),
            scanWithNSFWCheckers(avatarUrl).catch(() => null)
        ]);

        const sightNudity = sightResult.nudity?.raw || 0;
        const nsfwCheckersScore = nsfwCheckersResult?.score ?? null;

        console.log(
            `[AvatarScan] ${member.user.tag}: ` +
            `Sightengine=${sightNudity.toFixed(2)}, ` +
            `NSFWCheckers=${nsfwCheckersScore !== null ? nsfwCheckersScore.toFixed(2) : 'N/A'}`
        );

        const flagged =
            isTestAccount ||
            sightNudity >= threshold ||
            (nsfwCheckersScore !== null && nsfwCheckersScore >= threshold);

        if (flagged) {
            if (isTestAccount) console.log('[AvatarScan] Test account forced flag.');
            console.log(`[AvatarScan] NSFW detected: ${member.user.tag}`);
            await alertOwner(client, member, sightResult, nsfwCheckersResult);
        }
    } catch (err) {
        console.error(`[AvatarScan] Error scanning ${member.user.tag}:`, err.message);
    }
}

// ========== MASS SCAN (FREE API ONLY) ==========
async function scanAllMembersWithFreeAPI(client) {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    // console.log removed as requested
    const members = await guild.members.fetch();
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
            const nsfwCheckersResult = await scanWithNSFWCheckers(avatarUrl).catch(() => null);
            const score = nsfwCheckersResult?.score ?? null;
            if (score !== null && score >= MASS_SCAN_THRESHOLD) {
                console.log(`[MassScan] Flagged (free): ${member.user.tag} (score: ${score.toFixed(2)})`);
                await alertOwner(client, member, null, nsfwCheckersResult, '🔍 **Mass scan (free API only)**', false);
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
    // console.log removed
}

// ========== MONTHLY SIGHTENGINE-ONLY SCAN ==========
async function performMonthlyScan(client) {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    // console.log removed
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
            const nudity = sightResult.nudity?.raw || 0;
            if (nudity >= 0.3) {
                console.log(`[MonthlyScan] Flagged: ${member.user.tag} (nudity: ${nudity.toFixed(2)})`);
                await alertOwner(client, member, sightResult, null, '🔍 **Monthly Sightengine scan**', true);
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
    // console.log removed
    return { scanned, flagged, used };
}

// ========== MONTHLY PROMPT LOGIC ==========
async function sendMonthlyPrompt(client) {
    const owner = await client.users.fetch(ids.users.Velutinx).catch(() => null);
    if (!owner) return;

    const guild = client.guilds.cache.first();
    const memberCount = guild ? guild.memberCount : 'unknown';
    const remaining = await getCreditsRemaining();

    const embed = new EmbedBuilder()
        .setTitle('🗓️ Monthly Global Scan Available')
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
    const today = new Date().toISOString().slice(0, 10);
    await setSetting('monthly_scan_prompt_day', today);
}

async function checkMonthlyScanPrompt(client) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const date = now.getDate();

    const lastDay = new Date(year, month + 1, 0).getDate();
    const oneDayBeforeLast = lastDay - 1;

    const todayStr = now.toISOString().slice(0, 10);
    const gmt7Hour = (now.getUTCHours() - 7 + 24) % 24;

    if (date === oneDayBeforeLast) {
        const alreadyPromptedToday = await getSetting('monthly_scan_prompt_day') === todayStr;
        const alreadyAccepted = await getSetting('monthly_scan_accepted') === 'true';
        if (!alreadyPromptedToday && !alreadyAccepted) {
            await sendMonthlyPrompt(client);
        }
        return;
    }

    if (date === lastDay) {
        const alreadyAccepted = await getSetting('monthly_scan_accepted') === 'true';
        if (alreadyAccepted) return;

        if (PROMPT_HOURS.includes(gmt7Hour)) {
            const lastPromptHour = await getSetting('monthly_scan_last_prompt_hour');
            if (lastPromptHour !== gmt7Hour.toString()) {
                await sendMonthlyPrompt(client);
                await setSetting('monthly_scan_last_prompt_hour', gmt7Hour.toString());
            }
        }
    }
}

// ========== MANUAL OWNER SCAN COMMAND ==========
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
            return message.reply('❌ User not found in this server.');
        }
    } else if (!input) {
        target = message.member;
    } else {
        return message.reply('❌ Provide a valid user ID or mention.');
    }

    const reply = await message.reply(`🔍 Scanning avatar of ${target.user.tag}...`);
    await processMember(message.client, target);
    reply.edit(`✅ Scan complete for <@${target.id}>. Check your DM if flagged.`).catch(() => {});
}

// ========== BUTTON: WARN USER ==========
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
    replyMsg += dmSuccess ? `✅ Warning sent to <@${targetUserId}>.` : `❌ Failed to DM <@${targetUserId}>.`;
    replyMsg += ` Channel restrictions applied.`;

    await interaction.editReply({ content: replyMsg });
}

// ========== BUTTON: IGNORE ==========
async function handleIgnoreButton(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUserId = interaction.customId.replace('ignore_avatar_', '');
    const guild = interaction.client.guilds.cache.first();
    if (!guild) return interaction.editReply({ content: 'Guild not found.' });

    const member = await guild.members.fetch(targetUserId).catch(() => null);
    if (!member) return interaction.editReply({ content: 'User not found in server.' });

    await dbAddIgnoredUser(targetUserId, getAvatarHash(member), member.user.tag);

    await interaction.editReply({ content: `✅ <@${targetUserId}> has been added to the ignore list. Future scans will skip them unless they change their avatar.` });
}

// ========== BUTTON: ACCEPT ==========
async function handleAcceptButton(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUserId = interaction.customId.replace('accept_avatar_', '');
    const guild = interaction.client.guilds.cache.first();
    if (!guild) return interaction.editReply({ content: 'Guild not found.' });

    const member = await guild.members.fetch(targetUserId).catch(() => null);
    if (!member) return interaction.editReply({ content: 'User not in server.' });

    await sendWarningToUser(interaction.client, targetUserId,
        '✅ Your profile picture has been approved. You now have unrestricted access again. Thank you!'
    );

    await removeDenyOverwrites(guild, member);
    await dbRemoveFlaggedUser(targetUserId);

    await interaction.editReply({ content: `✅ <@${targetUserId}> has been accepted. Their restrictions are lifted.` });
}

// ========== BUTTON: DENY ==========
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
        '❌ Your new profile picture is still not acceptable. Please change it to a more appropriate one.'
    );

    const newHash = getAvatarHash(member);
    await dbAddFlaggedUser(targetUserId, newHash, member.user.tag);

    await interaction.editReply({ content: `❌ <@${targetUserId}> has been informed. Awaiting a new avatar change.` });
}

// ========== BUTTON: MONTHLY SCAN ACCEPT ==========
async function handleMonthlyScanAccept(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (interaction.user.id !== ids.users.Velutinx) {
        return interaction.editReply({ content: 'Only the server owner can accept this.' });
    }

    const alreadyAccepted = await getSetting('monthly_scan_accepted');
    if (alreadyAccepted === 'true') {
        return interaction.editReply({ content: 'Monthly scan has already been accepted.' });
    }

    await setSetting('monthly_scan_accepted', 'true');
    await interaction.editReply({ content: '✅ Monthly global scan started! You will receive results via DM as users are flagged.' });

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

// ========== AVATAR CHANGE DETECTION ==========
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

// ========== PERIODIC MONTHLY CHECK ==========
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
        setTimeout(() => {
            setSetting('monthly_scan_accepted', 'false');
            setSetting('monthly_scan_prompt_day', '');
            setSetting('monthly_scan_last_prompt_hour', '');
            scheduleMonthReset();
        }, msUntilNext);
    };
    scheduleMonthReset();
}

// ========== EVENT LISTENERS ==========
function init(client) {
    client.on('messageCreate', handleScanCommand);

    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isButton()) return;

        if (interaction.customId.startsWith('monthly_scan_accept')) {
            await handleMonthlyScanAccept(interaction);
            return;
        }

        if (interaction.user.id !== ids.users.Velutinx) {
            return interaction.reply({ content: 'Only the server owner can use these buttons.', flags: MessageFlags.Ephemeral });
        }

        if (interaction.customId.startsWith('warn_avatar_')) {
            await handleWarnButton(interaction);
        } else if (interaction.customId.startsWith('ignore_avatar_')) {
            await handleIgnoreButton(interaction);
        } else if (interaction.customId.startsWith('accept_avatar_')) {
            await handleAcceptButton(interaction);
        } else if (interaction.customId.startsWith('deny_avatar_')) {
            await handleDenyButton(interaction);
        }
    });

    client.on(Events.UserUpdate, onUserUpdate);

    client.once(Events.ClientReady, () => {
        console.log('[AvatarScan] Bot ready. Mass scan will start in 30 seconds...');
        setTimeout(() => {
            scanAllMembersWithFreeAPI(client).catch(err => console.error('[MassScan] Error:', err));
        }, 30000);
        startMonthlyCheck(client);
    });
}

module.exports = { init };
