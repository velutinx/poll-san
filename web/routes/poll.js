const { EmbedBuilder } = require('discord.js');

module.exports = function setupPollRoutes(app, client) {
    const h = require('../../utils/helpers');
    const pollService = require('../../services/pollService');
    const db = require('../../services/database');

    // GET poll interval (from helpers)
    app.get('/api/poll-interval', (req, res) => {
        res.json({ interval: h.POLL_UPDATE_INTERVAL_MS || 30000 });
    });

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

            await db.query(`DELETE FROM ${h.tables.POLL_VOTES_FINAL} WHERE option_id != 0`);
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
            const data = await db.query(
                `SELECT character_name, score, selected_at FROM ${h.tables.POLL_VOTES_FINAL} ORDER BY option_id ASC`
            );
            const activePoll = await db.query(
                `SELECT ends_at FROM ${h.tables.POLL_AUTO_RESUME} WHERE ends_at > ? ORDER BY id DESC LIMIT 1`,
                [new Date().toISOString()],
                true
            );
            const endTime = activePoll?.ends_at ? new Date(activePoll.ends_at).toISOString() : null;
            res.json({ results: data || [], endTime: endTime });
        } catch (e) {
            console.error('Poll results error:', e);
            res.json({ results: [], endTime: null });
        }
    });

    // STOP POLL
    app.post('/api/stop-poll', async (req, res) => {
        try {
            pollService.forceStopPoll();
            const poll = await db.query(
                `SELECT * FROM ${h.tables.POLL_AUTO_RESUME} ORDER BY id DESC LIMIT 1`,
                [],
                true
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
            await db.query(`DELETE FROM ${h.tables.POLL_AUTO_RESUME} WHERE ends_at > datetime('now')`);
            await db.query(`DELETE FROM ${h.tables.POLL_VOTING_DISCORD} WHERE poll_id = 'character_poll_new'`);
            await db.query(`DELETE FROM ${h.tables.POLL_VOTING_WEBSITE} WHERE poll_id = 'character_poll_new'`);
            await db.query(`DELETE FROM ${h.tables.POLL_VOTES_FINAL} WHERE poll_id = 'character_poll_new'`);
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
            const poll = await db.query(
                `SELECT * FROM ${h.tables.POLL_AUTO_RESUME} ORDER BY id DESC LIMIT 1`,
                [],
                true
            );
            if (!poll) return res.status(404).json({ error: "No active poll found." });

            const winnerRow = await db.query(
                `SELECT option_id FROM ${h.tables.POLL_VOTES_FINAL} WHERE LOWER(character_name) LIKE LOWER(?) AND poll_id = ?`,
                [`%${winner_name}%`, 'character_poll_new'],
                true
            );
            const winnerOptionId = winnerRow?.option_id;

            await db.query(
                `UPDATE ${h.tables.POLL_VOTES_FINAL} SET selected_at = ? WHERE LOWER(character_name) LIKE LOWER(?)`,
                [new Date().toISOString(), `%${winner_name}%`]
            );

            const voteData = await db.query(
                `SELECT character_name, score, selected_at, option_id FROM ${h.tables.POLL_VOTES_FINAL} ORDER BY option_id ASC`
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

    // ADJUST POLL TIME
    app.post('/api/poll/adjust-time', async (req, res) => {
        const { hours } = req.body;
        if (typeof hours !== 'number' || isNaN(hours)) {
            return res.status(400).json({ error: 'Invalid hours value' });
        }
        try {
            const poll = await db.query(
                `SELECT * FROM ${h.tables.POLL_AUTO_RESUME} WHERE ends_at > datetime('now') ORDER BY id DESC LIMIT 1`,
                [],
                true
            );
            if (!poll) return res.status(404).json({ error: 'No active poll found' });

            const oldEnd = new Date(poll.ends_at);
            const newEnd = new Date(oldEnd.getTime() + hours * 60 * 60 * 1000);
            const newEndISO = newEnd.toISOString();
            await db.query(`UPDATE ${h.tables.POLL_AUTO_RESUME} SET ends_at = ? WHERE message_id = ?`, [newEndISO, poll.message_id]);

            const channel = await client.channels.fetch(poll.channel_id);
            const pollMessage = await channel.messages.fetch(poll.message_id);
            const characters = poll.poll_list
                .split(/(?=:female_sign:|:male_sign:|♀️|♂️)/)
                .map(s => s.trim())
                .filter(s => s.length > 0);

            const { forceStopPoll, runPollInterval, refreshPollMessage } = require('../../services/pollService');
            forceStopPoll();
            await refreshPollMessage(pollMessage, characters, newEnd.getTime());
            runPollInterval(pollMessage, newEnd.getTime(), characters);

            const { startPollReminders } = require('../../services/pollReminders');
            await startPollReminders(channel, poll.message_id, newEndISO, client);

            res.json({ success: true, newEndTime: newEndISO });
        } catch (err) {
            console.error('Poll time adjust error:', err);
            res.status(500).json({ error: err.message });
        }
    });
};
