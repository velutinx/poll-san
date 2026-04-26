// services/cooldownNotifier.js

const supabase = require('./supabase');
const h = require('../utils/helpers');

const COOLDOWN_HOURS = 24;
const GAME_TYPE = 'hangman';

async function checkAndNotifyCooldowns(client) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - COOLDOWN_HOURS * 60 * 60 * 1000);

    const { data: users, error } = await supabase
        .from(h.tables.GAMES_COOLDOWNS)   // 👈 changed
        .select('discord_id, discord_username')
        .eq('game_type', GAME_TYPE)
        .eq('notified_reset', false)
        .lt('last_win_at', cutoff.toISOString());

    if (error) {
        console.error('Cooldown notify fetch error:', error);
        return;
    }

    for (const user of users) {
        try {
            const discordUser = await client.users.fetch(user.discord_id);
            await discordUser.send(`${h.releaseEmojis.CONFETTI} Your **Hangman** ticket cooldown has reset! You can now earn another ticket by winning a game.`);
            
            await supabase
                .from(h.tables.GAMES_COOLDOWNS)   // 👈 changed
                .update({ notified_reset: true, updated_at: now.toISOString() })
                .eq('discord_id', user.discord_id)
                .eq('game_type', GAME_TYPE);
        } catch (err) {
            console.error(`Failed to notify user ${user.discord_id} (${user.discord_username}):`, err.message);
            await supabase
                .from(h.tables.GAMES_COOLDOWNS)   // 👈 changed (third occurrence)
                .update({ notified_reset: true, updated_at: now.toISOString() })
                .eq('discord_id', user.discord_id)
                .eq('game_type', GAME_TYPE);
        }
    }
}

module.exports = { checkAndNotifyCooldowns };
