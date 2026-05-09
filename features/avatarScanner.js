// features/avatarScanner.js
const { EmbedBuilder } = require('discord.js');
const { ids, sightengine } = require('../utils/helpers');

const SCAN_DELAY_MS = 1500;

// ========== SIGHTENGINE SCAN ==========
async function scanImage(url) {
    const formData = new URLSearchParams();
    formData.append('url', url);
+ formData.append('models', 'nudity-2.1,offensive');
    formData.append('api_user', sightengine.apiUser);
    formData.append('api_secret', sightengine.apiSecret);

    const res = await fetch('https://api.sightengine.com/1.0/check.json', {
        method: 'POST',
        body: formData,
    });
    return res.json();
}

// ========== ALERT OWNER ==========
async function alertOwner(client, member, result) {
    const owner = await client.users.fetch(ids.users.Velutinx).catch(() => null);
    if (!owner) return;

    const embed = new EmbedBuilder()
        .setTitle('⚠️ NSFW Avatar Detected')
        .setColor(0xFF0000)
        .setThumbnail(member.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            { name: 'User', value: `${member.user.tag} (${member.id})` },
            { name: 'Avatar URL', value: member.displayAvatarURL({ dynamic: true, size: 1024 }) },
            { name: 'Nudity Score', value: `${(result.nudity?.raw || 0).toFixed(2)} (sexual: ${(result.nudity?.sexual_activity || result.nudity?.sexual_display || 0).toFixed(2)})` },
            { name: 'Weapon Score', value: `${(result.weapon || 0).toFixed(2)}` },
            { name: 'Offensive Score', value: `${(result.offensive?.prob || 0).toFixed(2)}` },
            { name: 'Scan Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
        );

    owner.send({ embeds: [embed] }).catch(() => {});
}

// ========== PROCESS MEMBER ==========
async function processMember(client, member) {
    if (member.user.bot) return;
    const avatarUrl = member.displayAvatarURL({ dynamic: true, size: 1024 });
    if (!avatarUrl || avatarUrl.includes('discord.com/assets/')) return;

    try {
        const result = await scanImage(avatarUrl);
        const nudityProb = result.nudity?.raw || 0;
        const weaponProb = result.weapon || 0;
        const offensiveProb = result.offensive?.prob || 0;

        console.log(`[AvatarScan] ${member.user.tag}: nudity=${nudityProb.toFixed(2)}, weapon=${weaponProb.toFixed(2)}, offensive=${offensiveProb.toFixed(2)}`);

if (nudityProb > 0.3 || offensiveProb > 0.3) {
    console.log(`[AvatarScan] NSFW detected: ${member.user.tag}`);
            await alertOwner(client, member, result);
        }
    } catch (err) {
        console.error(`[AvatarScan] Error scanning ${member.user.tag}:`, err.message);
    }
}

// ========== MANUAL OWNER SCAN COMMAND ==========
async function handleScanCommand(message) {
    if (message.author.id !== ids.users.Velutinx) return;
    if (!message.content.startsWith('!scan')) return;

    const target = message.mentions.members.first() || message.member;
    if (!target) return message.reply('Mention a user to scan.');

    const reply = await message.reply(`🔍 Scanning avatar of ${target.user.tag}...`);
    await processMember(message.client, target);
    reply.edit(`✅ Scan complete for ${target.user.tag}. Check your DM if flagged.`).catch(() => {});
}

// ========== STARTUP SCAN (commented out to avoid rate limits) ==========
async function scanAllMembers(client) {
    // ❗ Disabled for now – fetches all members and can cause rate limits.
    // Use !scan @user to test specific users.
    /*
    const guild = client.guilds.cache.first();
    if (!guild) return;

    console.log(`[AvatarScan] Scanning all members in ${guild.name}...`);
    const members = await guild.members.fetch({ force: true });
    const memberArray = [...members.values()];

    let i = 0;
    for (const member of memberArray) {
        await processMember(client, member);
        i++;
        if (i < memberArray.length) {
            await new Promise(resolve => setTimeout(resolve, SCAN_DELAY_MS));
        }
    }
    console.log(`[AvatarScan] Full scan complete. Processed ${i} members.`);
    */
}

// ========== EVENT LISTENERS ==========
function init(client) {
    client.on('guildMemberAdd', member => {
        processMember(client, member);
    });

    client.on('messageCreate', handleScanCommand);

    client.once('ready', () => {
        console.log('[AvatarScan] Ready – on‑join scanning active.');
        // scanAllMembers(client);  // disabled for now
    });
}

module.exports = { init };
