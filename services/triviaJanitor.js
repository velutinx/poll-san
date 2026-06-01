// services/triviaJanitor.js
const supabase = require('./supabase');
const h = require('../utils/helpers');
const { guardQuery } = require('../utils/supabaseCircuitBreaker');

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
        const { data: records, error } = await guardQuery(() =>
            supabase
                .from(h.tables.GAMES_TRIVIA_DAILY)
                .select('discord_id, discord_username, highest_score')
                .eq('date', dateStr)
                .is('tickets_awarded', null)
        );

        if (error || !records) return;

        for (const record of records) {
            const userId = record.discord_id;
            const username = record.discord_username;
            const highScore = record.highest_score || 0;
            const ticketsToAward = Math.min(highScore, (TRIVIA_CONFIG.dailyTicketCap || 10));

            if (ticketsToAward > 0) {
                await supabase.rpc('add_tickets', { user_id: userId, amount: ticketsToAward });
                await supabase
                    .from(h.tables.GAMES_TRIVIA_DAILY)
                    .update({ tickets_awarded: ticketsToAward })
                    .eq('discord_id', userId)
                    .eq('date', dateStr);
            }
        }
    } catch (err) {
        if (err.message === 'Supabase circuit breaker active – skipping query') {
            console.warn('[TriviaJanitor] Circuit breaker active, skipping end-of-day awards.');
        } else {
            h.logSupabaseError('TriviaJanitor', err);
        }
    }
}

module.exports = {
    handleTriviaMessage,
    processEndOfDayAwards
};
