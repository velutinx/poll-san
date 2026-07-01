// web/routes/trivia.js
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { ChannelType } = require('discord.js');
const h = require('../../utils/helpers');
const db = require('../../services/database');
const { putR2Image } = require('../../services/r2Storage');
const { processAndUploadTriviaImage, SECTIONS } = require('../../services/triviaImage');
const { getWebhook, startTriviaTimer, performReveal, endTriviaGameAdmin } = require('../../services/triviaService');

const LOGO_URL = h.urls.LOGO_URL;

module.exports = function setupTriviaRoutes(app, client) {

    app.post('/api/trivia/create', upload.single('image'), async (req, res) => {
        const { answer, series, hint, interval, channelId } = req.body;
        const imageFile = req.file;

        if (!answer || !series || !channelId || !imageFile) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const channel = await guild.channels.fetch(channelId);
            if (!channel) {
                return res.status(404).json({ error: 'Channel not found' });
            }

            if (channel.type !== ChannelType.GuildForum) {
                return res.status(400).json({ error: 'Trivia must be created in a forum channel.' });
            }

            const intervalMinutes = parseFloat(interval) || 60;

            const sections = Array.from({ length: SECTIONS }, (_, i) => i);
            for (let i = sections.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [sections[i], sections[j]] = [sections[j], sections[i]];
            }
            const corners = [0, 2, 9, 11];
            if (corners.includes(sections[0])) {
                for (let i = 1; i < sections.length; i++) {
                    if (!corners.includes(sections[i])) {
                        [sections[0], sections[i]] = [sections[i], sections[0]];
                        break;
                    }
                }
            }
            const revealOrder = sections;
            const firstReveal = revealOrder[0];

            await db.query(
                `INSERT INTO games_trivia
                (channel_id, thread_id, message_id, image_key, answer, series, hint, total_sections, revealed_count, revealed_sections, reveal_order, interval_minutes, next_reveal_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    channelId,
                    '',
                    '',
                    'pending',
                    answer,
                    series,
                    hint || null,
                    SECTIONS,
                    1,
                    JSON.stringify([firstReveal]),
                    JSON.stringify(revealOrder),
                    intervalMinutes,
                    new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString(),
                    'active'
                ]
            );

            const rowIdResult = await db.query(`SELECT last_insert_rowid() as id`, [], true);
            const dbId = rowIdResult.id;
            const folderName = `trivia_${dbId}`;
            const originalKey = `images/trivia/${folderName}/original.jpg`;
            await putR2Image(originalKey, imageFile.buffer, 'image/jpeg');

            const { url: initialUrl } = await processAndUploadTriviaImage(
                imageFile.buffer,
                folderName,
                [firstReveal],
                SECTIONS
            );

            const webhook = await getWebhook(channel, 'Trivia');

            const emoji = h.releaseEmojis.PIXELSKY || '✨';
            const embed = {
                description: `${emoji} **Try to guess the character name!** ${emoji}\n\n` +
                    `**Rules:**\n` +
                    `• Guess the character name to win!\n` +
                    `• Type the series name for a hint.\n` +
                    `• A new section of the image will be revealed every **${intervalMinutes} minute(s)**.`,
                color: 0x9B59B6,
                image: { url: initialUrl },
            };
            const sentMessage = await webhook.send({
                embeds: [embed],
                threadName: `🧩 Trivia: ${dbId}`,
                username: 'Trivia',
                avatarURL: LOGO_URL,
            });

            const thread = sentMessage.channel;
            if (!thread || !thread.isThread()) {
                return res.status(500).json({ error: 'Failed to create thread.' });
            }

            const imageKey = `images/trivia/${folderName}/trivia_1.jpg`;
            await db.query(
                `UPDATE games_trivia SET thread_id = ?, message_id = ?, image_key = ? WHERE id = ?`,
                [thread.id, sentMessage.id, imageKey, dbId]
            );

            await startTriviaTimer(client, dbId);

            res.json({ success: true, gameId: dbId });

        } catch (err) {
            console.error('Trivia creation error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/trivia/active', async (req, res) => {
        try {
            const games = await db.query(
                `SELECT * FROM games_trivia WHERE status = 'active' ORDER BY created_at DESC`
            );
            res.json({ games });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/trivia/winners', async (req, res) => {
        try {
            const games = await db.query(
                `SELECT id, answer, winners FROM games_trivia WHERE winners IS NOT NULL AND winners != '[]' ORDER BY completed_at DESC LIMIT 20`
            );
            const allWinners = [];
            games.forEach(g => {
                const w = JSON.parse(g.winners);
                w.forEach(winner => {
                    allWinners.push({ ...winner, answer: g.answer });
                });
            });
            res.json({ winners: allWinners });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/trivia/reveal', async (req, res) => {
        const { gameId } = req.body;
        if (!gameId) return res.status(400).json({ error: 'Missing gameId' });
        try {
            await performReveal(client, gameId);
            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/trivia/end', async (req, res) => {
        const { gameId } = req.body;
        if (!gameId) return res.status(400).json({ error: 'Missing gameId' });
        try {
            await endTriviaGameAdmin(client, gameId);
            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

};
