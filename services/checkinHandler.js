// services/checkinHandler.js
const db = require('./database');
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
    let userData = null;

    // Fetch user data from D1
    try {
        userData = await db.query(
            `SELECT * FROM ${helpers.tables.GAMES_USER_DATA} WHERE user_id = ?`,
            [userId],
            true   // single row
        );
    } catch (err) {
        console.error('Fetch error:', err.message);
    }

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

        if (userData) {
            // Update existing row
            try {
                await db.query(
                    `UPDATE ${helpers.tables.GAMES_USER_DATA}
                     SET tickets = ?,
                         last_checkin = ?,
                         wordle_last_played = NULL,
                         hangman_last_played = NULL,
                         trivia_last_played = NULL,
                         updated_at = ?,
                         discord_username = ?,
                         display_name = ?,
                         reminder_sent = 0
                     WHERE user_id = ?`,
                    [newBalance, nowIso, nowIso, discordUsername, displayName, userId]
                );
                finalContent = buildSuccessMessage(ticketAmount, newBalance);
            } catch (err) {
                console.error('Update error:', err.message);
                finalContent = `${helpers.releaseEmojis?.BATSU || '❌'} Database error.`;
            }
        } else {
            // Insert new row
            try {
                await db.query(
                    `INSERT INTO ${helpers.tables.GAMES_USER_DATA}
                     (user_id, tickets, last_checkin, wordle_last_played, hangman_last_played, trivia_last_played, updated_at, discord_username, display_name, reminder_sent)
                     VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, 0)`,
                    [userId, newBalance, nowIso, nowIso, discordUsername, displayName]
                );
                finalContent = buildSuccessMessage(ticketAmount, newBalance);
            } catch (err) {
                console.error('Insert error:', err.message);
                finalContent = `${helpers.releaseEmojis?.BATSU || '❌'} Database error.`;
            }
        }

        // Delete hangman cooldown
        if (finalContent && !finalContent.includes('Database error')) {
            try {
                await db.query(
                    `DELETE FROM ${helpers.tables.GAMES_COOLDOWNS}
                     WHERE discord_id = ? AND game_type = ?`,
                    [userId, 'hangman']
                );
            } catch (err) {
                console.error('Cooldown delete error:', err.message);
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
