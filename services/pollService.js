// this is poll-san/services/pollService.js

const supabase = require('./supabase');
const { supabaseRetry } = require('../utils/db');
const h = require('../utils/helpers');

const CURRENT_POLL_ID = 'character_poll_new';
const UPDATE_INTERVAL = h.POLL_UPDATE_INTERVAL_MS;

let cachedPollResults = null;
let cachedPollTimestamp = 0;
const CACHE_TTL = UPDATE_INTERVAL;

let activePollTimer = null;
let realtimeChannel = null;
let currentPollMessage = null;
let currentCharacters = null;
let currentEndTime = null;

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000; // 3 seconds

// ==================== REAL-TIME SETUP WITH RETRY ====================
function setupRealtimeListeners() {
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
    }

    realtimeChannel = supabase.channel('poll-votes-realtime');

    realtimeChannel
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'votes_discord',
                filter: `poll_id=eq.${CURRENT_POLL_ID}`
            },
            handleVoteChange
        )
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'website_voting',
                filter: `poll_id=eq.${CURRENT_POLL_ID}`
            },
            handleVoteChange
        )
        .subscribe((status, err) => {
            console.log(`Realtime status: ${status}`);

            if (status === 'SUBSCRIBED') {
                console.log('✅ Supabase Realtime: Successfully listening for votes');
                reconnectAttempts = 0;
            } else if (['TIMED_OUT', 'CLOSED', 'CHANNEL_ERROR'].includes(status)) {
                console.warn(`⚠️ Realtime ${status}${err ? ': ' + err.message : ''}`);
                attemptReconnect();
            }
        });
}

function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('❌ Max realtime reconnect attempts reached. Falling back to interval only.');
        return;
    }

    reconnectAttempts++;
    console.log(`🔄 Reconnecting realtime... Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

    setTimeout(() => {
        if (currentPollMessage) {  // only reconnect if there's still an active poll
            setupRealtimeListeners();
        }
    }, RECONNECT_DELAY * reconnectAttempts); // exponential-ish backoff
}

async function handleVoteChange(payload) {
    if (!currentPollMessage || !currentCharacters) return;

    console.log(`🗳️ Realtime vote change detected → ${payload.eventType} on ${payload.table}`);

    try {
        // Force fresh DB read
        cachedPollResults = null;
        cachedPollTimestamp = 0;

        const results = await getPollResults(currentPollMessage, currentCharacters);
        const now = Date.now();
        const isFinished = now >= currentEndTime;

        const content = await generateMessageContent(currentEndTime, results, currentCharacters, isFinished);

        await currentPollMessage.edit({ content });
        console.log('✅ Poll updated successfully via realtime');
    } catch (err) {
        console.error('Error in realtime update:', err);
    }
}

// ==================== REST OF YOUR FUNCTIONS (unchanged logic) ====================

async function getPollResults(message, characters) {
    const displayResults = [];
    const rawDataForDB = [];

    if (cachedPollResults && (Date.now() - cachedPollTimestamp) < CACHE_TTL) {
        return cachedPollResults;
    }

    try {
        const { data: discordVotes } = await supabaseRetry(() =>
            supabase.from('votes_discord')
                .select('option_id, weight')
                .eq('poll_id', CURRENT_POLL_ID)
        );

        const { data: websiteVotes } = await supabaseRetry(() =>
            supabase.from('website_voting')
                .select('option_id')
                .eq('poll_id', CURRENT_POLL_ID)
        );

        const { data: winnerData } = await supabaseRetry(() =>
            supabase.from('final_votes')
                .select('option_id, selected_at')
                .eq('poll_id', CURRENT_POLL_ID)
        );

        const winnerMap = {};
        if (winnerData) {
            winnerData.forEach(row => {
                if (row.selected_at) winnerMap[row.option_id] = true;
            });
        }

        for (let i = 0; i < characters.length; i++) {
            const optionId = i + 1;
            const discordScore = discordVotes
                ? discordVotes.filter(v => v.option_id === optionId)
                    .reduce((sum, v) => sum + parseFloat(v.weight || 0), 0)
                : 0;

            const websiteScore = websiteVotes
                ? websiteVotes.filter(v => v.option_id === optionId).length
                : 0;

            const totalScore = discordScore + websiteScore;
            const rawName = characters[i].replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️');
            const isWinner = winnerMap[optionId] || false;

            let line = `${h.emojis[i]} \` ${totalScore.toFixed(2).padStart(5, ' ')} ${rawName.padEnd(30)} \` \n`;
            if (isWinner) line = `||${line}||`;

            displayResults.push(line);

            rawDataForDB.push({
                poll_id: CURRENT_POLL_ID,
                option_id: optionId,
                character_name: rawName,
                score: totalScore
            });
        }

        await supabaseRetry(() =>
            supabase.from('final_votes').upsert(rawDataForDB, { onConflict: 'poll_id,option_id' })
        );

        const resultString = displayResults.join('');
        cachedPollResults = resultString;
        cachedPollTimestamp = Date.now();
        return resultString;
    } catch (err) {
        console.error("Error calculating poll results:", err);
        return cachedPollResults || "Error loading results...";
    }
}

