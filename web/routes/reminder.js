// web/routes/reminder.js
const express = require('express');
const router = express.Router();
const helpers = require('../../utils/helpers');
const h = require('../../utils/helpers');

router.post('/api/reminder', async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });

    const client = req.app.get('client');
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) return res.status(500).json({ error: 'Guild not found' });

    let member;
    try {
        member = await guild.members.fetch(user_id);
    } catch (err) {
        console.log(`User ${user_id} not found in guild, skipping reminder`);
        return res.status(404).json({ error: 'User not in guild' });
    }

    const checkinChannelId = helpers.ids.channels.checkin;
    const checkinChannel = guild.channels.cache.get(checkinChannelId);
    if (!checkinChannel) {
        console.error('Check‑in channel not found, cannot send reminder');
        return res.status(500).json({ error: 'Check‑in channel missing' });
    }

    try {
        const webhooks = await checkinChannel.fetchWebhooks();
        let reminderWebhook = webhooks.find(w => w.name === 'Check in Reminder');
        if (!reminderWebhook) {
            reminderWebhook = await checkinChannel.createWebhook({
                name: 'Check in Reminder',
                avatar: helpers.urls.LOGO_URL
            });
        }

        const notifyMsg = await reminderWebhook.send({
            content: `${h.releaseEmojis?.STAR || '🌟'} **Your daily check‑in is now available!**\n` +
                     `Head to <#${checkinChannelId}> to claim your **${helpers.CHECKIN_REWARD_TICKETS} tickets** and reset your game cooldowns.`,
            allowedMentions: { parse: [] },
            username: 'Check in Reminder',
            avatarURL: helpers.urls.LOGO_URL
        });

        // Delete after 5 seconds
        if (notifyMsg) {
            setTimeout(() => notifyMsg.delete().catch(() => {}), 15_000);
        }

        const supabase = require('../../services/supabase');
        await supabase
            .from(h.tables.GAMES_USER_DATA)
            .update({ reminder_sent: true })
            .eq('user_id', user_id);

        res.json({ success: true });
    } catch (err) {
        console.error(`Failed to send check‑in reminder for ${user_id}:`, err.message);
        res.status(500).json({ error: 'Failed to send reminder' });
    }
});

module.exports = router;
