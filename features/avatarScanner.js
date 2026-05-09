// features/avatarScanner.js
const {
    EmbedBuilder,
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { ids, sightengine, google } = require('../utils/helpers');

// ========== CONFIG ==========
const NUDITY_THRESHOLD = 0.5;  // flag if any engine returns >= this

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

// ========== GOOGLE CLOUD VISION SCAN ==========
async function scanWithGoogle(url) {
    const body = {
        requests: [{
            image: { source: { imageUri: url } },
            features: [{ type: 'SAFE_SEARCH_DETECTION' }]
        }]
    };
    const res = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${google.visionApiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }
    );
    const data = await res.json();
    return data.responses[0];
}

// ========== NSFWCheckers (FREE FOREVER, no API key) ==========
async function scanWithNSFWCheckers(url) {
    // 1. Download the avatar image
    const imageRes = await fetch(url);
    if (!imageRes.ok) throw new Error(`Failed to download image: ${imageRes.status}`);
    const imageBuffer = await imageRes.arrayBuffer();

    // 2. Send to NSFWCheckers as multipart form-data
    const formData = new FormData();
    formData.append('image', new Blob([imageBuffer]), 'avatar.webp');

    const res = await fetch('https://api.nsfwcheckers.workers.dev', {
        method: 'POST',
        body: formData,
    });
    return res.json();
    // Response: { "nsfw": true/false, "score": 0.87, "daily_limit": 100, "used": 5, "remaining": 95 }
}

// ========== HELPER: Google likelihood → number ==========
function googleLikelihoodToScore(likelihood) {
    switch (likelihood) {
        case 'VERY_LIKELY':  return 0.9;
        case 'LIKELY':       return 0.7;
        case 'POSSIBLE':     return 0.5;
        case 'UNLIKELY':     return 0.2;
        case 'VERY_UNLIKELY':return 0.1;
        default:              return 0.0;
    }
}

// ========== WARNING MESSAGE ==========
async function sendWarningToUser(client, userId) {
    try {
        const user = await client.users.fetch(userId);
        await user.send(
            `⚠️ **Notice from Velutinx's server**\n\n` +
            `Your profile picture has been flagged as potentially inappropriate. ` +
            `Please change it to something more suitable to continue having unrestricted access to the server.\n\n` +
            `Your access to content channels remains unaffected, but communication may be limited until this is resolved.\n\n` +
            `If you have any questions, please message <@1380051214766444617>.`
        );
        return true;
    } catch (err) {
        console.error(`[AvatarScan] Could not DM user ${userId}:`, err.message);
        return false;
    }
}