async function generateMessageContent(endTime, resultsText, characters, isEnded = false) {
    const e = h.releaseEmojis;
    const randomDownArrow = e.DOWN_ARROWS[Math.floor(Math.random() * e.DOWN_ARROWS.length)];

    const header = isEnded
        ? `🛑 **Poll Ended**\n\n`
        : `${e.HOURGLASS} Time remaining: **${h.formatTime(endTime - Date.now())}**\n\n`;

    const body = resultsText || characters.map((char, i) => {
        const name = char.replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️');
        return `${h.emojis[i]} \` 0.00 ${name.padEnd(30)} \` \n`;
    }).join('');

    const footer = `\nDiscord weighted vote + ${e.LINK} **[Website poll results](https://velutinx.com/poll)** (Click to vote there too!)\n\n` +
                   `${randomDownArrow} Click the thread below for character images & discussion!`;

    return header + body + footer;
}

function forceStopPoll() {
    if (activePollTimer) {
        clearInterval(activePollTimer);
        activePollTimer = null;
    }
    console.log("Poll interval cleared.");
    // We keep realtime alive in case a new poll starts soon
}

async function getFinalPollMessageContent(pollList) {
    const characters = pollList
        .split(/(?=:female_sign:|:male_sign:|♀️|♂️)/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    const resultsString = await getPollResults(null, characters);
    const e = h.releaseEmojis;
    const randomDownArrow = e.DOWN_ARROWS[Math.floor(Math.random() * e.DOWN_ARROWS.length)];

    return `🛑 **Poll has ended.**\n\n${resultsString}\n\nDiscord weighted vote + ${e.LINK} **[Website poll results](https://velutinx.com/poll)**\n\n${randomDownArrow} Click the thread below for character images & discussion!`;
}

function runPollInterval(pollMessage, endTime, characters) {
    forceStopPoll();

    currentPollMessage = pollMessage;
    currentCharacters = characters;
    currentEndTime = endTime;

    setupRealtimeListeners();

    activePollTimer = setInterval(async () => {
        const now = Date.now();
        const isFinished = now >= endTime;

        try {
            const results = await getPollResults(pollMessage, characters);
            const content = await generateMessageContent(endTime, results, characters, isFinished);
            await pollMessage.edit({ content });

            if (isFinished) {
                forceStopPoll();
                await supabaseRetry(() =>
                    supabase.from('auto_resume').delete().eq('message_id', pollMessage.id)
                );
            }
        } catch (e) {
            if (e.code === 10008) {
                forceStopPoll();
                await supabaseRetry(() =>
                    supabase.from('auto_resume').delete().eq('message_id', pollMessage.id)
                );
            } else {
                console.error("Poll interval error:", e);
            }
        }
    }, UPDATE_INTERVAL);
}

module.exports = {
    getPollResults,
    generateMessageContent,
    runPollInterval,
    getFinalPollMessageContent,
    forceStopPoll
};
