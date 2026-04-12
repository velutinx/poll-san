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

// Module-level timer variable to allow stopping from outside
let activePollTimer = null;

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

/**
 * Generates the message content. 
 * @param {boolean} isEnded - If true, replaces the timer with a static "Poll Ended" header.
 */
async function generateMessageContent(endTime, resultsText, characters, isEnded = false) {
    const e = h.releaseEmojis;
    const randomDownArrow = e.DOWN_ARROWS[Math.floor(Math.random() * e.DOWN_ARROWS.length)];
    
    // 1. Header (Dynamic Timer vs Static Ended)
    const header = isEnded 
        ? `🛑 **Poll Ended**\n\n` 
        : `${e.HOURGLASS} Time remaining: **${h.formatTime(endTime - Date.now())}**\n\n`;
    
    // 2. Body
    const body = resultsText || characters.map((char, i) => {
        const name = char.replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️');
        return `${h.emojis[i]} \`      0.00   ${name.padEnd(30)} \` \n`;
    }).join('');
    
    // 3. Footer
    const footer = `\nDiscord weighted vote + ${e.LINK} **[Website poll results](https://velutinx.com/poll)** (Click to vote there too!)\n\n` +
                   `${randomDownArrow} Click the thread below for character images & discussion!`;
    
    return header + body + footer;
}

function forceStopPoll() {
    if (activePollTimer) {
        clearInterval(activePollTimer);
        activePollTimer = null;
        console.log("Poll interval cleared.");
    }
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
    // Clear any existing timer before starting a new one
    forceStopPoll();

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
            if (e.code === 10008) { // Message deleted
                forceStopPoll();
                await supabaseRetry(() =>
                    supabase.from('auto_resume').delete().eq('message_id', pollMessage.id)
                );
            }
        }
    }, 60000); 
}

module.exports = { 
    getPollResults, 
    generateMessageContent, 
    runPollInterval, 
    getFinalPollMessageContent,
    forceStopPoll 
};
