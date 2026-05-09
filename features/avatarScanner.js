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
async function alertOwner(client, member, sightResult, nsfwCheckersResult, extraText = '') {
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

// ========== MASS SCAN (FREE API ONLY, with GatewayRateLimitError retry) ==========
async function scanAllMembersWithFreeAPI(client) {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    console.log('[MassScan] Starting full member scan (free API, threshold 0.3)...');

    // Helper to fetch members with GatewayRateLimitError retry
    const fetchAllMembers = async () => {
        try {
            return await guild.members.fetch(); // no force:true
        } catch (err) {
            // Catch gateway rate-limit errors specifically
            if (err.name === 'GatewayRateLimitError' && err.data?.retry_after) {
                const waitMs = (err.data.retry_after + 1) * 1000;
                console.log(`[MassScan] Gateway rate limited fetching members, waiting ${waitMs / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
                return guild.members.fetch(); // retry once
            }
            throw err;
        }
    };

    let members;
    try {
        members = await fetchAllMembers();
    } catch (err) {
        console.error('[MassScan] Failed to fetch members, aborting:', err.message);
        return;
    }

    const memberArray = [...members.values()];
    let scanned = 0;
    let flagged = 0;

    for (const member of memberArray) {
        if (member.user.bot) continue;
        const avatarUrl = member.displayAvatarURL({ dynamic: true, size: 1024 });
        if (!avatarUrl || avatarUrl.includes('discord.com/assets/')) continue;

        // Skip ignored users with the same avatar hash
        const ignoredEntry = await dbGetIgnoredUser(member.id);
        if (ignoredEntry && ignoredEntry.avatar_hash === getAvatarHash(member)) {
            continue;
        }

        // Scan with free API, retry on rate-limit
        let nsfwCheckersResult = null;
        try {
            nsfwCheckersResult = await scanWithNSFWCheckers(avatarUrl);
        } catch (err) {
            if (err.name === 'GatewayRateLimitError' && err.data?.retry_after) {
                const waitMs = (err.data.retry_after + 1) * 1000;
                console.log(`[MassScan] Rate limited scanning ${member.user.tag}, waiting ${waitMs / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
                nsfwCheckersResult = await scanWithNSFWCheckers(avatarUrl).catch(() => null);
            } else {
                console.error(`[MassScan] Error scanning ${member.user.tag}:`, err.message);
            }
        }

        const score = nsfwCheckersResult?.score ?? null;
        if (score !== null && score >= MASS_SCAN_THRESHOLD) {
            console.log(`[MassScan] Flagged (free): ${member.user.tag} (score: ${score.toFixed(2)})`);
            await alertOwner(client, member, null, nsfwCheckersResult, '🔍 **Mass scan (free API only)**');
            flagged++;
        }

        scanned++;
        if (scanned < memberArray.length) {
            await new Promise(resolve => setTimeout(resolve, SCAN_DELAY_MS));
        }
    }
    console.log(`[MassScan] Done. Scanned ${scanned} members, flagged ${flagged}.`);
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

// ========== EVENT LISTENERS ==========
function init(client) {
    client.on('messageCreate', handleScanCommand);

    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isButton()) return;

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
            scanAllMembersWithFreeAPI(client).catch(err => console.error('[MassScan] Unexpected error:', err));
        }, 30000);
    });
}

module.exports = { init };
