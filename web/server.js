const express = require('express');
const path = require('path');
const { ChannelType } = require('discord.js');
const multer = require('multer');
const cors = require('cors');
const supabase = require('../services/supabase');
const { supabaseRetry } = require('../utils/db'); // <-- new
const queueService = require('../services/queueService');
const { Storage } = require('megajs');
const AdmZip = require('adm-zip');
const fs = require('fs');
const os = require('os');

module.exports = (client) => {
    const app = express();
    const PORT = process.env.PORT || 8080;

    // 1. CORS – allow both main domain and subdomain
    app.use(cors({
        origin: ['https://velutinx.com', 'https://d.velutinx.com'],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));

// 2. LOGGING MIDDLEWARE – log every request (clean version)
app.use((req, res, next) => {
    const url = req.url;
    // Skip dashboard UI, static files, and all API endpoints you don't care about
    if (
        url === '/' ||
        url.startsWith('/poll-san') ||
        url.startsWith('/js/') ||
        url.startsWith('/css/') ||
        url.startsWith('/api/') ||   // ← skips ALL /api/* at once
        url === '/favicon.ico'
    ) {
        return next();
    }

    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    const upload = multer({ storage: multer.memoryStorage() });

    if (typeof global.crypto === 'undefined') {
        global.crypto = require('crypto');
    }
    if (typeof global.crypto.getRandomValues === 'undefined') {
        global.crypto.getRandomValues = function(array) {
            return require('crypto').randomBytes(array.length);
        };
    }

    const FORUM_ID = '1465938599378812980';
    const SUPPORTER_FORUM_ID = '1465937644394512516';

    // ────────────────────────────────────────────────
    // 1. CHANNEL LISTING
    // ────────────────────────────────────────────────
    app.get('/api/channels', async (req, res) => {
        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const channels = await guild.channels.fetch();
            const channelData = channels
                .filter(c => c.type === ChannelType.GuildText)
                .map(c => ({
                    id: c.id,
                    name: c.name,
                    category: c.parent ? c.parent.name.toUpperCase() : 'TEXT CHANNELS'
                }))
                .sort((a, b) => a.category.localeCompare(b.category));
            res.json(channelData);
        } catch (err) {
            console.error('Channels endpoint error:', err);
            res.status(500).json({ error: "Could not fetch channels." });
        }
    });

    // ────────────────────────────────────────────────
    // 2. SETTINGS
    // ────────────────────────────────────────────────
    app.get('/api/get-settings', async (req, res) => {
        try {
            const { data } = await supabaseRetry(() =>
                supabase.from('server_settings')
                    .select('*')
                    .eq('guild_id', String(process.env.GUILD_ID))
                    .single()
            );
            res.json(data || {});
        } catch (e) {
            console.error('Get settings error:', e);
            res.json({});
        }
    });

    app.post('/api/save-settings', async (req, res) => {
        const { welcome_channel_id, welcome_message } = req.body;
        try {
            const { data: existing } = await supabaseRetry(() =>
                supabase.from('server_settings')
                    .select('guild_id')
                    .eq('guild_id', String(process.env.GUILD_ID))
                    .maybeSingle()
            );

            let error;
            if (existing) {
                ({ error } = await supabaseRetry(() =>
                    supabase.from('server_settings')
                        .update({ welcome_channel_id, welcome_message })
                        .eq('guild_id', String(process.env.GUILD_ID))
                ));
            } else {
                ({ error } = await supabaseRetry(() =>
                    supabase.from('server_settings')
                        .insert({
                            guild_id: String(process.env.GUILD_ID),
                            welcome_channel_id,
                            welcome_message
                        })
                ));
            }
            if (error) throw error;
            res.json({ success: true });
        } catch (err) {
            console.error('Save settings error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ────────────────────────────────────────────────
    // SERVE DASHBOARD
    // ────────────────────────────────────────────────
    app.get('/poll-san', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

const setupQueueRoutes = require('./routes/queue'); setupQueueRoutes(app, client, queueService);
const setupPollRoutes = require('./routes/poll'); setupPollRoutes(app, client, supabase, supabaseRetry);
const setupMembershipsRoute = require('./routes/memberships'); setupMembershipsRoute(app, client, supabase, supabaseRetry);
const setupSendMessageRoute = require('./routes/sendMessage'); setupSendMessageRoute(app, client, supabase, supabaseRetry);
const setupReleasesRoutes = require('./routes/releases'); setupReleasesRoutes(app, client, upload, FORUM_ID, SUPPORTER_FORUM_ID);
    
    app.listen(PORT, () => {
        console.log(`🌐 Dashboard running at http://localhost:${PORT}/poll-san`);
        // console.log(`🌐 Dashboard running at https://d.velutinx.com/poll-san`);
    });
};
