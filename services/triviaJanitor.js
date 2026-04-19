// This is poll-san/services/triviaJanitor.js

const { EmbedBuilder, MessageFlags } = require('discord.js');
const supabase = require('./supabase');
const h = require('../utils/helpers');

const TRIVIA_CONFIG = h.games?.trivia || {};
const TRIVIA_BOT_ID = TRIVIA_CONFIG.botId || h.ids?.bots?.rinbot || '429656936435286016';
const TRIVIA_CHANNEL_ID = TRIVIA_CONFIG.channelId || h.ids?.channels?.TRIVIA || '1495387346990928003';
const DAILY_TICKET_CAP = TRIVIA_CONFIG.dailyTicketCap || 10;
const CLEANUP_DELAY = TRIVIA_CONFIG.cleanupDelayMs || 15000;

const activeSessions = new Map();

async function awardTriviaTickets(userId, username, pointsEarned) {
    const today = new Date().toISOString().split('T')[0];

    const { data: dailyData, error: fetchError } = await supabase
        .from('games_trivia_daily')
        .select('tickets_earned')
        .eq('discord_id', userId)
        .eq('date', today)
        .maybeSingle();

    if (fetchError) {
        console.error('Trivia daily fetch error:', fetchError);
        return { awarded: 0, totalToday: 0, capped: false };
    }

    const currentTickets = dailyData?.tickets_earned || 0;
    const availableCap = DAILY_TICKET_CAP - currentTickets;
    const ticketsToAward = Math.min(pointsEarned, availableCap);
    const newTotal = currentTickets + ticketsToAward;

    const { error: upsertError } = await supabase
        .from('games_trivia_daily')
        .upsert({
            discord_id: userId,
            discord_username: username,
            date: today,
            tickets_earned: newTotal,
            participated: true,
            last_updated: new Date().toISOString()
        }, { onConflict: 'discord_id,date' });

    if (upsertError) console.error('Trivia daily upsert error:', upsertError);

    if (ticketsToAward > 0) {
        const { error: addError } = await supabase
            .rpc('add_tickets', { user_id: userId, amount: ticketsToAward });
        if (addError) console.error('Trivia ticket add error:', addError);
    }

    return {
        awarded: ticketsToAward,
        totalToday: newTotal,
        capped: ticketsToAward < pointsEarned
    };
}

