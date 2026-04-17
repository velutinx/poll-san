// This is poll-san/events/messageCreate.js

const supabase = require('../services/supabase');
const h = require('../utils/helpers');

// Pull configuration from helpers
const { botId: WORDLE_BOT_ID, channelId: WORDLE_CHANNEL_ID, cooldownHours: COOLDOWN_HOURS, winPattern: WORDLE_WIN_PATTERN } = h.games.wordle;

/**
 * Checks if a message is a winning Wordle result from WordleBot
 */
function isWordleWin(message) {
    const content = message.content;
    const match = content.match(WORDLE_WIN_PATTERN);
    if (!match) return false;
    // If it's "X/6", they lost
    if (match[1] === 'X') return false;
    // It's a win (number/6)
    return true;
}

/**
 * Awards a ticket to a user if cooldown has passed
 */
async function awardTicket(userId) {
    try {
        const { data: userData, error: fetchError } = await supabase
            .from('games_wordle')
            .select('last_win_at')
            .eq('discord_id', userId)
            .maybeSingle();

        if (fetchError) throw fetchError;

        const now = new Date();
        let canAward = true;

        if (userData?.last_win_at) {
            const lastWin = new Date(userData.last_win_at);
            const hoursSince = (now - lastWin) / (1000 * 60 * 60);
            if (hoursSince < COOLDOWN_HOURS) {
                canAward = false;
            }
        }

        if (!canAward) {
            return { awarded: false, reason: 'cooldown' };
        }

        const { data: newCount, error: rpcError } = await supabase
            .rpc('increment_wordle_ticket', { user_id: userId });

        if (rpcError) throw rpcError;

        return { awarded: true, newCount };
    } catch (error) {
        console.error('Ticket award error:', error);
        return { awarded: false, reason: 'error' };
    }
}

module.exports = async (message) => {
    // --- 1. HANDLE WORDLEBOT'S OWN MESSAGES (Auto-delete spam) ---
    if (message.author.id === WORDLE_BOT_ID) {
        // Only act if the message is in the designated Wordle channel
        if (message.channel.id !== WORDLE_CHANNEL_ID) return;

        const content = message.content.toLowerCase();
        // Delete achievement and FAQ messages after a short delay
        if (content.includes('congratulations! you\'ve unlocked an achievement') ||
            content.includes('here is the faq page')) {
            setTimeout(() => message.delete().catch(() => {}), 1500);
        }
        return; // Stop processing – we don't award tickets to a bot
    }

    // --- 2. IGNORE OTHER BOTS AND WRONG CHANNEL ---
    if (message.author.bot) return;
    if (message.channel.id !== WORDLE_CHANNEL_ID) return;

    // --- 3. CHECK FOR WORDLE WIN & AWARD TICKET ---
    if (!isWordleWin(message)) return;

    const result = await awardTicket(message.author.id);

    if (result.awarded) {
        await message.react('🎟️').catch(() => {});
        await message.reply({
            content: `🎉 Nice win! You've earned **1 ticket**! You now have **${result.newCount}** ticket(s).`,
            allowedMentions: { repliedUser: true }
        }).catch(() => {});
    }
    // Cooldown case is silent to avoid spam
};
