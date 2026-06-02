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

module.exports = (client) => {
    const app = express();
    const PORT = process.env.PORT || 8080;

    // CORS (add the Cloudflare Worker origin)
    app.use(cors({
        origin: ['https://velutinx.com', 'https://d.velutinx.com', 'http://localhost:8080', 'https://i2-uploader.velutinx.workers.dev'],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // Quick probe blocker
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

    // ====================== MEGA LINK PROXY ENDPOINT ======================
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

    // ====================== CONFIG ENDPOINT (frontend IDs) ======================
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

    // Verification webhook route
    app.use(verifyRouter);
    app.set('client', client);

    const upload = multer({ storage: multer.memoryStorage() });
    const FORUM_ID = helpers.ids.channels.preview_forum || '1465938599378812980';
    const SUPPORTER_FORUM_ID = helpers.ids.channels.supporter_forum || '1465937644394512516';

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
        pollClients.forEach(c => {
            try {
                c.write(`data: ${data}\n\n`);
            } catch (e) {
                pollClients.delete(c);
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

    // ====================== STATIC DASHBOARD PAGE ======================
    app.get('/poll-san', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // ====================== EXTERNAL ROUTES ======================
    const setupPollRoutes = require('./routes/poll');
    const setupMembershipsRoute = require('./routes/memberships');
    const setupSendMessageRoute = require('./routes/sendMessage');
    const setupReleasesRoutes = require('./routes/releases');
    const setupMonitoringRoutes = require('./routes/monitoring');
    const setupGiveawayRoutes = require('./routes/giveaway');
    const reminderRouter = require('./routes/reminder');

    app.use(reminderRouter);
    app.use(greetingsRouter);

    setupGiveawayRoutes(app, client, getGuildMembers);
    setupQueueRoutes(app, client, queueService);
    setupPollRoutes(app, client);
    setupMembershipsRoute(app, client);
    setupSendMessageRoute(app, client);
    setupReleasesRoutes(app, client, upload, FORUM_ID, SUPPORTER_FORUM_ID);
    setupMonitoringRoutes(app, client, getGuildMembers);

    // Start server
    app.listen(PORT, () => {
        console.log(`🌐 Dashboard running at http://localhost:${PORT}/poll-san`);
    });
};
