// this is poll-san/services/pollService.js

const supabase = require('./supabase');
const { supabaseRetry } = require('../utils/db');
const h = require('../utils/helpers');

const CURRENT_POLL_ID = 'character_poll_new';
const UPDATE_INTERVAL = h.POLL_UPDATE_INTERVAL_MS;

let cachedPollResults = null;
let cachedPollTimestamp = 0;
const CACHE_TTL = 3000; // 3 seconds - good balance with realtime

let activePollTimer = null;
let realtimeChannel = null;
let currentPollMessage = null;
let currentCharacters = null;
let currentEndTime = null;

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 8;
const BASE_RECONNECT_DELAY = 1500;

// ==================== DASHBOARD REFRESH CALLBACK ====================
let dashboardRefreshCallback = null;

function setDashboardRefreshCallback(callback) {
    if (typeof callback === 'function') {
        dashboardRefreshCallback = callback;
        console.log('✅ Dashboard refresh callback registered');
    }
}

async function refreshDashboard() {
    if (typeof dashboardRefreshCallback === 'function') {
        try {
            await dashboardRefreshCallback();
            console.log('📊 Dashboard refreshed via realtime vote');
        } catch (err) {
            console.error('❌ Failed to refresh dashboard:', err.message);
        }
    }
}

// ==================== REAL-TIME SETUP (Improved & Stable) ====================
function setupRealtimeListeners() {
    // Full cleanup of previous channel
    if (realtimeChannel) {
        realtimeChannel.unsubscribe().catch(() => {});
        supabase.removeChannel(realtimeChannel).catch(() => {});
        realtimeChannel = null;
    }

    realtimeChannel = supabase.channel('poll-votes-realtime', {
        config: {
            heartbeat: true,
            heartbeatIntervalMs: 15000,
            timeout: 20000,
        }
    });

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
            console.log(`[Realtime] Status: ${status}${err ? ` - ${err.message || err}` : ''}`);

            if (status === 'SUBSCRIBED') {
                console.log('✅ Supabase Realtime: Successfully subscribed and listening for votes');
                reconnectAttempts = 0;
            } else if (['TIMED_OUT', 'CLOSED', 'CHANNEL_ERROR'].includes(status)) {
                console.warn(`⚠️ Realtime ${status} - attempting reconnect`);
                attemptReconnect();
            }
        });
}

function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('❌ Max realtime reconnect attempts reached. Falling back to interval updates only.');
        return;
    }

    reconnectAttempts++;
    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(1.6, reconnectAttempts - 1), 30000);

    console.log(`🔄 Reconnecting realtime in ${delay}ms... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    setTimeout(() => {
        if (currentPollMessage) {
            setupRealtimeListeners();
        }
    }, delay);
}

// ==================== VOTE HANDLER ====================
async function handleVoteChange(payload) {
    console.log(`🗳️ Realtime vote → ${payload.eventType} on ${payload.table}`);

    // Force cache refresh
    cachedPollResults = null;
    cachedPollTimestamp = 0;

    // Update Discord poll message if active
    if (currentPollMessage && currentCharacters) {
        try {
            const results = await getPollResults(currentPollMessage, currentCharacters);
            const isFinished = Date.now() >= currentEndTime;
            const content = await generateMessageContent(currentEndTime, results, currentCharacters, isFinished);
            await currentPollMessage.edit({ content });
            console.log('✅ Discord poll updated via realtime');
        } catch (err) {
            if (err.code !== 10008) {
                console.error('❌ Discord realtime update failed:', err.message);
            }
        }
    }

    // Update Dashboard immediately
    await refreshDashboard();
}

// ==================== CORE FUNCTIONS ====================
async function getPollResults(message, characters) {
    if (cachedPollResults && (Date.now() - cachedPollTimestamp) < CACHE_TTL) {
        return cachedPollResults;
    }

    try {
        const [{ data: discordVotes }, { data: websiteVotes }, { data: winnerData }] = await Promise.all([
            supabaseRetry(() => supabase.from('votes_discord').select('option_id, weight').eq('poll_id', CURRENT_POLL_ID)),
            supabaseRetry(() => supabase.from('website_voting').select('option_id').eq('poll_id', CURRENT_POLL_ID)),
            supabaseRetry(() => supabase.from('final_votes').select('option_id, selected_at').eq('poll_id', CURRENT_POLL_ID))
        ]);

        const winnerMap = {};
        (winnerData || []).forEach(row => {
            if (row.selected_at) winnerMap[row.option_id] = true;
        });

        const displayResults = [];
        const rawDataForDB = [];

        for (let i = 0; i < characters.length; i++) {
            const optionId = i + 1;
            const discordScore = (discordVotes || [])
                .filter(v => v.option_id === optionId)
                .reduce((sum, v) => sum + parseFloat(v.weight || 0), 0);

            const websiteScore = (websiteVotes || []).filter(v => v.option_id === optionId).length;
            const totalScore = discordScore + websiteScore;

            const rawName = characters[i].replace(/:female_sign:|:male_sign:/g, m =>
                m === ':female_sign:' ? '♀️' : '♂️'
            );

            const isWinner = !!winnerMap[optionId];
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

        await supabaseRetry(() => supabase.from('final_votes').upsert(rawDataForDB, { onConflict: 'poll_id,option_id' }));

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
                await supabaseRetry(() => supabase.from('auto_resume').delete().eq('message_id', pollMessage.id));
            }
        } catch (e) {
            if (e.code === 10008) {
                forceStopPoll();
                await supabaseRetry(() => supabase.from('auto_resume').delete().eq('message_id', pollMessage.id));
            } else {
                console.error("Poll interval error:", e);
            }
        }
    }, UPDATE_INTERVAL);
}

// ==================== EXPORTS ====================
module.exports = {
    getPollResults,
    generateMessageContent,
    runPollInterval,
    getFinalPollMessageContent,
    forceStopPoll,
    setDashboardRefreshCallback,
    refreshDashboard
};
