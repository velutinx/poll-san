// services/cooldownNotifier.js
const supabase = require('./supabase');
const h = require('../utils/helpers');

const COOLDOWN_HOURS = 24;
const GAME_TYPE = 'hangman';
const HANGMAN_CHANNEL_ID = h.games.hangman.channelId;

async function checkAndNotifyCooldowns(client) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - COOLDOWN_HOURS * 60 * 60 * 1000);

    const { data: users, error } = await supabase
        .from(h.tables.GAMES_COOLDOWNS)
        .select('discord_id, discord_username')
        .eq('game_type', GAME_TYPE)
        .eq('notified_reset', false)
        .lt('last_win_at', cutoff.toISOString());

    if (error) {
        h.logSupabaseError('CooldownNotifier', error);
        return;
    }

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

            await supabase
                .from(h.tables.GAMES_COOLDOWNS)
                .update({ notified_reset: true, updated_at: now.toISOString() })
                .eq('discord_id', user.discord_id)
                .eq('game_type', GAME_TYPE);
        } catch (err) {
            console.error(`Failed to process user ${user.discord_id}:`, err.message);
            await supabase
                .from(h.tables.GAMES_COOLDOWNS)
                .update({ notified_reset: true, updated_at: now.toISOString() })
                .eq('discord_id', user.discord_id)
                .eq('game_type', GAME_TYPE);
        }
    }
}

module.exports = { checkAndNotifyCooldowns };
