// this is poll-san/services/pollService.js

const supabase = require('./supabase');
const { supabaseRetry } = require('../utils/db');
const h = require('../utils/helpers'); // Use the 'h' pattern for consistency

// Use a constant for the poll ID so it's easy to change later
const CURRENT_POLL_ID = 'character_poll_new'; 

// Cache for poll results
let cachedPollResults = null;
let cachedPollTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute

let lastCacheLogTime = 0;
const CACHE_LOG_INTERVAL = 60000;

async function getPollResults(message, characters) {
    const displayResults = [];
    const rawDataForDB = [];

    if (cachedPollResults && (Date.now() - cachedPollTimestamp) < CACHE_TTL) {
        if (Date.now() - lastCacheLogTime > CACHE_LOG_INTERVAL) {
            lastCacheLogTime = Date.now();
        }
        return cachedPollResults;
    }

    try {
        // 1. Fetch Discord votes
        const { data: discordVotes, error: dError } = await supabaseRetry(() =>
            supabase.from('votes_discord')
                .select('option_id, weight')
                .eq('poll_id', CURRENT_POLL_ID)
        );
        if (dError) throw dError;

        // 2. Fetch website votes
        const { data: websiteVotes, error: wError } = await supabaseRetry(() =>
            supabase.from('website_voting')
                .select('option_id')
                .eq('poll_id', CURRENT_POLL_ID)
        );
        if (wError) throw wError;

        // 3. Fetch winner status
        const { data: winnerData, error: winnerError } = await supabaseRetry(() =>
            supabase.from('final_votes')
                .select('option_id, selected_at')
                .eq('poll_id', CURRENT_POLL_ID)
        );
        if (winnerError) throw winnerError;

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

            // UPDATED: Using h.emojis
            let line = `${h.emojis[i]} \`  ${totalScore.toFixed(2).padStart(5, ' ')}   ${rawName.padEnd(30)} \` \n`;
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
        if (cachedPollResults) return cachedPollResults;
        return "Error loading results...";
    }
}

async function generateMessageContent(endTime, resultsText, characters) {
    // UPDATED: Using h.formatTime
    let header = `:hourglass_flowing_sand: Time remaining: **${h.formatTime(endTime - Date.now())}**\n\n`;
    let body = resultsText || characters.map((char, i) => {
        const name = char.replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️');
        // UPDATED: Using h.emojis
        return `${h.emojis[i]} \`     0.00   ${name.padEnd(30)} \` \n`;
    }).join('');
    
    return header + body + `\nDiscord weighted vote + :link: **[Website poll results](https://velutinx.com/poll)** (Click to vote there too!)\n\n:point_down: Click the thread below for character images & discussion!`;
}

async function getFinalPollMessageContent(pollList) {
    const characters = pollList
        .split(/(?=:female_sign:|:male_sign:|♀️|♂️)/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    const resultsString = await getPollResults(null, characters);

    return `🛑 **Poll has ended.**\n\n${resultsString}\n\nDiscord weighted vote + :link: **[Website poll results](https://velutinx.com/poll)**\n\n:point_down: Click the thread below for character images & discussion!`;
}

function runPollInterval(pollMessage, endTime, characters) {
    const timer = setInterval(async () => {
        const now = Date.now();
        if (now >= endTime) {
            clearInterval(timer);
            try {
                const results = await getPollResults(pollMessage, characters);
                const content = await generateMessageContent(endTime, results, characters);
                await pollMessage.edit({ content: content.replace(/:hourglass_flowing_sand: .*/, "🛑 **Poll Ended**") });
            } catch (e) {
                console.error("Error ending poll:", e);
            }
            try {
                await supabaseRetry(() =>
                    supabase.from('auto_resume').delete().eq('message_id', pollMessage.id)
                );
            } catch (err) {
                console.error("Error deleting auto_resume record:", err);
            }
        } else {
            try {
                const results = await getPollResults(pollMessage, characters);
                const content = await generateMessageContent(endTime, results, characters);
                await pollMessage.edit({ content });
            } catch (e) {
                if (e.code === 10008) { 
                    clearInterval(timer);
                    try {
                        await supabaseRetry(() =>
                            supabase.from('auto_resume').delete().eq('message_id', pollMessage.id)
                        );
                    } catch (err) {
                        console.error("Error deleting auto_resume record:", err);
                    }
                }
            }
        }
    }, 10000); 
}

module.exports = { getPollResults, generateMessageContent, runPollInterval, getFinalPollMessageContent };
