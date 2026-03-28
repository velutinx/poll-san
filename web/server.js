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

    // 2. LOGGING MIDDLEWARE – log every request
    app.use((req, res, next) => {
        if (req.url !== '/api/poll-results-data') {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
        }
        next();
    });

    // 3. PARSERS
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    // 4. MULTER
    const upload = multer({ storage: multer.memoryStorage() });

    // Polyfill for crypto.getRandomValues
    if (typeof global.crypto === 'undefined') {
        global.crypto = require('crypto');
    }
    if (typeof global.crypto.getRandomValues === 'undefined') {
        global.crypto.getRandomValues = function(array) {
            return require('crypto').randomBytes(array.length);
        };
    }

    // ────────────────────────────────────────────────
    // CONFIG
    // ────────────────────────────────────────────────
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
    // 3. START POLL
    // ────────────────────────────────────────────────
    app.post('/api/trigger-poll', async (req, res) => {
        const { channel_id, days, character_list } = req.body;
        try {
            const channel = await client.channels.fetch(channel_id);
            const startPollLogic = require('../commands/startpoll.js');
            const mockInteraction = {
                channel,
                guild: channel.guild,
                member: channel.guild.members.me,
                user: client.user,
                isDashboard: true,
                options: {
                    getInteger: (name) => name === 'days' ? parseInt(days) : null,
                    getString: (name) => name === 'list' ? character_list : null,
                    get: (name) => {
                        if (name === 'days') return { value: parseInt(days) };
                        if (name === 'list') return { value: character_list };
                        return null;
                    }
                },
                deferReply: async () => {},
                editReply: async () => {},
                reply: async () => {},
                followUp: async () => {},
                guildId: process.env.GUILD_ID,
                isChatInputCommand: () => true,
                isCommand: () => true
            };
            // Clear final_votes before starting new poll
            await supabaseRetry(() =>
                supabase.from('final_votes').delete().neq('option_id', 0)
            );
            startPollLogic(mockInteraction);
            res.json({ success: true });
        } catch (err) {
            console.error('Trigger poll error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ────────────────────────────────────────────────
    // 4. DASHBOARD DATA
    // ────────────────────────────────────────────────
    let cachedPollResultsData = null;
    let cachedPollResultsTime = 0;
    const POLL_CACHE_TTL = 60000; // 1 minute

    app.get('/api/poll-results-data', async (req, res) => {
        try {
            // Return cached data if fresh
            if (cachedPollResultsData && (Date.now() - cachedPollResultsTime) < POLL_CACHE_TTL) {
                return res.json(cachedPollResultsData);
            }

            const { data } = await supabaseRetry(() =>
                supabase.from('final_votes')
                    .select('character_name, score, selected_at')
                    .order('option_id', { ascending: true })
            );
            cachedPollResultsData = data || [];
            cachedPollResultsTime = Date.now();
            res.json(cachedPollResultsData);
        } catch (e) {
            console.error('Poll results error:', e);
            // Fallback to cached data if available
            if (cachedPollResultsData) {
                res.json(cachedPollResultsData);
            } else {
                res.json([]);
            }
        }
    });

    // ────────────────────────────────────────────────
    // 5. STOP POLL
    // ────────────────────────────────────────────────
    app.post('/api/stop-poll', async (req, res) => {
        try {
            await supabaseRetry(() => supabase.from('auto_resume').delete().neq('id', 0));
            await supabaseRetry(() => supabase.from('final_votes').delete().neq('option_id', 0));
            const { error: err3 } = await supabaseRetry(() => supabase.from('votes_discord').delete());
            if (err3) console.warn('votes_discord delete warning:', err3.message);
            await supabaseRetry(() => supabase.from('website_voting').delete().neq('id', 0));
            res.json({ success: true });
        } catch (err) {
            console.error('Stop poll error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ────────────────────────────────────────────────
    // 6. MARK WINNER
    // ────────────────────────────────────────────────
    app.post('/api/mark-winner', async (req, res) => {
        const { winner_name } = req.body;
        try {
            const { data: poll } = await supabaseRetry(() =>
                supabase.from('auto_resume')
                    .select('*')
                    .order('id', { ascending: false })
                    .limit(1)
                    .single()
            );
            if (!poll) return res.status(404).json({ error: "No active poll." });

            await supabaseRetry(() =>
                supabase.from('final_votes')
                    .update({ selected_at: new Date().toISOString() })
                    .filter('character_name', 'ilike', `%${winner_name}%`)
            );

            const { data: voteData } = await supabaseRetry(() =>
                supabase.from('final_votes')
                    .select('character_name, score, selected_at')
                    .order('option_id', { ascending: true })
            );

            const channel = await client.channels.fetch(poll.channel_id);
            const pollMessage = await channel.messages.fetch(poll.message_id);
            const thread = pollMessage.thread;
            if (!thread) return res.status(404).json({ error: "Thread not found." });

            const emojisArr = [':one:', ':two:', ':three:', ':four:', ':five:', ':six:', ':seven:', ':eight:', ':nine:', ':keycap_ten:', '<:eleven:1472456579742961744>', '<:twelve:1472456610457718845>'];
            const characters = poll.poll_list
                .split(/(?=:female_sign:|:male_sign:|♀️|♂️|\n)/)
                .map(s => s.trim().replace(/:female_sign:/g, '♀️').replace(/:male_sign:/g, '♂️'))
                .filter(s => s.length > 1);

            let scoreboard = `:trophy: **${winner_name}** has been marked as a winner! :tada:\n\n`;
            characters.forEach((char, index) => {
                const emoji = emojisArr[index] || `[${index + 1}]`;
                const record = voteData.find(v => {
                    const cleanChar = char.replace(/♀️|♂️/g, '').trim().toLowerCase();
                    const cleanRecord = v.character_name.replace(/♀️|♂️/g, '').trim().toLowerCase();
                    return cleanChar === cleanRecord;
                });
                const score = record ? parseFloat(record.score).toFixed(1) : "0.0";
                const isWinner = record && record.selected_at !== null;
                const line = `${emoji} = ${score} -- ${char}`;
                scoreboard += isWinner ? `||${line}||\n` : `${line}\n`;
            });

            await thread.send(scoreboard);
            res.json({ success: true });
        } catch (err) {
            console.error('Mark winner error:', err);
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
const setupMembershipsRoute = require('./routes/memberships'); setupMembershipsRoute(app, client, supabase, supabaseRetry);
const setupSendMessageRoute = require('./routes/sendMessage'); setupSendMessageRoute(app, client, supabase, supabaseRetry);
const setupReleasesRoutes = require('./routes/releases'); setupReleasesRoutes(app, client, upload, FORUM_ID, SUPPORTER_FORUM_ID);
    
    app.listen(PORT, () => {
        console.log(`🌐 Dashboard running at http://localhost:${PORT}/poll-san`);
        // console.log(`🌐 Dashboard running at https://d.velutinx.com/poll-san`);
    });
};
