// This is poll-san/services/triviaJanitor.js

const { EmbedBuilder, MessageFlags } = require('discord.js');
const supabase = require('./supabase');
const h = require('../utils/helpers');

const TRIVIA_CONFIG = h.games?.trivia || {};
const TRIVIA_BOT_ID = TRIVIA_CONFIG.botId || h.ids?.bots?.rinbot || '429656936435286016';
const TRIVIA_CHANNEL_ID = TRIVIA_CONFIG.channelId || h.ids?.channels?.TRIVIA || '1495387346990928003';
const DAILY_TICKET_CAP = TRIVIA_CONFIG.dailyTicketCap || 10;
const CLEANUP_DELAY = TRIVIA_CONFIG.cleanupDelayMs || 30000;

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

function parseRankingFromEmbed(embed) {
    const participants = new Map();
    if (!embed) return participants;

    const textSources = [];
    if (embed.description) textSources.push(embed.description);
    if (embed.fields) {
        for (const field of embed.fields) {
            textSources.push(field.value);
        }
    }

    const allText = textSources.join('\n');
    console.log('[Trivia] Parsing text:', allText.substring(0, 200));

    const lines = allText.split('\n');
    for (const line of lines) {
        if (!line.match(/[:*].+[:*]|\d+\s*\([\d:.]+\)/)) continue;

        const pointsMatch = line.match(/(\d+)\s*\([\d:.]+\)/);
        if (!pointsMatch) continue;
        const points = parseInt(pointsMatch[1], 10);

        let usernamePart = line
            .replace(/<a?:[^:]+:\d+>|:[^:]+:/g, '')
            .replace(/\*\*.*?\*\*/g, '')
            .replace(/__.*?__/g, '')
            .trim();

        usernamePart = usernamePart.split(/\s*\d+\s*\(/)[0].trim();

        const mentionMatch = line.match(/<@!?(\d+)>/);
        if (mentionMatch) {
            participants.set(mentionMatch[1], { points, username: usernamePart });
        } else {
            participants.set(usernamePart, { points, username: usernamePart });
        }
    }

    console.log('[Trivia] Parsed participants:', [...participants.entries()].map(([k, v]) => `${k} -> ${v.points}`));
    return participants;
}

async function resolveUsernameToMember(guild, username) {
    try {
        const members = await guild.members.fetch();
        const member = members.find(m =>
            m.displayName.toLowerCase() === username.toLowerCase() ||
            m.user.username.toLowerCase() === username.toLowerCase()
        );
        return member;
    } catch (err) {
        console.error('Error fetching members:', err);
        return null;
    }
}




async function cleanupSessionMessages(message, sessionData) {
    try {
        const channel = message.channel;
        const startId = sessionData.startMessageId;
        const endId = message.id;

        // Collect all message IDs to delete
        const messageIdsToDelete = [endId]; // Include ranking message itself
        let lastId = endId;

        while (true) {
            const messages = await channel.messages.fetch({ limit: 100, before: lastId });
            if (messages.size === 0) break;

            for (const [id, msg] of messages) {
                if (id < startId) {
                    // We've passed the start of the session
                    break;
                }
                if (msg.author.id === TRIVIA_BOT_ID) {
                    messageIdsToDelete.push(id);
                }
            }

            const oldest = messages.last();
            if (oldest.id <= startId) break;
            lastId = oldest.id;
        }

        console.log(`[Trivia] Attempting to delete ${messageIdsToDelete.length} messages`);

        // Discord allows bulk deletion of up to 100 messages at a time, and only messages under 14 days old.
        // We'll chunk the IDs into groups of 100 and use bulkDelete.
        const chunkSize = 100;
        for (let i = 0; i < messageIdsToDelete.length; i += chunkSize) {
            const chunk = messageIdsToDelete.slice(i, i + chunkSize);
            try {
                const deleted = await channel.bulkDelete(chunk, true);
                console.log(`[Trivia] Bulk deleted ${deleted.size} messages`);
            } catch (bulkErr) {
                // Fallback to individual deletion if bulk fails (e.g., messages too old)
                console.warn('[Trivia] Bulk delete failed, falling back to individual:', bulkErr.message);
                for (const id of chunk) {
                    try {
                        const msg = await channel.messages.fetch(id);
                        await msg.delete();
                    } catch (err) {
                        // Message already deleted or not found
                    }
                }
            }
            // Small delay between bulk delete calls to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`[Trivia] Cleaned up session messages in ${channel.id}`);
    } catch (err) {
        console.error('Trivia cleanup error:', err);
    }
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
    if (!embed) {
        console.log('[Trivia] No embed found in ranking message');
        return;
    }

    const participants = parseRankingFromEmbed(embed);
    if (participants.size === 0) {
        console.log('[Trivia] No participants parsed from embed');
        setTimeout(() => cleanupSessionMessages(message, sessionData), CLEANUP_DELAY);
        return;
    }

    const resetTime = getTimeUntilReset();
    for (const [identifier, data] of participants) {
        try {
            let userId, member;
            const points = data.points;

            if (/^\d+$/.test(identifier)) {
                userId = identifier;
                member = await message.guild.members.fetch(userId).catch(() => null);
            } else {
                member = await resolveUsernameToMember(message.guild, identifier);
                userId = member?.id;
            }

            if (!userId || !member) {
                console.log(`[Trivia] Could not resolve user: ${identifier}`);
                continue;
            }

            const result = await awardTriviaTickets(userId, member.user.username, points);

            let dmContent = '';
            if (result.awarded > 0) {
                dmContent = `${h.releaseEmojis.CONFETTI} You earned **${result.awarded} ticket(s)** from trivia! You now have **${result.totalToday}/${DAILY_TICKET_CAP}** tickets today.\n`;
            } else {
                dmContent = `ℹ️ You participated in trivia but have already reached the daily cap of ${DAILY_TICKET_CAP} tickets.\n`;
            }
            dmContent += `🕒 Daily cap resets in **${resetTime}**.`;

            try {
                await member.send(dmContent);
            } catch {
                const tempMsg = await message.channel.send({ content: `<@${userId}> ${dmContent}` });
                setTimeout(() => tempMsg.delete().catch(() => {}), 10000);
            }

            console.log(`[Trivia] Awarded ${result.awarded} tickets to ${member.user.username} (${userId})`);
        } catch (err) {
            console.error(`Failed to process trivia award for ${identifier}:`, err);
        }
    }

    setTimeout(() => cleanupSessionMessages(message, sessionData), CLEANUP_DELAY);
}

async function handleTriviaMessage(message) {
    if (message.author.id !== TRIVIA_BOT_ID) return;
    if (message.channel.id !== TRIVIA_CHANNEL_ID) return;

    const content = message.content || '';
    const embedTitle = message.embeds[0]?.title || '';
    const embedDescription = message.embeds[0]?.description || '';

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

    if (content.includes('Ranking for this session') || 
        embedTitle.includes('Ranking for this session') ||
        embedDescription.includes('Ranking for this session')) {
        console.log(`[Trivia] Detected ranking message in ${message.channel.id}`);
        await processSessionEnd(message);
        return;
    }
}

module.exports = { handleTriviaMessage };