// ========== ALERT OWNER (with button) ==========
async function alertOwner(client, member, results) {
    const owner = await client.users.fetch(ids.users.Velutinx).catch(() => null);
    if (!owner) return;

    const sightNudity = results.sightengine.nudity?.raw || 0;
    const googleLikelihood = results.google?.likelihood || 'UNKNOWN';
    const googleScore = results.google?.score || 0;
    const nsfwCheckersScore = results.nsfwcheckers?.score ?? 'N/A';
    const nsfwCheckersVerdict = results.nsfwcheckers?.nsfw ?? 'N/A';

    const embed = new EmbedBuilder()
        .setTitle('⚠️ NSFW Avatar Detected')
        .setColor(0xFF0000)
        .setThumbnail(member.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            { name: 'User', value: `${member.user.tag} (${member.id})` },
            { name: 'Avatar URL', value: member.displayAvatarURL({ dynamic: true, size: 1024 }) },
            { name: 'Sightengine', value: `${sightNudity.toFixed(2)} (sexual: ${(results.sightengine.nudity?.sexual_activity || 0).toFixed(2)})` },
            { name: 'Google Vision', value: `${googleLikelihood} (${googleScore.toFixed(2)})` },
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

// ========== PROCESS MEMBER ==========
async function processMember(client, member) {
    if (member.user.bot) return;
    const avatarUrl = member.displayAvatarURL({ dynamic: true, size: 1024 });
    if (!avatarUrl || avatarUrl.includes('discord.com/assets/')) return;

    const isTestAccount = member.id === '842917477977161739';

    try {
        // Fire all three APIs in parallel
        const [sightResult, googleResponse, nsfwCheckersResult] = await Promise.all([
            scanWithSightengine(avatarUrl),
            scanWithGoogle(avatarUrl).catch(() => null),
            scanWithNSFWCheckers(avatarUrl).catch(() => null)
        ]);

        const sightNudity = sightResult.nudity?.raw || 0;

        let googleScore = 0;
        let googleLikelihood = 'UNKNOWN';
        if (googleResponse?.safeSearchAnnotation) {
            const adult = googleResponse.safeSearchAnnotation.adult || 'UNKNOWN';
            googleLikelihood = adult;
            googleScore = googleLikelihoodToScore(adult);
        }

        const nsfwCheckersScore = nsfwCheckersResult?.score ?? null;

        console.log(
            `[AvatarScan] ${member.user.tag}: ` +
            `Sightengine=${sightNudity.toFixed(2)}, ` +
            `Google=${googleLikelihood} (${googleScore.toFixed(2)}), ` +
            `NSFWCheckers=${nsfwCheckersScore !== null ? nsfwCheckersScore.toFixed(2) : 'N/A'}`
        );

        const flagged =
            isTestAccount ||
            sightNudity >= NUDITY_THRESHOLD ||
            googleScore >= NUDITY_THRESHOLD ||
            (nsfwCheckersScore !== null && nsfwCheckersScore >= NUDITY_THRESHOLD);

        if (flagged) {
            if (isTestAccount) console.log('[AvatarScan] Test account forced flag.');
            console.log(`[AvatarScan] NSFW detected: ${member.user.tag}`);
            await alertOwner(client, member, {
                sightengine: sightResult,
                google: { likelihood: googleLikelihood, score: googleScore },
                nsfwcheckers: nsfwCheckersResult || { score: null, nsfw: null }
            });
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
    reply.edit(`✅ Scan complete for ${target.user.tag}. Check your DM if flagged.`).catch(() => {});
}

// ========== BUTTON INTERACTION HANDLER ==========
async function handleButton(interaction) {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('warn_avatar_')) return;

    if (interaction.user.id !== ids.users.Velutinx) {
        return interaction.reply({ content: 'Only the server owner can use this button.', ephemeral: true });
    }

    const targetUserId = interaction.customId.replace('warn_avatar_', '');

    const dmSuccess = await sendWarningToUser(interaction.client, targetUserId);

    let roleSuccess = false;
    const guild = interaction.client.guilds.cache.first();
    if (guild) {
        try {
            const member = await guild.members.fetch(targetUserId);
            const muteRole = ids.roles.avatar_muted;
            if (muteRole && !member.roles.cache.has(muteRole)) {
                await member.roles.add(muteRole);
                roleSuccess = true;
            }
        } catch (err) {
            console.error(`[AvatarScan] Failed to assign mute role to ${targetUserId}:`, err.message);
        }
    }

    let replyMsg = '';
    replyMsg += dmSuccess ? `✅ Warning sent to <@${targetUserId}>.` : `❌ Failed to DM <@${targetUserId}>.`;
    replyMsg += roleSuccess ? ` Role \`🗣\` assigned.` : ` Could not assign role (maybe missing).`;

    await interaction.reply({ content: replyMsg, ephemeral: true });
}

// ========== EVENT LISTENERS ==========
function init(client) {
    // On‑join scanning disabled (uncomment to re‑enable)
    // client.on('guildMemberAdd', member => { processMember(client, member); });

    client.on('messageCreate', handleScanCommand);
    client.on(Events.InteractionCreate, handleButton);

    client.once(Events.ClientReady, () => {
        console.log('[AvatarScan] Ready – triple‑engine scanning (Sightengine + Google Vision + NSFWCheckers).');
    });
}

module.exports = { init };
