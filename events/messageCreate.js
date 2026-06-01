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

        // 1. Check cooldown
        const row = await db.query(
            `SELECT last_win_at FROM ${h.tables.GAMES_WORDLE} WHERE discord_id = ?`,
            [userId],
            true
        );

        if (row?.last_win_at) {
            const lastWin = new Date(row.last_win_at);
            const hoursSince = (now - lastWin) / (1000 * 60 * 60);
            if (hoursSince < COOLDOWN_HOURS) {
                return { awarded: false, reason: 'cooldown' };
            }
        }

        // 2. Atomically insert / increment ticket
        await db.query(
            `INSERT INTO ${h.tables.GAMES_WORDLE} (discord_id, ticket_count, last_win_at)
             VALUES (?, 1, ?)
             ON CONFLICT(discord_id) DO UPDATE SET
                ticket_count = ticket_count + 1,
                last_win_at = excluded.last_win_at`,
            [userId, now.toISOString()]
        );

        // 3. Read the new count
        const updated = await db.query(
            `SELECT ticket_count FROM ${h.tables.GAMES_WORDLE} WHERE discord_id = ?`,
            [userId],
            true
        );
        const newCount = updated?.ticket_count ?? 1;
        return { awarded: true, newCount };
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
