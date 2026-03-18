const express = require('express');
const path = require('path');
const { ChannelType } = require('discord.js');
const multer = require('multer');
const cors = require('cors'); 
const supabase = require('../services/supabase');
const queueService = require('../services/queueService');
const { Storage } = require('megajs');
const AdmZip = require('adm-zip');
const fs = require('fs');
const os = require('os');

module.exports = (client) => {
    const app = express();
    const PORT = process.env.PORT || 3000;

    // 1. CORS MUST BE THE VERY FIRST MIDDLEWARE
    app.use(cors({
        origin: 'https://velutinx.com',
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // 2. PARSERS (Only once!)
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    // 3. MULTER
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
    // NEW ENDPOINT: Capture Membership
    // ────────────────────────────────────────────────
app.post('/api/capture-membership-order', async (req, res) => {
    try {
        const { orderId, tier, discordId } = req.body;

        if (!orderId || !tier || !discordId) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        // Calculate dates
        const now = new Date();
        const expirationDate = new Date();
        expirationDate.setDate(now.getDate() + 30); // Sets expiration to 30 days from now

        const { data, error } = await supabase
            .from('memberships')
            .upsert({ 
                discord_id: discordId, 
                tier: parseInt(tier), 
                order_id: orderId,
                updated_at: now.toISOString(),
                expires_at: expirationDate.toISOString() // This is the key for the bot
            }, { onConflict: 'discord_id' });

        if (error) {
            console.error('Supabase Error:', error);
            return res.status(500).json({ error: "Database error", details: error.message });
        }

        // --- DISCORD ROLE ASSIGNMENT ---
        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch(discordId).catch(() => null);
            
            if (member) {
                const tierRoles = {
                    "1": "1465444240845963326",  // ✨ Bronze
                    "2": "1465670134743044139",  // ✨ Copper
					"3": "1465904476417163457",  // ✨ Silver
					"4": "1465904548320378956",  // ✨ Gold
					"5": "1465952085026541804"   // ✨ Platinum
                };

                const roleId = tierRoles[String(tier)];
                if (roleId) {
                    await member.roles.add(roleId);
                    console.log(`✅ Role added to ${member.user.tag}`);
                }
            }
        } catch (discordErr) {
            console.error('⚠️ Membership saved, but Discord role failed:', discordErr);
            // We don't return 500 here because the payment/DB part worked.
        }

        return res.json({ success: true });
    } catch (err) {
        console.error('Crash Error:', err);
        return res.status(500).json({ error: "Server Crash", message: err.message });
    }
});
    
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
            const { data } = await supabase
                .from('server_settings')
                .select('*')
                .eq('guild_id', String(process.env.GUILD_ID))
                .single();
            res.json(data || {});
        } catch (e) {
            console.error('Get settings error:', e);
            res.json({});
        }
    });

