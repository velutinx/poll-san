// web/routes/reminder.js
const express = require('express');
const router = express.Router();
const helpers = require('../../utils/helpers');

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

    try {
        await member.send(`🌟 **Your daily check-in is now available!**\nClick the button in <#${helpers.ids.channels.checkin}> to claim your **${helpers.CHECKIN_REWARD_TICKETS} tickets** and reset your game cooldowns.`);
        console.log(`Sent check-in reminder to ${member.user.tag}`);
        
        // Update reminder_sent to true so we don't send again
        const supabase = require('../../services/supabase');
        await supabase
            .from('games_user_data')
            .update({ reminder_sent: true })
            .eq('user_id', user_id);
        
        res.json({ success: true });
    } catch (dmErr) {
        console.error(`Failed to DM ${user_id}:`, dmErr.message);
        res.status(500).json({ error: 'Failed to send DM' });
    }
});

module.exports = router;
