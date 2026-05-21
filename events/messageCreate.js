// events/messageCreate.js
const supabase = require('../services/supabase');
const h = require('../utils/helpers');

const {
    botId: WORDLE_BOT_ID,
    channelId: WORDLE_CHANNEL_ID,
    cooldownHours: COOLDOWN_HOURS,
    winPattern: WORDLE_WIN_PATTERN,
    activityAppId: WORDLE_ACTIVITY_APP_ID
} = h.games.wordle;

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
            .from(h.tables.GAMES_WORDLE)
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
    if (message.author.id === WORDLE_ACTIVITY_APP_ID) {
        if (message.channel.id === WORDLE_CHANNEL_ID) {
            message.delete().catch(() => {});
        }
        return;
    }

    if (message.author.id === WORDLE_BOT_ID) {
        if (message.channel.id !== WORDLE_CHANNEL_ID) return;
        const content = message.content.toLowerCase();
        if (content.includes('congratulations! you\'ve unlocked an achievement') ||
            content.includes('here is the faq page')) {
            setTimeout(() => message.delete().catch(() => {}), 1500);
            return;
        }
    }

    if (message.author.bot && message.author.id !== WORDLE_BOT_ID) return;
    if (message.channel.id !== WORDLE_CHANNEL_ID) return;

    if (!isWordleWin(message)) return;

    const result = await awardTicket(message.author.id, message.author.username);
    if (!result.awarded) return;

    await message.react(h.releaseEmojis?.TICKET || '🎟️').catch(() => {});

    setTimeout(() => {
        message.delete().catch(() => {});
    }, 2000); // change back to 2000

    const notifyText = `${h.releaseEmojis?.CONFETTI || '🎉'} Nice win, <@${message.author.id}>! You earned **1 ticket**! You now have **${result.newCount}** ticket(s).`;

    try {
        let rewardWebhook = (await message.channel.fetchWebhooks())
            .find(w => w.name === 'Rewards');

        if (!rewardWebhook) {
            rewardWebhook = await message.channel.createWebhook({
                name: 'Rewards',
                avatar: h.urls.LOGO_URL
            });
        }

        const notifyMsg = await rewardWebhook.send({
            content: notifyText,
            allowedMentions: { users: [message.author.id] },
            username: 'Rewards',
            avatarURL: h.urls.LOGO_URL
        });

        if (notifyMsg) {
            setTimeout(() => notifyMsg.delete().catch(() => {}), 8000); // change back to 8000
        }
    } catch (err) {
        console.error('Webhook notification error:', err);
    }
};
