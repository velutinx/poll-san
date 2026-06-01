// web/routes/greetings.js

const express = require('express');
const router = express.Router();
const db = require('../../services/database');
const h = require('../../utils/helpers');

// GET settings for the guild
router.get('/api/get-settings', async (req, res) => {
    try {
        const row = await db.query(
            `SELECT welcome_channel_id, welcome_message
             FROM ${h.tables.SERVER_SETTINGS}
             WHERE guild_id = ?`,
            [process.env.GUILD_ID],
            true   // single row
        );

        res.json(row || { welcome_channel_id: '', welcome_message: '' });
    } catch (err) {
        console.error('GET /api/get-settings error:', err);
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

// POST save settings
router.post('/api/save-settings', async (req, res) => {
    const { welcome_channel_id, welcome_message } = req.body;
    try {
        await db.query(
            `INSERT INTO ${h.tables.SERVER_SETTINGS} (guild_id, welcome_channel_id, welcome_message)
             VALUES (?, ?, ?)
             ON CONFLICT(guild_id) DO UPDATE SET
               welcome_channel_id = excluded.welcome_channel_id,
               welcome_message = excluded.welcome_message`,
            [process.env.GUILD_ID, welcome_channel_id, welcome_message]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('POST /api/save-settings error:', err);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

module.exports = router;
