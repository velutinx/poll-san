// services/verifyHandler.js
const helpers = require('../utils/helpers');

const verifySessions = new Map();

async function handleVerifyStart(interaction) {
    const userId = interaction.user.id;
    const verifyKey = `${userId}-${interaction.channel.id}`;

    try {
        await interaction.deferUpdate();
    } catch {
        return;
    }

    const member = interaction.member;
    const hasSupporter = member.roles.cache.has(helpers.ids.roles.supporter);
    const hasMember = member.roles.cache.has(helpers.ids.roles.member);

    let finalContent = '';

    if (hasSupporter || hasMember) {
        finalContent = `${helpers.releaseEmojis?.getRandomVerify?.() || '✅'} You are already verified! No need to verify again.`;
    } else {
        const workerUrl = process.env.VERIFY_WORKER_URL;
        if (!workerUrl) {
            finalContent = `${helpers.releaseEmojis?.BATSU || '❌'} Verification service is not configured.`;
        } else {
            const uniqueUrl = `${workerUrl}?user=${interaction.user.id}&guild=${interaction.guild.id}`;
            finalContent = `${helpers.releaseEmojis?.LINK || '🔗'} **Your verification link** (expires after 10 minutes):\n${uniqueUrl}\n\nComplete the CAPTCHA in your browser to gain access.`;
        }
    }

    // Delete old ephemeral message if it exists
    const session = verifySessions.get(verifyKey);
    if (session && Date.now() - session.timestamp < 14 * 60 * 1000) {
        try {
            await session.interaction.webhook.deleteMessage(session.messageId);
        } catch {}
    }

    try {
        const sentMsg = await interaction.followUp({
            content: finalContent,
            ephemeral: true,
            fetchReply: true
        });
        verifySessions.set(verifyKey, {
            interaction,
            messageId: sentMsg.id,
            timestamp: Date.now()
        });
    } catch (err) {
        console.error('Failed to send followUp for verification:', err.message);
    }
}

module.exports = { handleVerifyStart };
