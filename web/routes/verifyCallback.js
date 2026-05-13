// web/routes/verifyCallback.js

const express = require('express');
const router = express.Router();
const helpers = require('../../utils/helpers');

async function verifyTurnstileToken(token, secretKey) {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey);
    formData.append('response', token);
    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const data = await result.json();
    return data.success;
}

router.post('/api/verify', async (req, res) => {
    const { token, userId, guildId } = req.body;
    
    if (!token || !userId || !guildId) {
        return res.status(400).json({ success: false, error: 'Missing parameters' });
    }

    const secretKey = process.env.TURNSTILE_SECRET_KEY;
    if (!secretKey) {
        console.error('TURNSTILE_SECRET_KEY not set');
        return res.status(500).json({ success: false, error: 'Server configuration error' });
    }

    const isValid = await verifyTurnstileToken(token, secretKey);
    if (!isValid) {
        return res.status(400).json({ success: false, error: 'Invalid CAPTCHA verification' });
    }

    const client = req.app.get('client');
    if (!client) {
        return res.status(500).json({ success: false, error: 'Discord client not available' });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        return res.status(404).json({ success: false, error: 'Guild not found' });
    }

    let member;
    try {
        member = await guild.members.fetch(userId);
    } catch (err) {
        return res.status(404).json({ success: false, error: 'User not in server' });
    }

    const supporterRoleId = helpers.ids.roles.supporter;
    const memberRoleId = helpers.ids.roles.member;
    const unverifiedRoleId = helpers.ids.roles.unverified;

    // ----- Already verified? -----
    const hasSupporter = member.roles.cache.has(supporterRoleId);
    const hasMember = member.roles.cache.has(memberRoleId);
    const hasUnverified = member.roles.cache.has(unverifiedRoleId);

    // Supporter without Unverified = verified
    // Free user with Member role = verified
    const alreadyVerified = (hasSupporter && !hasUnverified) || hasMember;

    if (alreadyVerified) {
        return res.json({ success: true, message: 'Already verified', alreadyVerified: true });
    }
    // ----- End check -----

    const unverifiedRole = guild.roles.cache.get(unverifiedRoleId);
    const memberRole = guild.roles.cache.get(memberRoleId);

    try {
        if (hasSupporter) {
            // Supporter: just remove Unverified
            if (unverifiedRole) await member.roles.remove(unverifiedRole);
        } else {
            // Free user: remove Unverified, add Member
            if (memberRole && unverifiedRole) {
                try {
                    await member.roles.remove(unverifiedRole);
                    await member.roles.add(memberRole);
                } catch (err) {
                    console.error(`Role assignment failed for ${member.user.tag}:`, err);
                    // rollback
                    try {
                        if (!member.roles.cache.has(unverifiedRoleId)) {
                            await member.roles.add(unverifiedRole);
                        }
                    } catch (rollbackErr) {
                        console.error(`Rollback failed:`, rollbackErr);
                    }
                    return res.status(500).json({ success: false, error: 'Failed to assign roles' });
                }
            }
        }

        // Only send DM once, when we actually changed roles
        try {
            await member.send(`${helpers.releaseEmojis.VERIFY} You have successfully verified in **${guild.name}**! You now have access to the server.`);
        } catch (err) {
            console.log(`Could not send DM to ${member.user.tag}`);
        }

        return res.json({ success: true, message: 'Verification successful' });
    } catch (err) {
        console.error('Role assignment error:', err);
        return res.status(500).json({ success: false, error: 'Failed to assign roles' });
    }
});

module.exports = router;
