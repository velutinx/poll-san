const express = require('express');
const path = require('path');
const { ChannelType } = require('discord.js');
const multer = require('multer');
const cors = require('cors');
const supabase = require('../services/supabase');
const { supabaseRetry } = require('../utils/db');
const queueService = require('../services/queueService');

module.exports = (client) => {
    const app = express();
    const PORT = process.env.PORT || 8080;

    // CORS
    app.use(cors({
        origin: ['https://velutinx.com', 'https://d.velutinx.com', 'http://localhost:8080'],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // Quick probe blocker (keep as before)
    app.use((req, res, next) => {
        const url = req.url.toLowerCase();
        const probePatterns = [
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

    // Serve static files from 'public' folder (this will serve /js/*.js, /css/*.css, etc.)
    app.use(express.static(path.join(__dirname, 'public')));

    // Body parser
    app.use(express.json());

    const upload = multer({ storage: multer.memoryStorage() });
    const FORUM_ID = '1465938599378812980';
    const SUPPORTER_FORUM_ID = '1465937644394512516';

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

    // Load external route files (including monitoring)
    const setupDashboardRoutes = require('./routes/dashboard');
    const setupQueueRoutes = require('./routes/queue');
    const setupPollRoutes = require('./routes/poll');
    const setupMembershipsRoute = require('./routes/memberships');
    const setupSendMessageRoute = require('./routes/sendMessage');
    const setupReleasesRoutes = require('./routes/releases');
    const setupMonitoringRoutes = require('./routes/monitoring');

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
