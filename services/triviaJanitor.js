// services/triviaJanitor.js
const db = require('./database');
const h = require('../utils/helpers');

const TRIVIA_CONFIG = h.games?.trivia || {};
const TRIVIA_BOT_ID = TRIVIA_CONFIG.botId || h.ids?.bots?.rinbot || '429656936435286016';
const TRIVIA_CHANNEL_ID = TRIVIA_CONFIG.channelId || h.ids?.channels?.TRIVIA || '1495387346990928003';
const CLEANUP_DELAY = 60000;

const deletionTimeouts = new Map();

async function handleTriviaMessage(message) {
    if (message.channel.id !== TRIVIA_CHANNEL_ID) return;

    if (deletionTimeouts.has(message.id)) {
        clearTimeout(deletionTimeouts.get(message.id));
    }

    const timeout = setTimeout(async () => {
        try {
            await message.delete();
            console.log(`🗑️ Deleted message ${message.id} from ${message.author.tag} (trivia cleanup)`);
        } catch (err) {
            if (err.code !== 10008) {
                console.error(`Failed to delete message ${message.id}:`, err.message);
            }
        } finally {
            deletionTimeouts.delete(message.id);
        }
    }, CLEANUP_DELAY);

    deletionTimeouts.set(message.id, timeout);
}

async function processEndOfDayAwards(client) {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    try {
        // Fetch records that haven't been awarded yet
        const records = await db.query(
            `SELECT discord_id, discord_username, highest_score
             FROM ${h.tables.GAMES_TRIVIA_DAILY}
             WHERE date = ? AND tickets_awarded IS NULL`,
            [dateStr]
        );

        if (!records || records.length === 0) return;

        for (const record of records) {
            const userId = record.discord_id;
            const highScore = record.highest_score || 0;
            const ticketsToAward = Math.min(highScore, (TRIVIA_CONFIG.dailyTicketCap || 10));

            if (ticketsToAward > 0) {
                // Atomically add tickets: insert user if not exists, else increment
                await db.query(
                    `INSERT INTO ${h.tables.GAMES_USER_DATA} (user_id, tickets, discord_username, updated_at)
                     VALUES (?, ?, ?, datetime('now'))
                     ON CONFLICT(user_id) DO UPDATE SET
                         tickets = tickets + excluded.tickets,
                         discord_username = excluded.discord_username,
                         updated_at = excluded.updated_at`,
                    [userId, ticketsToAward, record.discord_username]
                );

                // Mark as awarded for this date
                await db.query(
                    `UPDATE ${h.tables.GAMES_TRIVIA_DAILY}
                     SET tickets_awarded = ?
                     WHERE discord_id = ? AND date = ?`,
                    [ticketsToAward, userId, dateStr]
                );
            }
        }
    } catch (err) {
        console.error('[TriviaJanitor] processEndOfDayAwards error:', err.message);
    }
}

module.exports = {
    handleTriviaMessage,
    processEndOfDayAwards
};
