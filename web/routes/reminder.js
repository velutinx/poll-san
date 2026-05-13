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
        // User not in guild – just log and ignore
        console.log(`User ${user_id} not found in guild, skipping reminder`);
        return res.status(404).json({ error: 'User not in guild' });
    }

    // ---- Get the check‑in channel ----
    const checkinChannelId = helpers.ids.channels.checkin;
    const checkinChannel = guild.channels.cache.get(checkinChannelId);
    if (!checkinChannel) {
        console.error('Check‑in channel not found, cannot send reminder');
        return res.status(500).json({ error: 'Check‑in channel missing' });
    }

    try {
        // Send an ephemeral‑like mention
        const notifyMsg = await checkinChannel.send({
            content: `<@${member.user.id}> 🌟 **Your daily check‑in is now available!**\nClick the button in <#${checkinChannelId}> to claim your **${helpers.CHECKIN_REWARD_TICKETS} tickets** and reset your game cooldowns.`,
            allowedMentions: { users: [member.user.id] }
        });

        if (notifyMsg) {
            // Delete after 15 seconds so it disappears like an ephemeral message
            setTimeout(() => notifyMsg.delete().catch(() => {}), 15_000);
        }

        console.log(`Sent check‑in reminder (channel ping) to ${member.user.tag}`);

        // Mark as reminded so we don't send again
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
