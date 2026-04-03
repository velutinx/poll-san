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

    // 1. QUICK PROBE BLOCKER
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

    // 2. STATIC ASSETS SERVING
    app.use('/assets', express.static('public/assets', { maxAge: '1d', etag: true }));
    app.use('/static', express.static('public/static', { maxAge: '1d', etag: true }));

    // 3. EXPLICIT ROUTES FOR JS FILES with fallback content
    const jsFiles = {
        greetings: `// public/js/greetings.js – handles welcome channel and message settings
async function loadSettings() {
    try {
        const res = await fetch('/api/get-settings');
        if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
        const s = await res.json();
        if (s.welcome_channel_id) {
            const welcomeSelect = document.getElementById('welcome_channel_id');
            if (welcomeSelect) welcomeSelect.value = s.welcome_channel_id;
        }
        if (s.welcome_message) {
            const welcomeTextarea = document.getElementById('welcome_message');
            if (welcomeTextarea) welcomeTextarea.value = s.welcome_message;
        }
    } catch(e) {
        console.error('Error loading settings:', e);
        const statusDiv = document.getElementById('greetings-status');
        if (statusDiv) statusDiv.innerText = '❌ Error loading settings.';
    }
}
async function saveGreetings() {
    const channel = document.getElementById('welcome_channel_id').value;
    const message = document.getElementById('welcome_message').value;
    const res = await fetch('/api/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ welcome_channel_id: channel, welcome_message: message })
    });
    if (res.ok) {
        if (typeof showToast === 'function') showToast('Success!', 'Settings applied');
        await loadSettings();
    } else {
        if (typeof showToast === 'function') showToast('Error!', 'Failed to save', 'error');
    }
}
window.loadSettings = loadSettings;
window.saveGreetings = saveGreetings;`,
        toast: `// toast.js
(function() {
    const style = document.createElement('style');
    style.textContent = \`
        .toast-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        }
        .toast {
            background: #4caf50;
            color: white;
            border-radius: 6px;
            padding: 12px 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 250px;
            max-width: 350px;
            animation: slideInRight 0.3s ease, fadeOut 0.3s ease 2.7s forwards;
            pointer-events: auto;
            opacity: 0.95;
        }
        .toast.error { background: #f44336; }
        .toast .title { font-weight: 600; font-size: 1rem; }
        .toast .message { font-size: 0.9rem; opacity: 0.9; }
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
        }
    \`;
    document.head.appendChild(style);
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    window.showToast = function(title, message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = \`toast \${type}\`;
        toast.innerHTML = \`<div class="title">\${title}</div><div class="message">\${message}</div>\`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    };
})();`,
        queue: `// queue.js placeholder\nconsole.log("queue.js loaded");`,
        poll: `// poll.js placeholder\nconsole.log("poll.js loaded");`,
        releases: `// releases.js placeholder\nconsole.log("releases.js loaded");`,
        uploading: `// uploading.js placeholder\nconsole.log("uploading.js loaded");`,
        megalink: `// megalink.js placeholder\nconsole.log("megalink.js loaded");`
    };

    for (const [file, content] of Object.entries(jsFiles)) {
        app.get(`/js/${file}.js`, (req, res) => {
            res.setHeader('Content-Type', 'application/javascript');
            const filePath = path.join(__dirname, 'public', 'js', `${file}.js`);
            if (fs.existsSync(filePath)) {
                res.sendFile(filePath);
            } else {
                res.send(content);
            }
        });
    }

    // 4. SILENCE LOG SPAM FOR STATIC FILES
    app.use((req, res, next) => {
        const url = req.url.toLowerCase();
        const staticPatterns = [
            /^\/assets\//, /^\/static\//, /^\/js\//,
            /^\/bot-connect\.js$/, /^\/favicon\.ico$/,
            /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|map|json|webmanifest)$/i
        ];
        if (staticPatterns.some(pattern => pattern.test(url))) return next();
        next();
    });

    // 5. Body parsers
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    const upload = multer({ storage: multer.memoryStorage() });

    // Crypto polyfill
    if (typeof global.crypto === 'undefined') global.crypto = require('crypto');
    if (typeof global.crypto.getRandomValues === 'undefined') {
        global.crypto.getRandomValues = function(array) {
            return require('crypto').randomBytes(array.length);
        };
    }

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

    // External route files
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
    const setupMonitoringRoutes = require('./web/routes/monitoring');
    setupMembershipsRoute(app, client, supabase, supabaseRetry);
    setupMonitoringRoutes(app, client, supabase, supabaseRetry, getGuildMembers);

    app.listen(PORT, () => {
        console.log(`🌐 Dashboard running at http://localhost:${PORT}/poll-san`);
    });
};
