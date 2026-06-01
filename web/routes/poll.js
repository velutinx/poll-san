// web/routes/poll.js

const { EmbedBuilder } = require('discord.js');

module.exports = function setupPollRoutes(app, client) {
    const h = require('../../utils/helpers');
    const pollService = require('../../services/pollService');
    const db = require('../../services/database');   // D1 client
    
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

            // Clear final votes from previous poll
            await db.query(
                `DELETE FROM ${h.tables.POLL_VOTES_FINAL} WHERE option_id != 0`
            );
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

            // Fetch final vote scores
            const data = await db.query(
                `SELECT character_name, score, selected_at
                 FROM ${h.tables.POLL_VOTES_FINAL}
                 ORDER BY option_id ASC`
            );

            // Fetch active poll end time
            const activePoll = await db.query(
                `SELECT ends_at FROM ${h.tables.POLL_AUTO_RESUME}
                 WHERE ends_at > ?
                 ORDER BY id DESC
                 LIMIT 1`,
                [new Date().toISOString()],
                true   // single row
            );
            const endTime = activePoll?.ends_at ? new Date(activePoll.ends_at).toISOString() : null;

            const responseData = {
                results: data || [],
                endTime: endTime
            };
            cachedPollResultsData = responseData;
            cachedPollResultsTime = Date.now();
            res.json(responseData);
        } catch (e) {
            console.error('Poll results error:', e);
            res.json(cachedPollResultsData || { results: [], endTime: null });
        }
    });

    // STOP POLL
    app.post('/api/stop-poll', async (req, res) => {
        try {
            pollService.forceStopPoll();

            const poll = await db.query(
                `SELECT * FROM ${h.tables.POLL_AUTO_RESUME}
                 ORDER BY id DESC
                 LIMIT 1`,
                [],
                true   // single row
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
                
                const webhooks = await channel.fetchWebhooks();
                const pollWebhook = webhooks.find(w => w.name === 'Poll');
                if (pollWebhook) {
                    await pollWebhook.editMessage(pollMessage.id, { content });
                } else {
                    await pollMessage.edit({ content }).catch(() => {});
                }
            }

            // Truncate poll tables (replaces the old RPC)
            await db.query(`DELETE FROM ${h.tables.POLL_VOTING_DISCORD} WHERE poll_id = 'character_poll_new'`);
            await db.query(`DELETE FROM ${h.tables.POLL_VOTING_WEBSITE} WHERE poll_id = 'character_poll_new'`);
            await db.query(`DELETE FROM ${h.tables.POLL_VOTES_FINAL} WHERE poll_id = 'character_poll_new'`);

            cachedPollResultsData = null;
            cachedPollResultsTime = 0;
            res.json({ success: true });
        } catch (err) {
            console.error('Stop poll error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // MARK WINNER (combined message)
    app.post('/api/mark-winner', async (req, res) => {
        const { winner_name } = req.body;
        const e = h.releaseEmojis;

        try {
            const poll = await db.query(
                `SELECT * FROM ${h.tables.POLL_AUTO_RESUME}
                 ORDER BY id DESC
                 LIMIT 1`,
                [],
                true   // single row
            );
            if (!poll) return res.status(404).json({ error: "No active poll found." });

            // Find the winner's option ID
            const winnerRow = await db.query(
                `SELECT option_id FROM ${h.tables.POLL_VOTES_FINAL}
                 WHERE LOWER(character_name) LIKE LOWER(?) AND poll_id = ?`,
                [`%${winner_name}%`, 'character_poll_new'],
                true   // single row
            );
            const winnerOptionId = winnerRow?.option_id;

            // Mark winner with timestamp
            await db.query(
                `UPDATE ${h.tables.POLL_VOTES_FINAL}
                 SET selected_at = ?
                 WHERE LOWER(character_name) LIKE LOWER(?)`,
                [new Date().toISOString(), `%${winner_name}%`]
            );

            // Fetch updated vote data
            const voteData = await db.query(
                `SELECT character_name, score, selected_at, option_id
                 FROM ${h.tables.POLL_VOTES_FINAL}
                 ORDER BY option_id ASC`
            );

            const channel = await client.channels.fetch(poll.channel_id);
            const pollMessage = await channel.messages.fetch(poll.message_id);
            const thread = pollMessage.thread;
            if (!thread) return res.status(404).json({ error: "Thread not found." });

            const characters = poll.poll_list
                .split(/(?=:female_sign:|:male_sign:|♀️|♂️|\n)/)
                .map(s => s.trim().replace(/:female_sign:/g, '♀️').replace(/:male_sign:/g, '♂️'))
                .filter(s => s.length > 1);

            let scoreboard = `${h.releaseEmojis.getRandomVerify()} **${winner_name}** has been marked as a winner! ${e.CONFETTI}\n\n`;
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

            const webhooks = await channel.fetchWebhooks();
            const pollWebhook = webhooks.find(w => w.name === 'Poll');

            const payload = {
                content: scoreboard,
                threadId: thread.id,
                username: 'Poll',
                avatarURL: h.urls.LOGO_URL,
                embeds: []
            };

            if (winnerOptionId) {
                const imageUrl = `https://www.velutinx.com/images/poll/${winnerOptionId}.jpg`;
                const embed = new EmbedBuilder().setImage(imageUrl).setColor(0x00FF00);
                payload.embeds.push(embed);
            }

            if (pollWebhook) {
                await pollWebhook.send(payload);
            } else {
                if (payload.embeds.length > 0) {
                    await thread.send({ content: payload.content, embeds: payload.embeds });
                } else {
                    await thread.send(payload.content);
                }
            }

            res.json({ success: true });
        } catch (err) {
            console.error('Mark winner error:', err);
            res.status(500).json({ error: err.message });
        }
    });
};
