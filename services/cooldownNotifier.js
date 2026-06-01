// services/cooldownNotifier.js
const db = require('./database');
const h = require('../utils/helpers');

const COOLDOWN_HOURS = 24;
const GAME_TYPE = 'hangman';
const HANGMAN_CHANNEL_ID = h.games.hangman.channelId;

async function checkAndNotifyCooldowns(client) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - COOLDOWN_HOURS * 60 * 60 * 1000);

    let users;
    try {
        users = await db.query(
            `SELECT discord_id, discord_username
             FROM ${h.tables.GAMES_COOLDOWNS}
             WHERE game_type = ?
               AND notified_reset = 0
               AND last_win_at < ?`,
            [GAME_TYPE, cutoff.toISOString()]
        );
    } catch (err) {
        console.error('[CooldownNotifier] Fetch error:', err.message);
        return;
    }

    if (!users || users.length === 0) return;

    const channel = client.channels.cache.get(HANGMAN_CHANNEL_ID);
    if (!channel) {
        console.error('Hangman channel not found.');
        return;
    }

    for (const user of users) {
        try {
            const notifyMsg = await channel.send({
                content: `${h.releaseEmojis?.CONFETTI || '🎉'} <@${user.discord_id}>, your **Hangman** ticket cooldown has reset! You can now earn another ticket by winning a game.`,
                allowedMentions: { users: [user.discord_id] }
            }).catch(err => console.error(`Failed to send channel notification to ${user.discord_id}:`, err.message));

            if (notifyMsg) {
                setTimeout(() => notifyMsg.delete().catch(() => {}), 15_000);
            }

            try {
                await db.query(
                    `UPDATE ${h.tables.GAMES_COOLDOWNS}
                     SET notified_reset = 1, updated_at = ?
                     WHERE discord_id = ? AND game_type = ?`,
                    [now.toISOString(), user.discord_id, GAME_TYPE]
                );
            } catch (err) {
                console.error(`Failed to update cooldown for user ${user.discord_id}:`, err.message);
                try {
                    await db.query(
                        `UPDATE ${h.tables.GAMES_COOLDOWNS}
                         SET notified_reset = 1, updated_at = ?
                         WHERE discord_id = ? AND game_type = ?`,
                        [now.toISOString(), user.discord_id, GAME_TYPE]
                    );
                } catch (err2) {
                    console.error(`Second attempt failed for user ${user.discord_id}:`, err2.message);
                }
            }
        } catch (err) {
            console.error(`Failed to process user ${user.discord_id}:`, err.message);
        }
    }
}

module.exports = { checkAndNotifyCooldowns };