function getTimeUntilReset() {
    const now = new Date();
    const reset = new Date(now);
    reset.setUTCHours(24, 0, 0, 0);
    const msUntilReset = reset - now;
    const hours = Math.floor(msUntilReset / (1000 * 60 * 60));
    const minutes = Math.floor((msUntilReset % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
}

/**
 * Parse ranking from embed fields.
 * Format: ":first_place: Username points (time)" or ":second_place: Username points (time)"
 */
function parseRankingFromEmbed(embed) {
    const participants = new Map();
    if (!embed || !embed.fields) return participants;

    for (const field of embed.fields) {
        const text = field.value;
        const lines = text.split('\n');
        for (const line of lines) {
            // Match pattern: ":emoji: Username points (time)"
            const match = line.match(/<a?:[^:]+:\d+>|:[^:]+:|\*\*.*?\*\*|__.*?__/g); // skip emoji extraction, focus on points
            const pointsMatch = line.match(/(\d+)\s*\([\d:.]+\)/); // points before time in parentheses
            if (pointsMatch) {
                const points = parseInt(pointsMatch[1], 10);
                // Extract username: everything between emoji/prefix and the points number
                const usernamePart = line.replace(/<a?:[^:]+:\d+>|:[^:]+:/g, '').trim();
                const username = usernamePart.split(/\s*\d+\s*\(/)[0].trim();
                
                // Try to get user ID from mention, if not present we'll need to fetch by username
                const mentionMatch = line.match(/<@!?(\d+)>/);
                if (mentionMatch) {
                    participants.set(mentionMatch[1], points);
                } else {
                    // No mention, store username for later resolution (will attempt to find member by display name)
                    participants.set(username, points);
                }
            }
        }
    }
    return participants;
}

async function resolveUsernameToMember(guild, username) {
    // Try to find member by display name or username (case-insensitive)
    const members = await guild.members.fetch();
    return members.find(m => 
        m.displayName.toLowerCase() === username.toLowerCase() ||
        m.user.username.toLowerCase() === username.toLowerCase()
    );
}

async function processSessionEnd(message) {
    console.log(`[Trivia] Processing session end in channel ${message.channel.id}`);
    const channelId = message.channel.id;
    const sessionData = activeSessions.get(channelId);
    if (!sessionData) {
        console.log('[Trivia] No active session found for this channel');
        return;
    }
    activeSessions.delete(channelId);

    const embed = message.embeds[0];
    if (!embed || !embed.fields) {
        console.log('[Trivia] No embed or fields found in ranking message');
        return;
    }

    const participants = parseRankingFromEmbed(embed);
    console.log(`[Trivia] Parsed participants:`, [...participants.entries()]);

    const resetTime = getTimeUntilReset();
    for (const [identifier, points] of participants) {
        try {
            let userId, member;
            if (/^\d+$/.test(identifier)) {
                userId = identifier;
                member = await message.guild.members.fetch(userId);
            } else {
                // Resolve by username
                member = await resolveUsernameToMember(message.guild, identifier);
                userId = member?.id;
                if (!userId) {
                    console.log(`[Trivia] Could not find user: ${identifier}`);
                    continue;
                }
            }

            const result = await awardTriviaTickets(userId, member.user.username, points);

            let dmContent = '';
            if (result.awarded > 0) {
                dmContent = `${h.releaseEmojis.CONFETTI} You earned **${result.awarded} ticket(s)** from trivia! You now have **${result.totalToday}/10** tickets today.\n`;
            } else {
                dmContent = `ℹ️ You participated in trivia but have already reached the daily cap of 10 tickets.\n`;
            }
            dmContent += `🕒 Daily cap resets in **${resetTime}**.`;

            try {
                await member.send(dmContent);
            } catch {
                const tempMsg = await message.channel.send({ content: `<@${userId}> ${dmContent}` });
                setTimeout(() => tempMsg.delete().catch(() => {}), 10000);
            }
        } catch (err) {
            console.error(`Failed to process trivia award for ${identifier}:`, err);
        }
    }

    // Cleanup messages from session start to ranking
    setTimeout(async () => {
        try {
            const channel = message.channel;
            const startId = sessionData.startMessageId;
            const endId = message.id;

            let lastId = endId;
            while (true) {
                const messages = await channel.messages.fetch({ limit: 100, before: lastId });
                if (messages.size === 0) break;

                const toDelete = messages.filter(m => m.id >= startId && m.author.id === TRIVIA_BOT_ID);
                for (const [, msg] of toDelete) {
                    await msg.delete().catch(() => {});
                }

                const oldest = messages.last();
                if (oldest.id <= startId) break;
                lastId = oldest.id;
            }

            await message.delete().catch(() => {});
            console.log(`[Trivia] Cleaned up session messages in ${channel.id}`);
        } catch (err) {
            console.error('Trivia cleanup error:', err);
        }
    }, CLEANUP_DELAY);
}

async function handleTriviaMessage(message) {
    if (message.author.id !== TRIVIA_BOT_ID) return;
    if (message.channel.id !== TRIVIA_CHANNEL_ID) return;

    const content = message.content || '';
    const embedTitle = message.embeds[0]?.title || '';
    const embedDescription = message.embeds[0]?.description || '';

    // Session start detection (check both content and embed)
    if (content.includes('Started a session with') || embedTitle.includes('Started a session')) {
        const roundsMatch = content.match(/with (\d+) rounds/) || embedDescription.match(/with (\d+) rounds/);
        const rounds = roundsMatch ? parseInt(roundsMatch[1], 10) : 0;
        activeSessions.set(message.channel.id, {
            startMessageId: message.id,
            rounds
        });
        console.log(`[Trivia] Session started with ${rounds} rounds in ${message.channel.id}`);
        return;
    }

    // Session end detection (check content, embed title, or description)
    if (content.includes('Ranking for this session') || 
        embedTitle.includes('Ranking for this session') ||
        embedDescription.includes('Ranking for this session')) {
        console.log(`[Trivia] Detected ranking message in ${message.channel.id}`);
        await processSessionEnd(message);
        return;
    }
}

module.exports = { handleTriviaMessage };
