// This is poll-san/services/triviaJanitor.js

const { EmbedBuilder, MessageFlags } = require('discord.js');
const supabase = require('./supabase');
const h = require('../utils/helpers');

const TRIVIA_CONFIG = h.games?.trivia || {};
const TRIVIA_BOT_ID = TRIVIA_CONFIG.botId || h.ids?.bots?.rinbot || '429656936435286016';
const TRIVIA_CHANNEL_ID = TRIVIA_CONFIG.channelId || h.ids?.channels?.TRIVIA || '1495387346990928003';
const DAILY_TICKET_CAP = TRIVIA_CONFIG.dailyTicketCap || 10;
const CLEANUP_DELAY = 60000; // 1 minute
const WHITELISTED_MESSAGE_ID = '1495466224476360754'; // The message with the repeat button

// Track the highest score per user per day (in memory as backup, but DB is source of truth)
const dailyHighScores = new Map(); // key: userId, value: highest points today

/**
 * Update the daily high score for a user.
 * Only keeps the highest score seen so far for the day.
 */
async function updateDailyHighScore(userId, username, points) {
    const today = new Date().toISOString().split('T')[0];

    // Fetch current high score for today
    const { data: dailyData, error: fetchError } = await supabase
        .from('games_trivia_daily')
        .select('highest_score')
        .eq('discord_id', userId)
        .eq('date', today)
        .maybeSingle();

    if (fetchError) {
        console.error('Trivia high score fetch error:', fetchError);
        return;
    }

    const currentHigh = dailyData?.highest_score || 0;
    const newHigh = Math.max(currentHigh, points);

    if (newHigh > currentHigh) {
        const { error: upsertError } = await supabase
            .from('games_trivia_daily')
            .upsert({
                discord_id: userId,
                discord_username: username,
                date: today,
                highest_score: newHigh,
                participated: true,
                last_updated: new Date().toISOString()
            }, { onConflict: 'discord_id,date' });

        if (upsertError) console.error('Trivia high score upsert error:', upsertError);
        else console.log(`[Trivia] Updated high score for ${username}: ${newHigh}`);
    }
}

/**
 * Award tickets based on the highest score of the day (capped).
 * Called at end of day or when user requests.
 */
async function awardTicketsFromHighScore(userId, username) {
    const today = new Date().toISOString().split('T')[0];

    const { data: dailyData, error: fetchError } = await supabase
        .from('games_trivia_daily')
        .select('highest_score, tickets_awarded')
        .eq('discord_id', userId)
        .eq('date', today)
        .maybeSingle();

    if (fetchError || !dailyData) return;

    const highScore = dailyData.highest_score || 0;
    const alreadyAwarded = dailyData.tickets_awarded || 0;

    if (alreadyAwarded) return; // Already awarded for today

    const ticketsToAward = Math.min(highScore, DAILY_TICKET_CAP);
    if (ticketsToAward <= 0) return;

    const { error: addError } = await supabase
        .rpc('add_tickets', { user_id: userId, amount: ticketsToAward });

    if (addError) {
        console.error('Trivia ticket award error:', addError);
        return;
    }

    await supabase
        .from('games_trivia_daily')
        .update({ tickets_awarded: ticketsToAward })
        .eq('discord_id', userId)
        .eq('date', today);

    // Notify user
    const user = await client.users.fetch(userId).catch(() => null);
    if (user) {
        const dmMessage = `${h.releaseEmojis.CONFETTI} Your daily trivia high score was **${highScore}**! You've earned **${ticketsToAward}** ticket(s) (capped at ${DAILY_TICKET_CAP}).`;
        try {
            await user.send(dmMessage);
        } catch {
            // ignore
        }
    }
    console.log(`[Trivia] Awarded ${ticketsToAward} tickets to ${username} (high score: ${highScore})`);
}

/**
 * Parse round result messages to extract points.
 * Examples:
 *   "Velutinx has won! ... 9 points were gained"
 *   "No one guessed right" (no points)
 */
function extractPointsFromContent(content) {
    const pointsMatch = content.match(/(\d+)\s+points?\s+were\s+gained/i);
    return pointsMatch ? parseInt(pointsMatch[1], 10) : 0;
}

function extractWinnerUsername(content) {
    const winMatch = content.match(/(.+?)\s+has\s+won!/i);
    return winMatch ? winMatch[1].trim() : null;
}

async function handleTriviaMessage(message) {
    if (message.author.id !== TRIVIA_BOT_ID) return;
    if (message.channel.id !== TRIVIA_CHANNEL_ID) return;
    if (message.id === WHITELISTED_MESSAGE_ID) return; // Never delete the button message

    // Schedule deletion for all other RinBot messages
    setTimeout(() => {
        message.delete().catch(() => {});
    }, CLEANUP_DELAY);

    const content = message.content || '';

    // Detect a round result: either someone won or nobody guessed right
    if (content.includes('has won!') || content.includes('No one guessed right')) {
        const points = extractPointsFromContent(content);
        const winnerUsername = extractWinnerUsername(content);

        if (winnerUsername && points > 0) {
            // Find the member by username
            const member = await resolveUsernameToMember(message.guild, winnerUsername);
            if (member) {
                await updateDailyHighScore(member.id, member.user.username, points);
            }
        }
        // If no winner or zero points, do nothing
    }
}

async function resolveUsernameToMember(guild, username) {
    try {
        const members = await guild.members.fetch();
        return members.find(m =>
            m.displayName.toLowerCase() === username.toLowerCase() ||
            m.user.username.toLowerCase() === username.toLowerCase()
        );
    } catch (err) {
        console.error('Error fetching members:', err);
        return null;
    }
}

// End-of-day awards: run this periodically (e.g., every hour) to award tickets for yesterday
async function processEndOfDayAwards(client) {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    const { data: records, error } = await supabase
        .from('games_trivia_daily')
        .select('discord_id, discord_username, highest_score')
        .eq('date', dateStr)
        .is('tickets_awarded', null);

    if (error || !records) return;

    for (const record of records) {
        const userId = record.discord_id;
        const username = record.discord_username;
        const highScore = record.highest_score || 0;
        const ticketsToAward = Math.min(highScore, DAILY_TICKET_CAP);

        if (ticketsToAward > 0) {
            await supabase.rpc('add_tickets', { user_id: userId, amount: ticketsToAward });
            await supabase
                .from('games_trivia_daily')
                .update({ tickets_awarded: ticketsToAward })
                .eq('discord_id', userId)
                .eq('date', dateStr);

            const user = await client.users.fetch(userId).catch(() => null);
            if (user) {
                const dmMessage = `${h.releaseEmojis.CONFETTI} Your trivia high score for yesterday was **${highScore}**! You've earned **${ticketsToAward}** ticket(s).`;
                try {
                    await user.send(dmMessage);
                } catch {}
            }
        }
    }
}

module.exports = { handleTriviaMessage, processEndOfDayAwards };
