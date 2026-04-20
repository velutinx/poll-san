// web/server.js – corrected version

const express = require('express');
const path = require('path');
const { ChannelType } = require('discord.js');
const multer = require('multer');
const cors = require('cors');
const supabase = require('../services/supabase');
const { supabaseRetry } = require('../utils/db');
const queueService = require('../services/queueService');

// ✅ MOVE THE ROUTER REQUIREMENT HERE (before it's used)
const verifyRouter = require('./routes/verifyCallback');

module.exports = (client) => {
    const app = express();
    const PORT = process.env.PORT || 8080;

    // CORS
    app.use(cors({
        origin: ['https://velutinx.com', 'https://d.velutinx.com', 'http://localhost:8080'],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // Quick probe blocker (same as yours)
    app.use((req, res, next) => {
        const url = req.url.toLowerCase();
        const probePatterns = [
            /\.env/i, /\.git/i, /actuator/i, /swagger/i, /api-docs/i, /v[2-3]\/api/i,
            /php(info|myadmin|phpunit|adminer)/i, /\.ht(access|passwd)/i, /web\.config/i,
            /nginx\.conf/i, /docker-compose/i, /Dockerfile/i, /composer\.(json|lock)/i,
            /package\.json/i, /requirements\.(txt)/i, /backup|dump|db\.sql|database\.sql/i,
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

    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.json());

    // ✅ Now verifyRouter is defined, so this works
    app.use(verifyRouter);
    app.set('client', client);

    const upload = multer({ storage: multer.memoryStorage() });
    const FORUM_ID = '1465938599378812980';
    const SUPPORTER_FORUM_ID = '1465937644394512516';

    // ====================== MEMBER CACHE ======================
    let cachedMembers = null;
    let lastMemberFetch = 0;
    const MEMBER_CACHE_TTL = 15 * 60 * 1000;
    let memberFetchPromise = null;

    async function getGuildMembers(guild) {
        const now = Date.now();
        if (cachedMembers && (now - lastMemberFetch) < MEMBER_CACHE_TTL) return cachedMembers;
        if (memberFetchPromise) return memberFetchPromise;
        memberFetchPromise = (async () => {
            try {
                const members = await guild.members.fetch({ withPresences: false });
                cachedMembers = members;
                lastMemberFetch = Date.now();
                return members;
            } finally {
                memberFetchPromise = null;
            }
        })();
        return memberFetchPromise;
    }

    // ====================== LIVE POLL UPDATES (SSE) ======================
    const pollClients = new Set();
    function broadcastPollUpdate() {
        const data = JSON.stringify({ type: 'pollUpdate', timestamp: Date.now() });
        pollClients.forEach(client => {
            try {
                client.write(`data: ${data}\n\n`);
            } catch (e) {
                pollClients.delete(client);
            }
        });
    }
    global.refreshPollDashboard = broadcastPollUpdate;

    app.get('/api/poll/live', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        pollClients.add(res);
        res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);
        req.on('close', () => pollClients.delete(res));
    });

    // ====================== CHANNELS ROUTE ======================
    app.get('/api/channels', async (req, res) => {
        try {
            const guild = client.guilds.cache.get(process.env.GUILD_ID);
            if (!guild) return res.status(500).json({ error: 'Guild not found' });
            const channels = guild.channels.cache
                .filter(ch => ch.type === ChannelType.GuildText)
                .map(ch => ({ id: ch.id, name: ch.name }));
            res.json(channels);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ====================== GREETINGS SETTINGS (mock, replace with your DB) ======================
    app.get('/api/get-settings', async (req, res) => {
        res.json({ welcome_channel_id: '', welcome_message: '' });
    });
    app.post('/api/save-settings', async (req, res) => {
        res.json({ success: true });
    });

    // ====================== STATIC DASHBOARD PAGE ======================
    app.get('/poll-san', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // ====================== EXTERNAL ROUTES ======================
    const setupQueueRoutes = require('./routes/queue');
    const setupPollRoutes = require('./routes/poll');
    const setupMembershipsRoute = require('./routes/memberships');
    const setupSendMessageRoute = require('./routes/sendMessage');
    const setupReleasesRoutes = require('./routes/releases');
    const setupMonitoringRoutes = require('./routes/monitoring');
    const setupGiveawayRoutes = require('./routes/giveaway');
    // ❌ Remove the duplicate require for verifyRouter – it's already loaded at the top
    
    setupGiveawayRoutes(app, client, supabase, supabaseRetry, getGuildMembers);
    setupQueueRoutes(app, client, queueService);
    setupPollRoutes(app, client, supabase, supabaseRetry);
    setupMembershipsRoute(app, client, supabase, supabaseRetry);
    setupSendMessageRoute(app, client, supabase, supabaseRetry);
    setupReleasesRoutes(app, client, upload, FORUM_ID, SUPPORTER_FORUM_ID);
    setupMonitoringRoutes(app, client, supabase, supabaseRetry, getGuildMembers);

    // Start server
    app.listen(PORT, () => {
        console.log(`🌐 Dashboard running at http://localhost:${PORT}/poll-san`);
    });
};
