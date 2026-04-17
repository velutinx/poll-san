// This is poll-san/events/messageCreate.js

const supabase = require('../services/supabase');
const h = require('../utils/helpers');

const { botId: WORDLE_BOT_ID, channelId: WORDLE_CHANNEL_ID, cooldownHours: COOLDOWN_HOURS, winPattern: WORDLE_WIN_PATTERN } = h.games.wordle;

function isWordleWin(message) {
    const content = message.content;
    const match = content.match(WORDLE_WIN_PATTERN);
    if (!match) return false;
    if (match[1] === 'X') return false;
    return true;
}

async function awardTicket(userId, username) {
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
            .rpc('increment_wordle_ticket', { 
                user_id: userId, 
                user_name: username 
            });

        if (rpcError) throw rpcError;

        return { awarded: true, newCount };
    } catch (error) {
        console.error('Ticket award error:', error);
        return { awarded: false, reason: 'error' };
    }
}

module.exports = async (message) => {
    if (message.author.id === WORDLE_BOT_ID) {
        if (message.channel.id !== WORDLE_CHANNEL_ID) return;
        const content = message.content.toLowerCase();
        if (content.includes('congratulations! you\'ve unlocked an achievement') ||
            content.includes('here is the faq page')) {
            setTimeout(() => message.delete().catch(() => {}), 1500);
        }
        return;
    }

    if (message.author.bot) return;
    if (message.channel.id !== WORDLE_CHANNEL_ID) return;

    if (!isWordleWin(message)) return;

    const result = await awardTicket(message.author.id, message.author.username);

    if (result.awarded) {
        await message.react('🎟️').catch(() => {});
        await message.reply({
            content: `🎉 Nice win! You've earned **1 ticket**! You now have **${result.newCount}** ticket(s).`,
            allowedMentions: { repliedUser: true }
        }).catch(() => {});
    }
};
