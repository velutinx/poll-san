// web/routes/greetings.js

const express = require('express');
const router = express.Router();
const supabase = require('../../services/supabase');

// GET settings for the guild
router.get('/api/get-settings', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('server_settings')
            .select('welcome_channel_id, welcome_message')
            .eq('guild_id', process.env.GUILD_ID)
            .maybeSingle();

        if (error) throw error;
        res.json(data || { welcome_channel_id: '', welcome_message: '' });
    } catch (err) {
        console.error('GET /api/get-settings error:', err);
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

// POST save settings
router.post('/api/save-settings', async (req, res) => {
    const { welcome_channel_id, welcome_message } = req.body;
    try {
        const { error } = await supabase
            .from('server_settings')
            .upsert({
                guild_id: process.env.GUILD_ID,
                welcome_channel_id,
                welcome_message
            }, { onConflict: 'guild_id' });

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('POST /api/save-settings error:', err);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

module.exports = router;
