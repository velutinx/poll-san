// this is poll-san/services/pollService.js

const supabase = require('./supabase');
const { supabaseRetry } = require('../utils/db');
const h = require('../utils/helpers');

// Use a constant for the poll ID so it's easy to change later
const CURRENT_POLL_ID = 'character_poll_new';

// Cache for poll results
let cachedPollResults = null;
let cachedPollTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute

// Module-level timer and realtime subscription
let activePollTimer = null;
let voteSubscription = null;
let keepAliveInterval = null;   // <-- moved to module level

// ----------------------------------------------------------------------
// Core poll result calculation (unchanged)
// ----------------------------------------------------------------------
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
                ? discordVotes
                    .filter(v => v.option_id === optionId)
                    .reduce((sum, v) => sum + parseFloat(v.weight), 0)
                : 0;

            const websiteScore = websiteVotes
                ? websiteVotes.filter(v => v.option_id === optionId).length
                : 0;

            const totalScore = discordScore + websiteScore;
            const rawName = characters[i].replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️');
            const isWinner = winnerMap[optionId] || false;

            let line = `${h.emojis[i]} \`  ${totalScore.toFixed(2).padStart(5, ' ')}    ${rawName.padEnd(30)} \` \n`;
            if (isWinner) {
                line = `||${line}||`;
            }
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

// ----------------------------------------------------------------------
// Message content generation (unchanged)
// ----------------------------------------------------------------------
async function generateMessageContent(endTime, resultsText, characters, isEnded = false) {
    const e = h.releaseEmojis;
    const randomDownArrow = e.DOWN_ARROWS[Math.floor(Math.random() * e.DOWN_ARROWS.length)];
    
    const header = isEnded 
        ? `🛑 **Poll Ended**\n\n` 
        : `${e.HOURGLASS} Time remaining: **${h.formatTime(endTime - Date.now())}**\n\n`;
    
    const body = resultsText || characters.map((char, i) => {
        const name = char.replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️');
        return `${h.emojis[i]} \`      0.00   ${name.padEnd(30)} \` \n`;
    }).join('');
    
    const footer = `\nDiscord weighted vote + ${e.LINK} **[Website poll results](https://velutinx.com/poll)** (Click to vote there too!)\n\n` +
                   `${randomDownArrow} Click the thread below for character images & discussion!`;
    
    return header + body + footer;
}

// ----------------------------------------------------------------------
// Helper to refresh the poll message (used by both timer and realtime)
// ----------------------------------------------------------------------
async function refreshPollMessage(pollMessage, endTime, characters) {
    // Clear cache to force fresh data from DB
    cachedPollResults = null;
    cachedPollTimestamp = 0;

    const now = Date.now();
    const isFinished = now >= endTime;
    const results = await getPollResults(pollMessage, characters);
    const content = await generateMessageContent(endTime, results, characters, isFinished);
    
    try {
        await pollMessage.edit({ content });
    } catch (err) {
        // Ignore "Unknown Message" (10008) – usually means poll was already deleted
        if (err.code !== 10008) {
            console.warn('Failed to edit poll message:', err.message);
        }
    }
}

// ----------------------------------------------------------------------
// Supabase Realtime subscription – triggers on every new vote
// ----------------------------------------------------------------------
async function subscribeToVoteUpdates(pollMessage, endTime, characters) {
    // Unsubscribe from any previous subscription first
    if (voteSubscription) {
        await supabase.removeChannel(voteSubscription);
        voteSubscription = null;
    }
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }

    // Create a new channel with extended timeout config
    const channel = supabase
        .channel('vote-updates', {
            config: {
                // Increase default timeouts (Railway closes idle connections quickly)
                timeout: 60000,           // 60 seconds instead of default ~10
                heartbeatIntervalMs: 15000, // Send a ping every 15 seconds
            }
        })
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'votes_discord' },
            () => refreshPollMessage(pollMessage, endTime, characters)
        )
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'website_voting' },
            () => refreshPollMessage(pollMessage, endTime, characters)
        )
        .subscribe((status, err) => {
            if (err) {
                console.error('❌ Realtime subscription error:', err);
                // Attempt to reconnect after a delay (Supabase client may retry automatically,
                // but we can force a manual re‑sub if needed)
                setTimeout(() => {
                    if (voteSubscription?.state !== 'joined') {
                        console.log('🔄 Manually re‑subscribing to realtime...');
                        subscribeToVoteUpdates(pollMessage, endTime, characters);
                    }
                }, 5000);
            } else {
                console.log(`✅ Realtime subscription status: ${status}`);
                
                // Once subscribed, start a manual keep‑alive ping every 20 seconds
                if (status === 'SUBSCRIBED') {
                    if (keepAliveInterval) clearInterval(keepAliveInterval);
                    keepAliveInterval = setInterval(() => {
                        // Send a harmless 'ping' message over the WebSocket to keep it alive
                        if (voteSubscription?.socket?.readyState === 1) { // WebSocket.OPEN
                            voteSubscription.socket.send(JSON.stringify({ type: 'ping' }));
                        }
                    }, 20000);
                }
            }
        });

    voteSubscription = channel;
}

// ----------------------------------------------------------------------
// Cleanup: stop timer and unsubscribe from realtime
// ----------------------------------------------------------------------
function forceStopPoll() {
    if (activePollTimer) {
        clearInterval(activePollTimer);
        activePollTimer = null;
        console.log("Poll interval cleared.");
    }
    
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
    
    if (voteSubscription) {
        supabase.removeChannel(voteSubscription)
            .then(() => {
                voteSubscription = null;
                console.log("Realtime subscription removed.");
            })
            .catch(err => console.error("Error removing subscription:", err));
    }
}

// ----------------------------------------------------------------------
// Main polling loop (1‑minute fallback + starts realtime)
// ----------------------------------------------------------------------
function runPollInterval(pollMessage, endTime, characters) {
    // Clear any existing timer
    forceStopPoll();

    // Start the 1‑minute interval as a fallback
    activePollTimer = setInterval(async () => {
        const now = Date.now();
        const isFinished = now >= endTime;

        try {
            await refreshPollMessage(pollMessage, endTime, characters);

            if (isFinished) {
                forceStopPoll();
                await supabaseRetry(() =>
                    supabase.from('auto_resume').delete().eq('message_id', pollMessage.id)
                );
            }
        } catch (e) {
            if (e.code === 10008) { // Message deleted
                forceStopPoll();
                await supabaseRetry(() =>
                    supabase.from('auto_resume').delete().eq('message_id', pollMessage.id)
                );
            }
        }
    }, 60000);

    // Also subscribe to realtime vote events (instant updates)
    subscribeToVoteUpdates(pollMessage, endTime, characters).catch(err => {
        console.error("Failed to start realtime subscription:", err);
    });
}

// ----------------------------------------------------------------------
// Utility for final poll message (unchanged)
// ----------------------------------------------------------------------
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

// ----------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------
module.exports = { 
    getPollResults, 
    generateMessageContent, 
    runPollInterval, 
    getFinalPollMessageContent,
    forceStopPoll
};
