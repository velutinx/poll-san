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

    app.use(cors({
        origin: ['https://velutinx.com', 'https://d.velutinx.com'],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));

// 1. QUICK PROBE BLOCKER
    app.use((req, res, next) => {
        const url = req.url.toLowerCase();
        const probePatterns = [ // <--- The "=" was missing here
            /\.env/i, /\.git/i, /actuator/i, /swagger/i, /api-docs/i, /v[2-3]\/api/i,
            /php(info|myadmin|phpunit|adminer)/i, /\.ht(access|passwd)/i, /web\.config/i,
            /nginx\.conf/i, /docker-compose/i, /Dockerfile/i, /composer\.(json|lock)/i,
            /package\.json/i, /requirements\.txt/i, /backup|dump|db\.sql|database\.sql/i,
            /config\.(php|yml|yaml|json|xml)/i, /settings\.(json|yml)/i, /secrets|credentials/i,
            /robots\.txt/i, /sitemap\.xml/i, /crossdomain\.xml/i, /\.\.\//, /%3Cscript/i,
            /union\+select/i, /server-status|server-info|trace/i, /graphql/i,
            /wp-(admin|content|includes)/i, /\.bak|\.old|\.backup/i
        ];
        if (probePatterns.some(pattern => pattern.test(url))) {
            return res.status(404).send('Not Found');
        }
        next();
    });

    // 2. STATIC ASSETS & BODY PARSING
    app.use(express.json());
    // This serves everything in your public folder automatically
    app.use(express.static(path.join(__dirname, 'public')));
    
    // 3. REMOVED: Manual JS File Mocking
    // Since you have the real files in public/js/toast.js, 
    // Express.static above will serve them naturally. 
    // You don't need that long 'jsFiles' loop anymore.

    const upload = multer({ storage: multer.memoryStorage() });

    const FORUM_ID = '1465938599378812980';
    const SUPPORTER_FORUM_ID = '1465937644394512516';
    const SUPPORTER_ROLE_ID = '1466155709547675795';

    // ====================== MEMBER CACHE ======================
    let cachedMembers = null;
    let lastMemberFetch = 0;
    const MEMBER_CACHE_TTL = 5 * 60 * 1000;

    async function getGuildMembers(guild) {
        const now = Date.now();
        if (cachedMembers && (now - lastMemberFetch) < MEMBER_CACHE_TTL) {
            return cachedMembers;
        }
        try {
            const members = await guild.members.fetch({ withPresences: false });
            cachedMembers = members;
            lastMemberFetch = now;
            return members;
        } catch (err) {
            console.error('Failed to fetch members:', err);
            if (cachedMembers) return cachedMembers;
            throw err;
        }
    }

    // ────────────────────────────────────────────────
    // API ROUTES
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

    app.get('/poll-san', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // ====================== EXTERNAL ROUTES ======================
    // FIXED PATHS: Since server.js is in /web, routes are in ./routes/
    const setupQueueRoutes = require('./routes/queue');
    const setupPollRoutes = require('./routes/poll');
    const setupMembershipsRoute = require('./routes/memberships');
    const setupSendMessageRoute = require('./routes/sendMessage');
    const setupReleasesRoutes = require('./routes/releases');
    const setupMonitoringRoutes = require('./routes/monitoring'); // Fixed path

    setupQueueRoutes(app, client, queueService);
    setupPollRoutes(app, client, supabase, supabaseRetry);
    setupMembershipsRoute(app, client, supabase, supabaseRetry);
    setupSendMessageRoute(app, client, supabase, supabaseRetry);
    setupReleasesRoutes(app, client, upload, FORUM_ID, SUPPORTER_FORUM_ID);
    setupMonitoringRoutes(app, client, supabase, supabaseRetry, getGuildMembers);

    app.listen(PORT, () => {
        console.log(`🌐 Dashboard running at http://localhost:${PORT}/poll-san`);
    });
};
