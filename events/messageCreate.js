// events/messageCreate.js
const { MessageFlags } = require('discord.js');
const db = require('../services/database');
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
        const now = new Date();

        // 1. Check cooldown from games_user_data
        const userData = await db.query(
            `SELECT wordle_last_played, tickets FROM ${h.tables.GAMES_USER_DATA} WHERE user_id = ?`,
            [userId],
            true
        );

        if (userData?.wordle_last_played) {
            const lastPlayed = new Date(userData.wordle_last_played);
            const hoursSince = (now - lastPlayed) / (1000 * 60 * 60);
            if (hoursSince < COOLDOWN_HOURS) {
                return { awarded: false, reason: 'cooldown' };
            }
        }

        // 2. Increment tickets atomically
        const currentTickets = userData?.tickets ?? 0;
        const newTickets = currentTickets + 1;

        await db.query(
            `INSERT INTO ${h.tables.GAMES_USER_DATA} (user_id, tickets, wordle_last_played, discord_username, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
                 tickets = excluded.tickets,
                 wordle_last_played = excluded.wordle_last_played,
                 discord_username = excluded.discord_username,
                 updated_at = excluded.updated_at`,
            [userId, newTickets, now.toISOString(), username, now.toISOString()]
        );

        return { awarded: true, newCount: newTickets };
    } catch (error) {
        console.error('Ticket award error:', error);
        return { awarded: false, reason: 'error' };
    }
}

module.exports = async (message) => {
    if (
        message.author.id === WORDLE_BOT_ID ||
        message.applicationId === WORDLE_BOT_ID ||
        message.author.id === WORDLE_ACTIVITY_APP_ID ||
        message.applicationId === WORDLE_ACTIVITY_APP_ID
    ) {
        if (message.channel.id === WORDLE_CHANNEL_ID) {
            setTimeout(() => message.delete().catch(() => {}), 1500);
        }
        return;
    }

    if (message.author.bot && message.author.id !== WORDLE_BOT_ID) return;
    if (message.channel.id !== WORDLE_CHANNEL_ID) return;
    if (!isWordleWin(message)) return;

    const result = await awardTicket(message.author.id, message.author.username);
    if (!result.awarded) return;
    
    await message.react(h.releaseEmojis?.TICKET || '🎟️').catch(() => {});

    setTimeout(() => {
        message.delete().catch(() => {});
    }, 2000);

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
            avatarURL: h.urls.LOGO_URL,
            flags: [MessageFlags.SuppressNotifications]
        });

        if (notifyMsg) {
            setTimeout(() => notifyMsg.delete().catch(() => {}), 8000);
        }
    } catch (err) {
        console.error('Webhook notification error:', err);
    }
};
