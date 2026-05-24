// services/checkinHandler.js
const supabase = require('./supabase');
const helpers = require('../utils/helpers');

const checkinSessions = new Map();

function buildSuccessMessage(ticketAmount, newBalance) {
    return `${helpers.releaseEmojis?.getRandomVerify?.() || '✅'} **Daily Check-In Successful!**\n\n` +
           `You received **${ticketAmount} tickets**! New balance: **${newBalance}** ${helpers.releaseEmojis?.TICKET || '🎫'}\n` +
           `Your Wordle, Hangman, and Trivia cooldowns have been reset.\n` +
           `Your Hangman ticket cooldown has also been reset – you can earn another ticket immediately!`;
}

async function handleCheckinClaim(interaction) {
    const userId = interaction.user.id;
    const gameKey = `${userId}-${interaction.channel.id}`;
    const cooldownMap = global.checkinCooldown || new Map();
    if (!global.checkinCooldown) global.checkinCooldown = cooldownMap;
    const lastClick = cooldownMap.get(userId);
    if (lastClick && Date.now() - lastClick < 2000) {
        return;
    }
    cooldownMap.set(userId, Date.now());

    try {
        await interaction.deferUpdate();
    } catch {
        return;
    }

    let finalContent = '';
    let { data: userData, error } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) console.error('Fetch error:', error);

    const now = new Date();
    let canClaim = true;
    let timeLeft = '';

    if (userData?.last_checkin) {
        const diffHours = (now - new Date(userData.last_checkin)) / (1000 * 60 * 60);
        if (diffHours < 24) {
            canClaim = false;
            const remainingMs = 24 * 60 * 60 * 1000 - (now - new Date(userData.last_checkin));
            timeLeft = `${Math.floor(remainingMs / (1000 * 60 * 60))}h ${Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60))}m`;
        }
    }

    if (!canClaim) {
        finalContent = `${helpers.releaseEmojis?.HOURGLASS || '⏳'} You already claimed your daily reward! Come back in **${timeLeft}**.`;
    } else {
        const ticketAmount = helpers.CHECKIN_REWARD_TICKETS;
        const currentTickets = userData?.tickets || 0;
        const newBalance = currentTickets + ticketAmount;
        const nowIso = now.toISOString();
        const discordUsername = interaction.user.tag;
        const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;

        const updatePayload = {
            tickets: newBalance,
            last_checkin: nowIso,
            wordle_last_played: null,
            hangman_last_played: null,
            trivia_last_played: null,
            updated_at: nowIso,
            discord_username: discordUsername,
            display_name: displayName,
            reminder_sent: false
        };

        if (userData) {
            const { error: updateError } = await supabase
                .from(helpers.tables.GAMES_USER_DATA)
                .update(updatePayload)
                .eq('user_id', userId);
            if (updateError) console.error('Update error:', updateError);
            else finalContent = buildSuccessMessage(ticketAmount, newBalance);
        } else {
            const { error: insertError } = await supabase
                .from(helpers.tables.GAMES_USER_DATA)
                .insert({ user_id: userId, ...updatePayload });
            if (insertError) console.error('Insert error:', insertError);
            else finalContent = buildSuccessMessage(ticketAmount, newBalance);
        }

        if (finalContent === '') {
            finalContent = `${helpers.releaseEmojis?.BATSU || '❌'} Database error.`;
        } else {
            try {
                await supabase
                    .from(helpers.tables.GAMES_COOLDOWNS)
                    .delete()
                    .eq('discord_id', userId)
                    .eq('game_type', 'hangman');
            } catch (err) {
                console.error('Cooldown delete error:', err);
            }
        }
    }

    // Delete previous ephemeral message if exists
    const session = checkinSessions.get(gameKey);
    if (session && Date.now() - session.timestamp < 14 * 60 * 1000) {
        try {
            await session.interaction.webhook.deleteMessage(session.messageId);
        } catch {}
    }

    try {
        const sentMsg = await interaction.followUp({
            content: finalContent,
            ephemeral: true,
            fetchReply: true
        });
        checkinSessions.set(gameKey, {
            interaction,
            messageId: sentMsg.id,
            timestamp: Date.now()
        });
    } catch (err) {
        console.error('Failed to send followUp for check-in:', err.message);
    }

    setTimeout(() => cooldownMap.delete(userId), 2000);
}

module.exports = { handleCheckinClaim };
