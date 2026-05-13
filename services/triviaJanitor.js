// services/triviaJanitor.js
const supabase = require('./supabase');
const h = require('../utils/helpers');

const TRIVIA_CONFIG = h.games?.trivia || {};
const TRIVIA_BOT_ID = TRIVIA_CONFIG.botId || h.ids?.bots?.rinbot || '429656936435286016';
const TRIVIA_CHANNEL_ID = TRIVIA_CONFIG.channelId || h.ids?.channels?.TRIVIA || '1495387346990928003';
const CLEANUP_DELAY = 60000; // 60 seconds

// In‑memory map to avoid multiple timers on the same message
const deletionTimeouts = new Map();

/**
 * Delete any message in the trivia channel after CLEANUP_DELAY ms.
 * This includes messages from RinBot, Mudae, users, and the bot itself.
 */
async function handleTriviaMessage(message) {
    // Only affect the designated trivia channel
    if (message.channel.id !== TRIVIA_CHANNEL_ID) return;

    // If a timeout for this message ID already exists, clear it and restart the timer
    if (deletionTimeouts.has(message.id)) {
        clearTimeout(deletionTimeouts.get(message.id));
    }

    const timeout = setTimeout(async () => {
        try {
            await message.delete();
            console.log(`🗑️ Deleted message ${message.id} from ${message.author.tag} (trivia cleanup)`);
        } catch (err) {
            // Ignore if message already deleted (e.g., by Discord)
            if (err.code !== 10008) {
                console.error(`Failed to delete message ${message.id}:`, err.message);
            }
        } finally {
            deletionTimeouts.delete(message.id);
        }
    }, CLEANUP_DELAY);

    deletionTimeouts.set(message.id, timeout);
}

/**
 * Process end‑of‑day awards (unchanged logic, no DM).
 * Called periodically by the bot.
 */
async function processEndOfDayAwards(client) {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    const { data: records, error } = await supabase
        .from(h.tables.GAMES_TRIVIA_DAILY)
        .select('discord_id, discord_username, highest_score')
        .eq('date', dateStr)
        .is('tickets_awarded', null);

    if (error || !records) return;

    for (const record of records) {
        const userId = record.discord_id;
        const username = record.discord_username;
        const highScore = record.highest_score || 0;
        const ticketsToAward = Math.min(highScore, (TRIVIA_CONFIG.dailyTicketCap || 10));

        if (ticketsToAward > 0) {
            // Award tickets
            await supabase.rpc('add_tickets', { user_id: userId, amount: ticketsToAward });
            await supabase
                .from(h.tables.GAMES_TRIVIA_DAILY)
                .update({ tickets_awarded: ticketsToAward })
                .eq('discord_id', userId)
                .eq('date', dateStr);

            // --- DM removed completely ---
        }
    }
}

module.exports = {
    handleTriviaMessage,
    processEndOfDayAwards
};
