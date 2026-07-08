// web/server.js
const express = require('express');
const path = require('path');
const { ChannelType } = require('discord.js');
const multer = require('multer');
const cors = require('cors');
const greetingsRouter = require('./routes/greetings');
const helpers = require('../utils/helpers');
const { getMegaStorage } = require('../services/megaSession');
const verifyRouter = require('./routes/verifyCallback');
const API_TIMEOUT_MS = 60000;
const SERVER_TIMEOUT_MS = 120000;

module.exports = (client) => {
    const app = express();
    const PORT = process.env.PORT || 8080;

    // ---- CORS ----
    app.use(cors({
        origin: ['https://velutinx.com', 'https://d.velutinx.com', 'http://localhost:8080', 'https://i2-uploader.velutinx.workers.dev'],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // ---- Health Check ----
    app.get('/health', (req, res) => {
        res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // ---- Block Malicious Probes (optional) ----
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

    // ---- Body Parsing ----
    app.use(express.json());

    // ---- API Timeout Middleware ----
    app.use('/api', (req, res, next) => {
        if (req.path === '/poll/live') {
            return next();
        }
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            if (!res.headersSent) {
                res.status(408).json({ error: 'Request timeout' });
            }
            req.destroy();
        }, API_TIMEOUT_MS);

        res.on('finish', () => clearTimeout(timeout));
        res.on('close', () => clearTimeout(timeout));
        next();
    });

    // ---- Helper: Find file in MEGA storage ----
    function findFile(node, name) {
        if (!node.children) return null;
        for (const child of node.children) {
            if (child.directory) {
                const found = findFile(child, name);
                if (found) return found;
            } else if (child.name === name) {
                return child;
            }
        }
        return null;
    }

    // ---- MEGA Link API ----
    app.get('/api/mega-link', async (req, res) => {
        const filename = req.query.filename;
        if (!filename) return res.status(400).json({ error: 'Missing filename' });
        try {
            const storage = await getMegaStorage();
            const file = findFile(storage.root, filename);
            if (!file) return res.status(404).json({ error: 'File not found' });
            const link = await file.link();
            res.json({ url: link });
        } catch (err) {
            console.error('MEGA link error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ---- Config API ----
    app.get('/api/config', (req, res) => {
        res.json({
            forumIds: {
                preview: helpers.ids.channels.preview_forum,
                supporter: helpers.ids.channels.supporter_forum
            },
            tagIds: {
                preview_female: helpers.ids.tags.preview_female,
                preview_male: helpers.ids.tags.preview_male,
                supporter_female: helpers.ids.tags.supporter_female,
                supporter_male: helpers.ids.tags.supporter_male
            }
        });
    });

    // ---- Verification Callback (Turnstile) ----
    app.use(verifyRouter);
    app.set('client', client);

    // ---- Multer Setup for File Uploads ----
    const upload = multer({ storage: multer.memoryStorage() });
    const FORUM_ID = helpers.ids.channels.preview_forum || '1465938599378812980';
    const SUPPORTER_FORUM_ID = helpers.ids.channels.supporter_forum || '1465937644394512516';

    // ---- Guild Members Caching (for Monitoring) ----
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

    // ---- Poll Live (EventSource) ----
    const pollClients = new Set();
    function broadcastPollUpdate() {
        const data = JSON.stringify({ type: 'pollUpdate', timestamp: Date.now() });
        pollClients.forEach(c => {
            try { c.write(`data: ${data}\n\n`); } catch (e) { pollClients.delete(c); }
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

    // ---- Discord Channels API ----
    app.get('/api/channels', async (req, res) => {
        try {
            const guild = client.guilds.cache.get(process.env.GUILD_ID);
            if (!guild) return res.status(500).json({ error: 'Guild not found' });
            await guild.channels.fetch();
            const channels = guild.channels.cache
                .filter(ch => ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildForum)
                .map(ch => ({ id: ch.id, name: ch.name }));
            res.json(channels);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // =========================================================================
    //  ROUTING: MAIN WEBSITE vs DASHBOARD
    // =========================================================================

    // ---- 1. ROOT – MAIN WEBSITE ----
    // Serves the main website's index.html from the project root.
    // If you have your main site in a subfolder (e.g., "s"), adjust the path.
    app.get('/', (req, res) => {
        const mainIndexPath = path.join(__dirname, '..', 'index.html');
        res.sendFile(mainIndexPath, (err) => {
            if (err) {
                // If the file doesn't exist, return a clear error message.
                res.status(404).send(`
                    <h1>Main website not found</h1>
                    <p>Please ensure that <code>index.html</code> exists in the project root.</p>
                    <p>If your main site is in a subfolder (e.g., <code>s/</code>), update the path in <code>web/server.js</code>.</p>
                `);
            }
        });
    });

    // ---- 2. DASHBOARD (Admin Panel) ----
    // Serves the dashboard at /poll-san.
    app.get('/poll-san', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // ---- 3. STATIC FILES ----
    // Serve static assets for the dashboard (CSS, JS) from /web/public
    app.use('/poll-san', express.static(path.join(__dirname, 'public')));

    // Serve static files for the main website (CSS, JS, images) from the project root
    app.use(express.static(path.join(__dirname, '..')));

    // =========================================================================
    //  ALL OTHER API ROUTES
    // =========================================================================

    const setupPollRoutes = require('./routes/poll');
    const setupMembershipsRoute = require('./routes/memberships');
    const setupSendMessageRoute = require('./routes/sendMessage');
    const setupReleasesRoutes = require('./routes/releases');
    const setupMonitoringRoutes = require('./routes/monitoring');
    const setupGiveawayRoutes = require('./routes/giveaway');
    const setupQueueRoutes = require('./routes/queue');
    const reminderRouter = require('./routes/reminder');
    const setupTriviaRoutes = require('./routes/trivia');

    app.use(reminderRouter);
    app.use(greetingsRouter);

    setupGiveawayRoutes(app, client, getGuildMembers);
    setupPollRoutes(app, client);
    setupMembershipsRoute(app, client);
    setupSendMessageRoute(app, client);
    setupReleasesRoutes(app, client, upload, FORUM_ID, SUPPORTER_FORUM_ID);
    setupMonitoringRoutes(app, client, getGuildMembers);
    setupQueueRoutes(app, client);
    setupTriviaRoutes(app, client);

    // ---- Start Server ----
    const server = app.listen(PORT, () => {
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`   🌐 Main website: http://localhost:${PORT}/`);
        console.log(`   📊 Dashboard: http://localhost:${PORT}/poll-san`);
    });

    server.timeout = SERVER_TIMEOUT_MS;
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
};
