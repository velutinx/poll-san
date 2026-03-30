const express = require('express');
const path = require('path');
const { ChannelType } = require('discord.js');
const multer = require('multer');
const cors = require('cors');
const supabase = require('../services/supabase');
const { supabaseRetry } = require('../utils/db');
const queueService = require('../services/queueService');
const { Storage } = require('megajs');
const AdmZip = require('adm-zip');
const fs = require('fs');
const os = require('os');

module.exports = (client) => {
    const app = express();
    const PORT = process.env.PORT || 8080;

    // 1. CORS
    app.use(cors({
        origin: ['https://velutinx.com', 'https://d.velutinx.com'],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));

// ====================== MIDDLEWARE SETUP ======================

// 1. QUICK PROBE BLOCKER - Return 404 fast for common scanner paths
app.use((req, res, next) => {
    const url = req.url.toLowerCase();

    const probePatterns = [
        /\.env/i,
        /\.git/i,
        /actuator/i,
        /swagger/i,
        /api-docs/i,
        /v[2-3]\/api/i,
        /php(info|myadmin|unit|adminer)/i,
        /\.ht(access|passwd)/i,
        /web\.config/i,
        /nginx\.conf/i,
        /docker-compose/i,
        /Dockerfile/i,
        /composer\.(json|lock)/i,
        /package\.json/i,
        /requirements\.txt/i,
        /backup|dump|db\.sql|database\.sql/i,
        /config\.(php|yml|yaml|json|xml)/i,
        /settings\.(json|yml)/i,
        /secrets|credentials/i,
        /robots\.txt/i,
        /sitemap\.xml/i,
        /crossdomain\.xml/i,
        /\.\.\//,                    // path traversal
        /%3Cscript/i,                // XSS
        /union\+select/i,            // SQLi
        /server-status|server-info|trace/i,
        /graphql/i,
        /wp-(admin|content|includes)/i,   // Added common WordPress scans
        /\.bak|\.old|\.backup/i
    ];

    if (probePatterns.some(pattern => pattern.test(url))) {
        return res.status(404).send('Not Found');
    }
    next();
});

// 2. STATIC ASSETS SERVING
app.use('/assets', express.static('public/assets', { 
    maxAge: '1d',
    etag: true 
}));
app.use('/static', express.static('public/static', { 
    maxAge: '1d',
    etag: true 
}));

// 3. SILENCE LOG SPAM FOR STATIC FILES & COMMON ASSETS
app.use((req, res, next) => {
    const url = req.url.toLowerCase();

    const staticPatterns = [
        /^\/assets\//,
        /^\/static\//,
        /^\/bot-connect\.js$/,
        /^\/favicon\.ico$/,
        /^\/manifest\.json$/,
        /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|map|json|webmanifest)$/i
    ];

    if (staticPatterns.some(pattern => pattern.test(url))) {
        // Skip logging but continue to serve the file
        return next();
    }

    next();
});



    // 4. Body parsers
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    // Multer setup
    const upload = multer({ storage: multer.memoryStorage() });

    // Crypto polyfill (if needed)
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
    // API ROUTES
    // ────────────────────────────────────────────────

    // 1. CHANNEL LISTING
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

    // 2. SETTINGS
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
    // DASHBOARD ROUTE
    // ────────────────────────────────────────────────
    app.get('/poll-san', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // Load external route files
    const setupQueueRoutes = require('./routes/queue');
    setupQueueRoutes(app, client, queueService);

    const setupPollRoutes = require('./routes/poll');
    setupPollRoutes(app, client, supabase, supabaseRetry);

    const setupMembershipsRoute = require('./routes/memberships');
    setupMembershipsRoute(app, client, supabase, supabaseRetry);

    const setupSendMessageRoute = require('./routes/sendMessage');
    setupSendMessageRoute(app, client, supabase, supabaseRetry);

    const setupReleasesRoutes = require('./routes/releases');
    setupReleasesRoutes(app, client, upload, FORUM_ID, SUPPORTER_FORUM_ID);

    // Start server
    app.listen(PORT, () => {
        console.log(`🌐 Dashboard running at http://localhost:${PORT}/poll-san`);
        // console.log(`🌐 Dashboard running at https://d.velutinx.com/poll-san`);
    });
};
