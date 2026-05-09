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

// ========== DATABASE OPERATIONS ==========
async function dbAddFlaggedUser(userId, avatarHash) {
    await supabase.from('avatar_flagged_users').upsert({
        user_id: userId,
        avatar_hash: avatarHash,
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

// ========== CHANNEL OVERWRITE MANAGEMENT ==========
async function applyDenyOverwrites(guild, member) {
    const channels = require('../utils/helpers').avatarRestrictedChannels;
    for (const channelId of channels) {
        const channel = guild.channels.cache.get(channelId);
        if (channel && channel.isTextBased()) {
            await channel.permissionOverwrites.create(member, {
                ViewChannel: false
            }).catch(() => {});
        }
    }
}

async function removeDenyOverwrites(guild, member) {
    const channels = require('../utils/helpers').avatarRestrictedChannels;
    for (const channelId of channels) {
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

// ========== ALERT OWNER – INITIAL FLAG ==========
async function alertOwner(client, member, sightResult, nsfwCheckersResult) {
    const owner = await client.users.fetch(ids.users.Velutinx).catch(() => null);
    if (!owner) return;

    const sightNudity = sightResult.nudity?.raw || 0;
    const nsfwCheckersScore = nsfwCheckersResult?.score ?? 'N/A';
    const nsfwCheckersVerdict = nsfwCheckersResult?.nsfw ?? 'N/A';

    const embed = new EmbedBuilder()
        .setTitle('⚠️ NSFW Avatar Detected')
        .setColor(0xFF0000)
        .setThumbnail(member.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            { name: 'User', value: `${member.user.tag} (${member.id})` },
            { name: 'Avatar URL', value: member.displayAvatarURL({ dynamic: true, size: 1024 }) },
            { name: 'Sightengine', value: `${sightNudity.toFixed(2)} (sexual: ${(sightResult.nudity?.sexual_activity || 0).toFixed(2)})` },
            { name: 'NSFWCheckers', value: `${nsfwCheckersVerdict} (score: ${typeof nsfwCheckersScore === 'number' ? nsfwCheckersScore.toFixed(2) : nsfwCheckersScore})` },
            { name: 'Scan Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`warn_avatar_${member.id}`)
            .setLabel('⚠️ Warn User')
            .setStyle(ButtonStyle.Danger)
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

// ========== PROCESS MEMBER ==========
async function processMember(client, member) {
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
            sightNudity >= NUDITY_THRESHOLD ||
            (nsfwCheckersScore !== null && nsfwCheckersScore >= NUDITY_THRESHOLD);

        if (flagged) {
            if (isTestAccount) console.log('[AvatarScan] Test account forced flag.');
            console.log(`[AvatarScan] NSFW detected: ${member.user.tag}`);
            await alertOwner(client, member, sightResult, nsfwCheckersResult || { score: null, nsfw: null });
        }
    } catch (err) {
        console.error(`[AvatarScan] Error scanning ${member.user.tag}:`, err.message);
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

// ========== BUTTON: WARN USER (initial flag) ==========
async function handleWarnButton(interaction) {
    const targetUserId = interaction.customId.replace('warn_avatar_', '');
    const guild = interaction.client.guilds.cache.first();
    if (!guild) return interaction.reply({ content: 'Guild not found.', flags: MessageFlags.Ephemeral });

    const member = await guild.members.fetch(targetUserId).catch(() => null);
    if (!member) return interaction.reply({ content: 'User not found in server.', flags: MessageFlags.Ephemeral });

    const dmSuccess = await sendWarningToUser(interaction.client, targetUserId);

    let roleSuccess = false;
    const muteRole = ids.roles.avatar_muted;
    if (muteRole && !member.roles.cache.has(muteRole)) {
        await member.roles.add(muteRole);
        roleSuccess = true;
    }

    const avatarHash = getAvatarHash(member);
    await dbAddFlaggedUser(targetUserId, avatarHash);

    await applyDenyOverwrites(guild, member);

    let replyMsg = '';
    replyMsg += dmSuccess ? `✅ Warning sent to <@${targetUserId}>.` : `❌ Failed to DM <@${targetUserId}>.`;
    replyMsg += roleSuccess ? ` Role \`🗣\` assigned.` : ` Could not assign role.`;
    replyMsg += ` Channel overwrites applied. User stored.`;

    await interaction.reply({ content: replyMsg, flags: MessageFlags.Ephemeral });
}

// ========== BUTTON: ACCEPT ==========
async function handleAcceptButton(interaction) {
    const targetUserId = interaction.customId.replace('accept_avatar_', '');
    const guild = interaction.client.guilds.cache.first();
    if (!guild) return interaction.reply({ content: 'Guild not found.', flags: MessageFlags.Ephemeral });

    const member = await guild.members.fetch(targetUserId).catch(() => null);
    if (!member) return interaction.reply({ content: 'User not in server.', flags: MessageFlags.Ephemeral });

    await sendWarningToUser(interaction.client, targetUserId,
        '✅ Your profile picture has been approved. You now have unrestricted access again. Thank you!'
    );

    const muteRole = ids.roles.avatar_muted;
    if (muteRole && member.roles.cache.has(muteRole)) {
        await member.roles.remove(muteRole);
    }

    await removeDenyOverwrites(guild, member);
    await dbRemoveFlaggedUser(targetUserId);

    await interaction.reply({
        content: `✅ <@${targetUserId}> has been accepted. Their restrictions are lifted.`,
        flags: MessageFlags.Ephemeral
    });
}

// ========== BUTTON: DENY ==========
async function handleDenyButton(interaction) {
    const targetUserId = interaction.customId.replace('deny_avatar_', '');
    const guild = interaction.client.guilds.cache.first();
    if (!guild) return interaction.reply({ content: 'Guild not found.', flags: MessageFlags.Ephemeral });

    const member = await guild.members.fetch(targetUserId).catch(() => null);
    if (!member) {
        await dbRemoveFlaggedUser(targetUserId);
        return interaction.reply({ content: 'User no longer in server.', flags: MessageFlags.Ephemeral });
    }

    await sendWarningToUser(interaction.client, targetUserId,
        '❌ Your new profile picture is still not acceptable. Please change it to a more appropriate one.'
    );

    const newHash = getAvatarHash(member);
    await dbAddFlaggedUser(targetUserId, newHash);

    await interaction.reply({
        content: `❌ <@${targetUserId}> has been informed. Awaiting a new avatar change.`,
        flags: MessageFlags.Ephemeral
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

// ========== EVENT LISTENERS ==========
function init(client) {
    // On‑join scanning disabled
    // client.on('guildMemberAdd', member => { processMember(client, member); });

    client.on('messageCreate', handleScanCommand);

    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isButton()) return;

        if (interaction.user.id !== ids.users.Velutinx) {
            return interaction.reply({ content: 'Only the server owner can use these buttons.', flags: MessageFlags.Ephemeral });
        }

        if (interaction.customId.startsWith('warn_avatar_')) {
            await handleWarnButton(interaction);
        } else if (interaction.customId.startsWith('accept_avatar_')) {
            await handleAcceptButton(interaction);
        } else if (interaction.customId.startsWith('deny_avatar_')) {
            await handleDenyButton(interaction);
        }
    });

    client.on(Events.UserUpdate, onUserUpdate);

    client.once(Events.ClientReady, () => {
        // Ready log disabled
    });
}

module.exports = { init };
