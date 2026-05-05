// web/routes/poll.js

const { EmbedBuilder } = require('discord.js');

module.exports = function setupPollRoutes(app, client, supabase, supabaseRetry) {
    const h = require('../../utils/helpers');
    const pollService = require('../../services/pollService');
    
    let cachedPollResultsData = null;
    let cachedPollResultsTime = 0;
    const POLL_CACHE_TTL = 60000;

    // START POLL
    app.post('/api/trigger-poll', async (req, res) => {
        const { channel_id, days, character_list } = req.body;
        try {
            const channel = await client.channels.fetch(channel_id);
            const startPollLogic = require('../../commands/startpoll.js');
            
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
                guildId: process.env.GUILD_ID || channel.guild.id,
                isChatInputCommand: () => true,
                isCommand: () => true
            };

            // Clear final votes
            await supabaseRetry(() => supabase.from(h.tables.POLL_VOTES_FINAL).delete().neq('option_id', 0));
            startPollLogic(mockInteraction);
            res.json({ success: true });
        } catch (err) {
            console.error('Trigger poll error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POLL RESULTS DATA
    app.get('/api/poll-results-data', async (req, res) => {
        try {
            if (cachedPollResultsData && (Date.now() - cachedPollResultsTime) < POLL_CACHE_TTL) {
                return res.json(cachedPollResultsData);
            }
            const { data } = await supabaseRetry(() =>
                supabase.from(h.tables.POLL_VOTES_FINAL)
                    .select('character_name, score, selected_at')
                    .order('option_id', { ascending: true })
            );
            cachedPollResultsData = data || [];
            cachedPollResultsTime = Date.now();
            res.json(cachedPollResultsData);
        } catch (e) {
            console.error('Poll results error:', e);
            res.json(cachedPollResultsData || []);
        }
    });

    // STOP POLL
    app.post('/api/stop-poll', async (req, res) => {
        try {
            pollService.forceStopPoll();

            const { data: poll } = await supabaseRetry(() =>
                supabase.from(h.tables.POLL_AUTO_RESUME)
                    .select('*')
                    .order('id', { ascending: false })
                    .limit(1)
                    .single()
            );

            if (poll) {
                const channel = await client.channels.fetch(poll.channel_id);
                const pollMessage = await channel.messages.fetch(poll.message_id);
                const characters = poll.poll_list
                    .split(/(?=:female_sign:|:male_sign:|♀️|♂️|\n)/)
                    .map(s => s.trim())
                    .filter(s => s.length > 1);
                const results = await pollService.getPollResults(pollMessage, characters);
                const content = await pollService.generateMessageContent(0, results, characters, true);
                
                // Edit the poll message via the Poll webhook
                const webhooks = await channel.fetchWebhooks();
                const pollWebhook = webhooks.find(w => w.name === 'Poll');
                if (pollWebhook) {
                    await pollWebhook.editMessage(pollMessage.id, { content });
                } else {
                    await pollMessage.edit({ content }).catch(() => {});
                }
            }

            const { error: rpcError } = await supabaseRetry(() =>
                supabase.rpc('truncate_poll_tables')
            );
            if (rpcError) throw rpcError;

            cachedPollResultsData = null;
            cachedPollResultsTime = 0;
            res.json({ success: true });
        } catch (err) {
            console.error('Stop poll error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // MARK WINNER
    app.post('/api/mark-winner', async (req, res) => {
        const { winner_name } = req.body;
        const e = h.releaseEmojis;

        try {
            const { data: poll } = await supabaseRetry(() =>
                supabase.from(h.tables.POLL_AUTO_RESUME)
                    .select('*')
                    .order('id', { ascending: false })
                    .limit(1)
                    .single()
            );
            if (!poll) return res.status(404).json({ error: "No active poll found." });

            const { data: winnerRow } = await supabaseRetry(() =>
                supabase.from(h.tables.POLL_VOTES_FINAL)
                    .select('option_id')
                    .ilike('character_name', `%${winner_name}%`)
                    .eq('poll_id', 'character_poll_new')
                    .maybeSingle()
            );
            const winnerOptionId = winnerRow?.option_id;

            await supabaseRetry(() =>
                supabase.from(h.tables.POLL_VOTES_FINAL)
                    .update({ selected_at: new Date().toISOString() })
                    .filter('character_name', 'ilike', `%${winner_name}%`)
            );

            const { data: voteData } = await supabaseRetry(() =>
                supabase.from(h.tables.POLL_VOTES_FINAL)
                    .select('character_name, score, selected_at, option_id')
                    .order('option_id', { ascending: true })
            );

            const channel = await client.channels.fetch(poll.channel_id);
            const pollMessage = await channel.messages.fetch(poll.message_id);
            const thread = pollMessage.thread;
            if (!thread) return res.status(404).json({ error: "Thread not found." });

            const characters = poll.poll_list
                .split(/(?=:female_sign:|:male_sign:|♀️|♂️|\n)/)
                .map(s => s.trim().replace(/:female_sign:/g, '♀️').replace(/:male_sign:/g, '♂️'))
                .filter(s => s.length > 1);

            let scoreboard = `:trophy: **${winner_name}** has been marked as a winner! ${e.CONFETTI}\n\n`;
            characters.forEach((char, index) => {
                const imgNum = index + 1;
                const emoji = h.emojis[index] || `[${imgNum}]`;
                const record = voteData.find(v => {
                    const cleanChar = char.replace(/♀️|♂️/g, '').trim().toLowerCase();
                    const cleanRecord = v.character_name.replace(/♀️|♂️/g, '').trim().toLowerCase();
                    return cleanChar === cleanRecord;
                });
                const score = record ? parseFloat(record.score).toFixed(2) : "0.00";
                const isWinner = record && record.selected_at !== null;
                const paddedScore = score.padStart(5, ' ');
                const paddedName = char.padEnd(30, ' ');
                let line = `${emoji} \` ${paddedScore} ${paddedName} \` \n`;
                if (isWinner) line = `||${line}||`;
                scoreboard += line;
            });

            // Send scoreboard via the Poll webhook
            const webhooks = await channel.fetchWebhooks();
            const pollWebhook = webhooks.find(w => w.name === 'Poll');
            if (pollWebhook) {
                await pollWebhook.send({
                    content: scoreboard,
                    threadId: thread.id,
                    username: 'Poll',
                    avatarURL: h.urls.LOGO_URL
                });
            } else {
                await thread.send(scoreboard);
            }

            // Send winner image embed (also via webhook for consistency)
            if (winnerOptionId) {
                const imageUrl = `https://www.velutinx.com/images/poll/${winnerOptionId}.jpg`;
                const embed = new EmbedBuilder().setImage(imageUrl).setColor(0x00FF00);
                if (pollWebhook) {
                    await pollWebhook.send({
                        embeds: [embed],
                        threadId: thread.id,
                        username: 'Poll',
                        avatarURL: h.urls.LOGO_URL
                    });
                } else {
                    await thread.send({ embeds: [embed] });
                }
            }
            res.json({ success: true });
        } catch (err) {
            console.error('Mark winner error:', err);
            res.status(500).json({ error: err.message });
        }
    });
};
