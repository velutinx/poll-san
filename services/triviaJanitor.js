// This is poll-san/services/triviaJanitor.js

const { EmbedBuilder, MessageFlags } = require('discord.js');
const supabase = require('./supabase');
const h = require('../utils/helpers');

// Use the games.trivia block from helpers
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

async function processSessionEnd(message) {
    const channelId = message.channel.id;
    const sessionData = activeSessions.get(channelId);
    if (!sessionData) return;
    activeSessions.delete(channelId);

    const embed = message.embeds[0];
    if (!embed || !embed.fields) return;

    const participants = new Map();

    for (const field of embed.fields) {
        const text = field.value;
        const lines = text.split('\n');
        for (const line of lines) {
            const mentionMatch = line.match(/<@!?(\d+)>/);
            const pointsMatch = line.match(/(\d+)\s*$/);
            if (mentionMatch && pointsMatch) {
                const userId = mentionMatch[1];
                const points = parseInt(pointsMatch[1], 10);
                participants.set(userId, (participants.get(userId) || 0) + points);
            }
        }
    }

    const resetTime = getTimeUntilReset();
    for (const [userId, points] of participants) {
        try {
            const member = await message.guild.members.fetch(userId);
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
            console.error(`Failed to process trivia award for user ${userId}:`, err);
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
        } catch (err) {
            console.error('Trivia cleanup error:', err);
        }
    }, CLEANUP_DELAY);
}

async function handleTriviaMessage(message) {
    if (message.author.id !== TRIVIA_BOT_ID) return;
    if (message.channel.id !== TRIVIA_CHANNEL_ID) return;

    const content = message.content;

    if (content.includes('Started a session with') && content.includes('rounds')) {
        const roundsMatch = content.match(/with (\d+) rounds/);
        const rounds = roundsMatch ? parseInt(roundsMatch[1], 10) : 0;
        activeSessions.set(message.channel.id, {
            startMessageId: message.id,
            rounds
        });
        return;
    }

    if (content.includes('Ranking for this session')) {
        await processSessionEnd(message);
        return;
    }
}

module.exports = { handleTriviaMessage };
