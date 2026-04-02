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
        /php(info|myadmin|phpunit|adminer)/i,
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
        /wp-(admin|content|includes)/i,
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

    // ---------------------- MONITORING ROUTES (enhanced) ----------------------
    
    // Helper: parse character list from poll_list (same format as startpoll.js)
    function parseCharacterList(pollList) {
        const lines = pollList.split(/\r?\n/).filter(line => line.trim().length > 0);
        return lines.map(line => line.trim().replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️'));
    }

    // GET /api/monitoring/members?days=10
    app.get('/api/monitoring/members', async (req, res) => {
        try {
            const days = parseInt(req.query.days) || 10;
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            await guild.members.fetch(); // fetch all members
            const now = Date.now();
            const cutoff = now - (days * 24 * 60 * 60 * 1000);

            const suspicious = [];
            for (const [id, member] of guild.members.cache) {
                const joinedAt = member.joinedTimestamp;
                if (joinedAt && joinedAt > cutoff) {
                    suspicious.push({
                        userId: id,
                        username: member.user.username,
                        nickname: member.nickname || member.user.username,
                        joinedAt: new Date(joinedAt).toISOString(),
                        daysSince: Math.floor((now - joinedAt) / (24 * 60 * 60 * 1000))
                    });
                }
            }
            if (suspicious.length === 0) {
                return res.json([]);
            }

            // ---- Fetch active poll character list ----
            const { data: activePoll } = await supabaseRetry(() =>
                supabase.from('auto_resume')
                    .select('poll_list')
                    .order('id', { ascending: false })
                    .limit(1)
                    .single()
            );
            let characterList = [];
            if (activePoll && activePoll.poll_list) {
                characterList = parseCharacterList(activePoll.poll_list);
            }

            // ---- Fetch votes for these users ----
            const userIds = suspicious.map(u => u.userId);
            const { data: votes, error: voteError } = await supabaseRetry(() =>
                supabase.from('votes_discord')
                    .select('user_id, option_id')
                    .eq('poll_id', 'character_poll_new')
                    .in('user_id', userIds)
            );
            if (voteError) console.error('Error fetching votes:', voteError);

            // Build map: userId -> { option_id, characterName }
            const voteMap = {};
            if (votes) {
                for (const v of votes) {
                    const optId = v.option_id;
                    let characterName = null;
                    if (characterList.length >= optId && optId >= 1) {
                        characterName = characterList[optId - 1];
                    }
                    voteMap[v.user_id] = { option_id: optId, characterName };
                }
            }

            // Attach vote info to each suspicious member
            const result = suspicious.map(m => ({
                ...m,
                voted: voteMap[m.userId] ? true : false,
                voteCharacter: voteMap[m.userId] ? voteMap[m.userId].characterName : null,
                voteOptionId: voteMap[m.userId] ? voteMap[m.userId].option_id : null
            }));

            res.json(result);
        } catch (err) {
            console.error('Monitoring fetch error:', err);
            res.status(500).json({ error: 'Failed to fetch members' });
        }
    });

    // POST /api/monitoring/kick (unchanged – already deletes votes)
    app.post('/api/monitoring/kick', async (req, res) => {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        let deletedVotes = 0;
        let kickError = null;

        try {
            const { error: deleteError, count } = await supabaseRetry(() =>
                supabase.from('votes_discord')
                    .delete({ count: 'exact' })
                    .eq('user_id', userId)
                    .eq('poll_id', 'character_poll_new')
            );
            if (deleteError) console.error(`Failed to delete votes for ${userId}:`, deleteError);
            else {
                deletedVotes = count || 0;
                console.log(`🗑️ Deleted ${deletedVotes} poll vote(s) for user ${userId}`);
            }
        } catch (err) { console.error(err); }

        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch(userId);
            if (!member) return res.status(404).json({ error: 'Member not found' });
            await member.kick('Flagged as suspicious new account – poll votes removed');
            res.json({ success: true, message: `Kicked ${member.user.tag} and removed ${deletedVotes} poll vote(s)` });
        } catch (err) {
            console.error('Kick error:', err);
            kickError = err.message;
            if (deletedVotes > 0) {
                res.status(500).json({ error: `Kick failed: ${kickError} (but ${deletedVotes} votes were removed)` });
            } else {
                res.status(500).json({ error: kickError });
            }
        }
    });

    // Start server
    app.listen(PORT, () => {
        console.log(`🌐 Dashboard running at http://localhost:${PORT}/poll-san`);
    });
};