app.post('/api/save-settings', async (req, res) => {
    const { welcome_channel_id, welcome_message } = req.body;
    try {
        // First, check if a row exists for this guild
        const { data: existing } = await supabase
            .from('server_settings')
            .select('guild_id')
            .eq('guild_id', String(process.env.GUILD_ID))
            .maybeSingle();

        let error;
        if (existing) {
            // Update
            ({ error } = await supabase
                .from('server_settings')
                .update({ welcome_channel_id, welcome_message })
                .eq('guild_id', String(process.env.GUILD_ID)));
        } else {
            // Insert
            ({ error } = await supabase
                .from('server_settings')
                .insert({
                    guild_id: String(process.env.GUILD_ID),
                    welcome_channel_id,
                    welcome_message
                }));
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
            await supabase.from('final_votes').delete().neq('option_id', 0);
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
    app.get('/api/poll-results-data', async (req, res) => {
        try {
            const { data } = await supabase
                .from('final_votes')
                .select('character_name, score, selected_at')
                .order('option_id', { ascending: true });
            res.json(data || []);
        } catch (e) {
            console.error('Poll results error:', e);
            res.json([]);
        }
    });

    // ────────────────────────────────────────────────
    // 5. STOP POLL
    // ────────────────────────────────────────────────
    app.post('/api/stop-poll', async (req, res) => {
        try {
            // Delete from all poll-related tables
            await supabase.from('auto_resume').delete().neq('id', 0);
            await supabase.from('final_votes').delete().neq('option_id', 0);
            await supabase.from('votes_discord').delete().neq('id', 0); // Added
            // await supabase.from('website_voting').delete().neq('id', 0); // Commented out as requested

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
            const { data: poll } = await supabase
                .from('auto_resume')
                .select('*')
                .order('id', { ascending: false })
                .limit(1)
                .single();
            if (!poll) return res.status(404).json({ error: "No active poll." });

            await supabase
                .from('final_votes')
                .update({ selected_at: new Date().toISOString() })
                .filter('character_name', 'ilike', `%${winner_name}%`);

            const { data: voteData } = await supabase
                .from('final_votes')
                .select('character_name, score, selected_at')
                .order('option_id', { ascending: true });

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
    // 7. QUEUE ENDPOINTS
    // ────────────────────────────────────────────────
    app.get('/api/get-queue', async (req, res) => {
        try {
            const data = await queueService.getQueueData();
            if (data && typeof data.queue === 'string') data.queue = JSON.parse(data.queue);
            res.json(data || { queue: [] });
        } catch (err) {
            console.error('Get queue error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/queue-add', async (req, res) => {
        try {
            const { character } = req.body;
            const data = await queueService.getQueueData();
            let currentQueue = typeof data.queue === 'string' ? JSON.parse(data.queue) : data.queue;
            currentQueue.push(character);
            await queueService.updateQueueMessage(client, currentQueue, data.message_id);
            res.json({ success: true });
        } catch (err) {
            console.error('Queue add error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/queue-reorder', async (req, res) => {
        try {
            const { newQueue } = req.body;
            const { message_id } = await queueService.getQueueData();
            await queueService.updateQueueMessage(client, newQueue, message_id);
            res.json({ success: true });
        } catch (err) {
            console.error('Queue reorder error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/queue-remove-name', async (req, res) => {
        try {
            const { character } = req.body;
            const data = await queueService.getQueueData();
            let currentQueue = typeof data.queue === 'string' ? JSON.parse(data.queue) : data.queue;
            const filteredQueue = currentQueue.filter(name => name !== character);
            await queueService.updateQueueMessage(client, filteredQueue, data.message_id);
            res.json({ success: true });
        } catch (err) {
            console.error('Queue remove error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ────────────────────────────────────────────────
    // 8. RELEASE PREVIEW
    // ────────────────────────────────────────────────
    app.post('/api/release-preview', upload.array('images'), async (req, res) => {
        const { pack, setSize, input, series, suffix } = req.body;
        const files = req.files || [];
        try {
            const fullInput = input.trim();
            const spaceIndex = fullInput.indexOf(' ');
            let genderEmoji = "";
            let charName = fullInput;
            if (spaceIndex !== -1) {
                genderEmoji = fullInput.substring(0, spaceIndex);
                charName = fullInput.substring(spaceIndex + 1).trim();
            }
            const appliedTags = [];
            if (genderEmoji.includes('female_sign') || genderEmoji === '♀️') appliedTags.push('1465939310720192637');
            else if (genderEmoji.includes('male_sign') || genderEmoji === '♂️') appliedTags.push('1465939329120469095', '1467020233272328195');

            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const forumChannel = await guild.channels.fetch(FORUM_ID);

            const isSoon = setSize.toUpperCase() === 'XX';
            const suffixStr = suffix ? ` — ${suffix}` : '';
            const threadTitle = `[${series.toUpperCase()}] ${charName} — Pack #${pack}${suffixStr}`;
            const messageBody = `:new: NEW RELEASE${isSoon ? ' -- SOON' : ''}
━━━━━━━━━━━━━━
Character: ${charName}
Series: ${series}
Set size: ${setSize} images

:pushpin: SFW preview below

:arrow_right: Full version for supporters
:arrow_right: See <#${SUPPORTER_FORUM_ID}>`;

            const attachments = files.map(f => ({ attachment: f.buffer, name: f.originalname }));

            await forumChannel.threads.create({
                name: threadTitle,
                appliedTags: appliedTags,
                message: { content: messageBody, files: attachments }
            });

            res.json({ success: true });
        } catch (err) {
            console.error('Release preview error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ────────────────────────────────────────────────
    // 9. FORUM FETCHING
    // ────────────────────────────────────────────────
    app.get('/api/forum-posts', async (req, res) => {
        try {
            const channelId = req.query.channelId || FORUM_ID;
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const forumChannel = await guild.channels.fetch(channelId);
            if (!forumChannel.isThreadOnly()) {
                return res.status(400).json({ error: "Channel is not a forum" });
            }

            const threads = await forumChannel.threads.fetchActive();
            const postList = threads.threads.map(t => ({
                id: t.id,
                name: t.name,
                applied_tags: Array.isArray(t.appliedTags) ? t.appliedTags : []
            }));

            postList.sort((a, b) => {
                const aId = BigInt(a.id);
                const bId = BigInt(b.id);
                return aId > bId ? -1 : aId < bId ? 1 : 0;
            });

            res.json(postList);
        } catch (err) {
            console.error('Forum posts endpoint error:', err);
            res.status(500).json({ error: err.message || 'Failed to fetch forum threads' });
        }
    });

    // ────────────────────────────────────────────────
    // 10. EDIT FORUM POST
    // ────────────────────────────────────────────────
    app.post('/api/edit-post', async (req, res) => {
        const { threadId, pack, setSize, input, series, suffix } = req.body;
        try {
            const thread = await client.channels.fetch(threadId);
            if (!thread) return res.status(404).json({ error: "Thread not found" });

            const fullInput = input.trim();
            const spaceIndex = fullInput.indexOf(' ');
            let charName = spaceIndex !== -1 ? fullInput.substring(spaceIndex + 1).trim() : fullInput;

            const isSoon = setSize.toUpperCase() === 'XX';
            const suffixStr = suffix ? ` — ${suffix}` : '';
            const newTitle = `[${series.toUpperCase()}] ${charName} — Pack #${pack}${suffixStr}${isSoon ? ' — SOON' : ''}`;

            await thread.setName(newTitle);

            const firstMsg = await thread.fetchStarterMessage();
            if (firstMsg) {
                let newBody = firstMsg.content
                    .replace(/Character: .*/, `Character: ${charName}`)
                    .replace(/Series: .*/, `Series: ${series}`)
                    .replace(/Set size: .* images/, `Set size: ${setSize} images`);

                if (isSoon) {
                    if (!newBody.includes('-- SOON')) {
                        newBody = newBody.replace(/:new: NEW RELEASE/, ':new: NEW RELEASE -- SOON');
                    }
                } else {
                    newBody = newBody.replace(/ -- SOON/g, '');
                }

                await firstMsg.edit(newBody);
            }

            res.json({ success: true });
        } catch (err) {
            console.error('Edit post error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ────────────────────────────────────────────────
    // 11. GET POST CONTENT
    // ────────────────────────────────────────────────
    app.get('/api/get-post-content', async (req, res) => {
        const { id } = req.query;
        try {
            if (!id) return res.status(400).json({ error: "Missing thread id" });
            const thread = await client.channels.fetch(id);
            if (!thread?.isThread()) return res.status(404).json({ error: "Not a valid thread" });

            const starter = await thread.fetchStarterMessage();
            if (!starter) return res.status(404).json({ error: "Starter message not found" });

            res.json({
                content: starter.content,
                attachments: starter.attachments.map(att => ({
                    url: att.url,
                    content_type: att.contentType || att.content_type || 'unknown',
                    name: att.name || 'attachment',
                    size: att.size
                }))
            });
        } catch (err) {
            console.error('Get post content error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ────────────────────────────────────────────────
    // 12. SUPPORTER RELEASE (with embed suppression)
    // ────────────────────────────────────────────────
    app.post('/api/supporter-release', upload.array('images'), async (req, res) => {
        const { pack, setSize, input, series, suffix, download, editPreview, previewThreadId, supporterThreadId } = req.body;
        const files = req.files || [];

        try {
            const fullInput = input.trim();
            const spaceIndex = fullInput.indexOf(' ');
            let genderEmoji = "";
            let charName = fullInput;
            if (spaceIndex !== -1) {
                genderEmoji = fullInput.substring(0, spaceIndex).trim();
                charName = fullInput.substring(spaceIndex + 1).trim();
            }

            let roleMention = "";
            const appliedTags = [];
            if (genderEmoji.includes('female_sign') || genderEmoji === '♀️') {
                roleMention = '<@&1465968041404928177>';
                appliedTags.push('1465939610642415921');
            } else if (genderEmoji.includes('male_sign') || genderEmoji === '♂️') {
                roleMention = '<@&1465967964804350160>';
                appliedTags.push('1465939591352680488');
                appliedTags.push('1467020371428642957');
            }

            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const forumChannel = await guild.channels.fetch(SUPPORTER_FORUM_ID);

            const suffixStr = suffix ? ` — ${suffix}` : '';
            const threadTitle = `[${series.toUpperCase()}] ${charName} — Pack #${pack}${suffixStr}`;
            const messageBody = `:underage: NEW SUPPORTER RELEASE
${roleMention || ''}
━━━━━━━━━━━━━━
Character: ${charName}
Set size: ${setSize} images
Content: Explicit (18+)

:inbox_tray: Download:
${download || 'Download link here'}`;

            let supporterResult = {};
            if (supporterThreadId) {
                const thread = await client.channels.fetch(supporterThreadId);
                if (!thread) return res.status(404).json({ error: "Thread not found" });

                await thread.setName(threadTitle);
                await thread.setAppliedTags(appliedTags, `Updating tags for supporter release`);

                const starter = await thread.fetchStarterMessage();
                if (starter) {
                    await starter.edit({
                        content: messageBody,
                        flags: ["SuppressEmbeds"]
                    });
                }

                if (files.length > 0) {
                    const attachments = files.map(f => ({ attachment: f.buffer, name: f.originalname }));
                    const sent = await thread.send({ content: "📸 **Updated images:**", files: attachments });
                    await sent.edit({ flags: ["SuppressEmbeds"] });
                }
                supporterResult = { updated: true };
            } else {
                const newThread = await forumChannel.threads.create({
                    name: threadTitle,
                    appliedTags: appliedTags.length > 0 ? appliedTags : undefined,
                    message: { content: messageBody, files: files.map(f => ({ attachment: f.buffer, name: f.originalname })) }
                });

                const starter = await newThread.fetchStarterMessage();
                if (starter) {
                    await starter.edit({ flags: ["SuppressEmbeds"] });
                }
                supporterResult = { created: true };
            }

            // --- Update Preview Thread if Toggle is ON ---
            let previewResult = {};
            if (editPreview === 'true') {
                let targetPreviewId = previewThreadId;

                if (!targetPreviewId && supporterThreadId) {
                    try {
                        const previewForum = await guild.channels.fetch('1465938599378812980');
                        const threads = await previewForum.threads.fetchActive();
                        const seriesUpper = series.toUpperCase();
                        const packPattern = `Pack #${pack}`;
                        const matchingThread = threads.threads.find(t =>
                            t.name.includes(`[${seriesUpper}]`) && t.name.includes(packPattern)
                        );

                        if (matchingThread) {
                            targetPreviewId = matchingThread.id;
                            console.log(`Auto-matched preview thread: ${matchingThread.name} (${matchingThread.id})`);
                        } else {
                            console.warn('No matching preview thread found for auto-update.');
                            previewResult = { previewError: 'No matching preview thread found' };
                        }
                    } catch (findErr) {
                        console.error('Error finding preview thread:', findErr);
                        previewResult = { previewError: findErr.message };
                    }
                }

                if (targetPreviewId) {
                    try {
                        const previewThread = await client.channels.fetch(targetPreviewId);
                        if (!previewThread) {
                            console.warn("Preview thread not found:", targetPreviewId);
                            previewResult = { previewError: "Preview thread not found" };
                        } else {
                            let newTitle = previewThread.name;
                            if (newTitle.includes(' — SOON')) {
                                newTitle = newTitle.replace(' — SOON', '');
                                await previewThread.setName(newTitle);
                            }

                            const starter = await previewThread.fetchStarterMessage();
                            if (starter) {
                                let newContent = starter.content;
                                const setSizeRegex = /Set size:\s*\d+\s*images/i;
                                const setSizeSoonRegex = /Set size:\s*XX\s*images/i;
                                if (setSizeRegex.test(newContent) || setSizeSoonRegex.test(newContent)) {
                                    newContent = newContent.replace(/(Set size:\s*)(\d+|XX)(\s*images)/i, `$1${setSize}$3`);
                                }
                                if (newContent.includes(':new: NEW RELEASE -- SOON')) {
                                    newContent = newContent.replace(':new: NEW RELEASE -- SOON', ':new: NEW RELEASE');
                                }
                                await starter.edit(newContent);
                            }
                            previewResult = { previewUpdated: true };
                        }
                    } catch (previewErr) {
                        console.error('Error updating preview thread:', previewErr);
                        previewResult = { previewError: previewErr.message };
                    }
                }
            }

            res.json({ success: true, ...supporterResult, ...previewResult });

        } catch (err) {
            console.error('Supporter release error:', err);
            res.status(500).json({ error: err.message });
        }
    });

// ────────────────────────────────────────────────
// 13. MEGA UPLOAD (with month folder and progress)
// ────────────────────────────────────────────────
app.post('/api/upload-to-mega', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!req.file.originalname.toLowerCase().endsWith('.zip')) {
        return res.status(400).json({ error: 'Only ZIP files are allowed' });
    }

    if (req.file.size > 100 * 1024 * 1024) {
        return res.status(400).json({ error: 'File exceeds 100MB limit' });
    }

    const megaEmail = process.env.MEGA_EMAIL;
    const megaPassword = process.env.MEGA_PASSWORD;
    if (!megaEmail || !megaPassword) {
        console.error('MEGA credentials not set in environment');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    const desiredFileName = req.file.originalname;
    const month = req.body.month; // e.g., "MAR-26"
    if (!month) {
        return res.status(400).json({ error: 'Month folder not provided' });
    }

    // Parse year from month string (assumes format "MMM-YY")
    const yearShort = month.slice(-2);
    const year = `20${yearShort}`;
    const folderPath = ['Packs', year, month];

    // Helper to create folders recursively
    async function getOrCreateFolder(node, pathParts) {
        let current = node;
        for (const part of pathParts) {
            let child = current.children.find(c => c.name === part && c.directory);
            if (!child) {
                child = await current.mkdir(part);
            }
            current = child;
        }
        return current;
    }

    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `mega-upload-${Date.now()}-${desiredFileName}`);

    try {
        fs.writeFileSync(tempFilePath, req.file.buffer);

        const storage = await new Storage({
            email: megaEmail,
            password: megaPassword
        }).ready;

        const targetFolder = await getOrCreateFolder(storage.root, folderPath);

        const readStream = fs.createReadStream(tempFilePath);

        const uploadResult = await new Promise((resolve, reject) => {
            const upload = targetFolder.upload({
                name: desiredFileName,
                size: req.file.size
            }, readStream);

            upload.on('error', reject);
            upload.on('complete', (file) => resolve(file));
        });

        // Only log this one line on success
        console.log('📤️[MEGA] Upload complete');

        const link = await uploadResult.link();

        fs.unlinkSync(tempFilePath);
        storage.close();

        res.json({ success: true, link });
    } catch (error) {
        console.error('MEGA upload error:', error);
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
        res.status(500).json({ error: error.message || 'Upload failed' });
    }
});


// ────────────────────────────────────────────────
// 14. TEST ZIP (extract first 10 images, sorted by embedded number)
// ────────────────────────────────────────────────
app.post('/api/test-zip', upload.single('zipfile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    if (req.file.size > 100 * 1024 * 1024) {
        return res.status(400).json({ error: 'File exceeds 100MB limit' });
    }

    try {
        const zip = new AdmZip(req.file.buffer);
        const entries = zip.getEntries();

        // Filter image files
        const imageEntries = entries.filter(entry => 
            /\.(jpg|jpeg|png|gif|webp)$/i.test(entry.entryName) && !entry.isDirectory
        );

        // Sort by the numeric part in the filename (e.g., "Astolfo -001-.jpg" → 1)
        imageEntries.sort((a, b) => {
            const regex = /-(\d{3})-/; // matches pattern like -001-
            const aMatch = a.entryName.match(regex);
            const bMatch = b.entryName.match(regex);
            const aNum = aMatch ? parseInt(aMatch[1], 10) : 0;
            const bNum = bMatch ? parseInt(bMatch[1], 10) : 0;
            return aNum - bNum;
        });

        const totalImages = imageEntries.length;
        const previewImages = imageEntries.slice(0, 10).map(entry => ({
            name: entry.entryName.split('/').pop(),
            data: `data:image/jpeg;base64,${entry.getData().toString('base64')}`
        }));

        res.json({ success: true, images: previewImages, total: totalImages });
    } catch (err) {
        console.error('Test zip error:', err);
        res.status(500).json({ error: err.message });
    }
});

    // ────────────────────────────────────────────────
    // NEW: 15. PAYPAL CAPTURE (Place this near your Create Order logic)
    // ────────────────────────────────────────────────
app.post('/api/capture-membership-order', async (req, res) => {
    const { orderId, tier, discordId } = req.body;

    try {
        console.log(`📥 Processing Membership: Order ${orderId} | Tier ${tier} | User ${discordId}`);

        // Calculate expiration (30 days from now)
        const now = new Date();
        const expiresAt = new Date();
        expiresAt.setDate(now.getDate() + 30);

        // 1. Update Supabase with explicit expiration
        const { error } = await supabase
            .from('memberships')
            .upsert({ 
                discord_id: discordId, 
                tier: parseInt(tier), 
                order_id: orderId,
                updated_at: now.toISOString(),
                expires_at: expiresAt.toISOString() // Store this for the bot!
            }, { onConflict: 'discord_id' });

        if (error) throw error;

        // 2. Assign Discord Role
        // Using a try/catch here so if Discord fails, the DB record still stays saved
        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch(discordId).catch(() => null);
            
            if (member) {
                const tierRoles = {
                    "1": "1346397089470353408", // Replace with your ACTUAL Bronze ID
                    "2": "876543210987654321"  // Replace with your ACTUAL Silver ID
                };

                const roleId = tierRoles[String(tier)];
                if (roleId) {
                    await member.roles.add(roleId);
                    console.log(`✅ Role added to ${member.user.tag}`);
                }
            }
        } catch (discordErr) {
            console.error('⚠️ DB updated, but Discord role failed:', discordErr.message);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('❌ Capture error:', err);
        res.status(500).json({ error: "Failed to process membership", details: err.message });
    }
});


    // ────────────────────────────────────────────────
    // NEW: 16. MEMBERSHIP FROM SITE
    // ────────────────────────────────────────────────
app.get('/api/get-memberships', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('memberships')
            .select('*')
            .order('expires_at', { ascending: true });

        if (error) throw error;

        // Replace 'YOUR_GUILD_ID' with your actual Discord Server ID
        const guild = await client.guilds.fetch('YOUR_GUILD_ID'); 

        const enriched = await Promise.all(data.map(async (row) => {
            try {
                // Fetch the member specifically from your server
                const member = await guild.members.fetch(row.discord_id);
                return { 
                    ...row, 
                    server_name: member.displayName, // Server Nickname
                    discord_name: member.user.tag    // Global Username
                };
            } catch {
                // Fallback if they left the server
                return { ...row, server_name: 'Not in Server', discord_name: 'Unknown' };
            }
        }));

        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

	
    // ────────────────────────────────────────────────
    // SERVE DASHBOARD
    // ────────────────────────────────────────────────
    app.get('/poll-san', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    app.listen(PORT, () => {
        console.log(`🌐 Dashboard running at http://localhost:${PORT}/poll-san`);
//          console.log(`🌐 Dashboard running at https://d.velutinx.com/poll-san`);
    });
};
