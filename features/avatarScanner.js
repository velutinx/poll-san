// features/avatarScanner.js
const {
    EmbedBuilder,
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { ids, sightengine } = require('../utils/helpers');

// ========== SIGHTENGINE SCAN ==========
async function scanImage(url) {
    const formData = new URLSearchParams();
    formData.append('url', url);
    formData.append('models', 'nudity-2.1'); // only nudity
    formData.append('api_user', sightengine.apiUser);
    formData.append('api_secret', sightengine.apiSecret);

    const res = await fetch('https://api.sightengine.com/1.0/check.json', {
        method: 'POST',
        body: formData,
    });
    return res.json();
}

// ========== WARNING MESSAGE TO FLAGGED USER ==========
async function sendWarningToUser(client, userId) {
    try {
        const user = await client.users.fetch(userId);
        await user.send(
            `⚠️ **Notice from Velutinx's server**\n\n` +
            `Your profile picture has been flagged as potentially inappropriate. ` +
            `Please change it to something more suitable to continue having unrestricted access to the server.\n\n` +
            `Your access to content channels remains unaffected, but communication may be limited until this is resolved.\n\n` +
            `If you have any questions, please message **velutinx**.`
        );
        return true;
    } catch (err) {
        console.error(`[AvatarScan] Could not DM user ${userId}:`, err.message);
        return false;
    }
}

// ========== ALERT OWNER (with button) ==========
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
            { name: 'Scan Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
        );

    // Button to warn the user
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

    try {
        const result = await scanImage(avatarUrl);
        const nudityProb = result.nudity?.raw || 0;

        console.log(`[AvatarScan] ${member.user.tag}: nudity=${nudityProb.toFixed(2)}`);

        // Flag if score > 0.5, OR if it's the test account
        const isTestAccount = member.id === '842917477977161739';
        if (nudityProb > 0.5 || isTestAccount) {
            if (isTestAccount) console.log('[AvatarScan] Test account forced flag.');
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

    // Extract the argument after !scan
    const input = message.content.slice('!scan'.length).trim();
    let target;

    // 1. If a mention is present, use it
    if (message.mentions.members.size > 0) {
        target = message.mentions.members.first();
    }
    // 2. If a raw ID (17-21 digits) is provided, try to fetch that guild member
    else if (input && /^\d{17,21}$/.test(input)) {
        try {
            target = await message.guild.members.fetch(input);
        } catch {
            return message.reply('❌ User not found in this server.');
        }
    }
    // 3. No argument – scan yourself
    else if (!input) {
        target = message.member;
    }
    // 4. Anything else is invalid
    else {
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

    // Only the owner can press the button
    if (interaction.user.id !== ids.users.Velutinx) {
        return interaction.reply({ content: 'Only the server owner can use this button.', ephemeral: true });
    }

    const targetUserId = interaction.customId.replace('warn_avatar_', '');
    const success = await sendWarningToUser(interaction.client, targetUserId);

    await interaction.reply({
        content: success
            ? `✅ Warning sent to <@${targetUserId}>.`
            : `❌ Failed to DM <@${targetUserId}>. They may have DMs disabled.`,
        ephemeral: true
    });
}

// ========== EVENT LISTENERS ==========
function init(client) {
    // On‑join scanning disabled
    // client.on('guildMemberAdd', member => { processMember(client, member); });

    client.on('messageCreate', handleScanCommand);
    client.on(Events.InteractionCreate, handleButton);

    client.once(Events.ClientReady, () => {
        console.log('[AvatarScan] Ready – manual scanning only (!scan @user).');
    });
}

module.exports = { init };
