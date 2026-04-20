// web/routes/verifyCallback.js

const express = require('express');
const router = express.Router();
const helpers = require('../utils/helpers');

// Helper: verify Turnstile token with Cloudflare
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

// Endpoint that the Worker will call
router.post('/api/verify', async (req, res) => {
    const { token, userId, guildId } = req.body;
    
    // Basic validation
    if (!token || !userId || !guildId) {
        return res.status(400).json({ success: false, error: 'Missing parameters' });
    }

    // Get the secret key from environment (never hardcode)
    const secretKey = process.env.TURNSTILE_SECRET_KEY;
    if (!secretKey) {
        console.error('TURNSTILE_SECRET_KEY not set in bot environment');
        return res.status(500).json({ success: false, error: 'Server configuration error' });
    }

    // Verify the token with Cloudflare
    const isValid = await verifyTurnstileToken(token, secretKey);
    if (!isValid) {
        return res.status(400).json({ success: false, error: 'Invalid CAPTCHA verification' });
    }

    // Now assign roles in Discord
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
        return res.status(404).json({ success: false, error: 'User not in server or not found' });
    }

    const supporterRoleId = helpers.ids.roles.supporter;
    const memberRoleId = helpers.ids.roles.member;
    const unverifiedRoleId = helpers.ids.roles.unverified;

    const hasSupporter = member.roles.cache.has(supporterRoleId);
    const unverifiedRole = guild.roles.cache.get(unverifiedRoleId);
    const memberRole = guild.roles.cache.get(memberRoleId);

    try {
        if (hasSupporter) {
            if (unverifiedRole) await member.roles.remove(unverifiedRole);
        } else {
            if (memberRole && unverifiedRole) {
                await member.roles.add(memberRole);
                await member.roles.remove(unverifiedRole);
            }
        }
        return res.json({ success: true, message: 'Verification successful' });
    } catch (err) {
        console.error('Role assignment error:', err);
        return res.status(500).json({ success: false, error: 'Failed to assign roles' });
    }
});

module.exports = router;
