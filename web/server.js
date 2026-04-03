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

    // 1. QUICK PROBE BLOCKER - full patterns
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
            /\.\.\//,
            /%3Cscript/i,
            /union\+select/i,
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
    app.use('/assets', express.static('public/assets', { maxAge: '1d', etag: true }));
    app.use('/static', express.static('public/static', { maxAge: '1d', etag: true }));

    // 3. EXPLICIT ROUTES FOR JS FILES (fix MIME type errors)
    const jsFiles = ['greetings', 'toast', 'queue', 'poll', 'releases', 'uploading', 'megalink'];
    jsFiles.forEach(file => {
        app.get(`/js/${file}.js`, (req, res) => {
            res.setHeader('Content-Type', 'application/javascript');
            const filePath = path.join(__dirname, 'public', 'js', `${file}.js`);
            res.sendFile(filePath, err => {
                if (err) {
                    console.error(`Failed to serve /js/${file}.js:`, err);
                    res.status(404).send(`// ${file}.js not found`);
                }
            });
        });
    });

    // 4. SILENCE LOG SPAM FOR STATIC FILES
    app.use((req, res, next) => {
        const url = req.url.toLowerCase();
        const staticPatterns = [
            /^\/assets\//,
            /^\/static\//,
            /^\/js\//,
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

    // 5. Body parsers
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    // Multer setup
    const upload = multer({ storage: multer.memoryStorage() });

    // Crypto polyfill
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
    const SUPPORTER_ROLE_ID = '1466155709547675795';

    // ====================== MEMBER CACHE ======================
    let cachedMembers = null;
    let lastMemberFetch = 0;
    const MEMBER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

    // ────────────────────────────────────────────────
    // MONITORING ROUTES
    // ────────────────────────────────────────────────
    function parseCharacterList(pollList) {
        const lines = pollList.split(/\r?\n/).filter(line => line.trim().length > 0);
        return lines.map(line => line.trim().replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️'));
    }

    app.get('/api/monitoring/members', async (req, res) => {
        try {
            const days = parseInt(req.query.days) || 10;
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const members = await getGuildMembers(guild);
            const now = Date.now();

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

            const { data: votes, error: voteError } = await supabaseRetry(() =>
                supabase.from('votes_discord')
                    .select('user_id, option_id')
                    .eq('poll_id', 'character_poll_new')
            );
            if (voteError) console.error('Error fetching votes:', voteError);

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

            const membersList = [];
            for (const [id, member] of members) {
                if (member.roles.cache.has(SUPPORTER_ROLE_ID)) continue;

                const joinedAt = member.joinedTimestamp;
                const accountCreatedAt = member.user.createdTimestamp;
                const daysSinceJoin = joinedAt ? Math.floor((now - joinedAt) / (24 * 60 * 60 * 1000)) : null;
                const accountAge = accountCreatedAt ? Math.floor((now - accountCreatedAt) / (24 * 60 * 60 * 1000)) : null;

                const isNew = (accountAge !== null && accountAge <= days) || (daysSinceJoin !== null && daysSinceJoin <= days);
                if (!isNew) continue;

                const vote = voteMap[id] || null;
                membersList.push({
                    userId: id,
                    username: member.user.username,
                    nickname: member.nickname || member.user.username,
                    accountCreatedAt: accountCreatedAt ? new Date(accountCreatedAt).toISOString() : null,
                    accountAge: accountAge,
                    joinedAt: joinedAt ? new Date(joinedAt).toISOString() : null,
                    daysSinceJoin: daysSinceJoin,
                    voted: !!vote,
                    voteCharacter: vote ? vote.characterName : null,
                    voteOptionId: vote ? vote.option_id : null
                });
            }

            membersList.sort((a,b) => {
                const aRecent = Math.min(a.accountAge ?? Infinity, a.daysSinceJoin ?? Infinity);
                const bRecent = Math.min(b.accountAge ?? Infinity, b.daysSinceJoin ?? Infinity);
                return aRecent - bRecent;
            });

            res.json(membersList);
        } catch (err) {
            console.error('Monitoring fetch error:', err);
            res.status(500).json({ error: 'Failed to fetch members: ' + err.message });
        }
    });

    app.post('/api/monitoring/kick', async (req, res) => {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        let deletedVotes = 0;
        try {
            const { error: deleteError, count } = await supabaseRetry(() =>
                supabase.from('votes_discord')
                    .delete({ count: 'exact' })
                    .eq('user_id', userId)
                    .eq('poll_id', 'character_poll_new')
            );
            if (!deleteError) deletedVotes = count || 0;
        } catch (err) { console.error(err); }

        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch(userId);
            if (!member) return res.status(404).json({ error: 'Member not found' });
            await member.kick('Flagged as suspicious new account – poll votes removed');
            res.json({ success: true, message: `Kicked ${member.user.tag} and removed ${deletedVotes} poll vote(s)` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Start server
    app.listen(PORT, () => {
        console.log(`🌐 Dashboard running at http://localhost:${PORT}/poll-san`);
    });
};
