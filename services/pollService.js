const supabase = require('./supabase');
const { formatTime, emojis, reactIds, weights } = require('../utils/helpers');

/**
 * Calculates scores by summing the weights in the votes_discord table
 * and adding the head-count from the website 'votes' table.
 * Also applies spoiler tags to any character marked as winner (selected_at not null).
 */
async function getPollResults(message, characters) {
    const displayResults = [];
    const rawDataForDB = [];

    try {
        // 1. Fetch all current Discord votes for this poll
        const { data: discordVotes, error: dError } = await supabase
            .from('votes_discord')
            .select('option_id, weight')
            .eq('poll_id', 'character_poll_new');

        if (dError) throw dError;

        // 2. Fetch all website votes for this poll
        const { data: websiteVotes, error: wError } = await supabase
            .from('website_voting')
            .select('option_id')
            .eq('poll_id', 'character_poll_new');

        if (wError) throw wError;

        // 3. Fetch existing winner status from final_votes (selected_at)
        const { data: winnerData, error: winnerError } = await supabase
            .from('final_votes')
            .select('option_id, selected_at')
            .eq('poll_id', 'character_poll_new');

        if (winnerError) throw winnerError;

        // Build a map for quick lookup of winners
        const winnerMap = {};
        if (winnerData) {
            winnerData.forEach(row => {
                if (row.selected_at) {
                    winnerMap[row.option_id] = true;
                }
            });
        }

        for (let i = 0; i < characters.length; i++) {
            const optionId = i + 1;

            // Sum the weights from the Discord table for this specific option
            const discordScore = discordVotes
                ? discordVotes
                    .filter(v => v.option_id === optionId)
                    .reduce((sum, v) => sum + parseFloat(v.weight), 0)
                : 0;

            // Count website entries for this option (1 point each)
            const websiteScore = websiteVotes
                ? websiteVotes.filter(v => v.option_id === optionId).length
                : 0;

            const totalScore = discordScore + websiteScore;
            const rawName = characters[i].replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️');

            // Check if this character is a winner
            const isWinner = winnerMap[optionId] || false;

            // Build the line with proper formatting
            let line = `${emojis[i]} \`  ${totalScore.toFixed(2).padStart(5, ' ')}   ${rawName.padEnd(30)} \` \n`;
            if (isWinner) {
                line = `||${line}||`; // Wrap in spoiler tags
            }
            displayResults.push(line);
            
            rawDataForDB.push({ 
                poll_id: 'character_poll_new', 
                option_id: optionId, 
                character_name: rawName, 
                score: totalScore 
            });
        }

        // Keep final_votes table synced for the web dashboard (scores only, winner status preserved)
        await supabase.from('final_votes').upsert(rawDataForDB, { onConflict: 'poll_id,option_id' });

    } catch (err) {
        console.error("Error calculating poll results:", err);
        return "Error loading results...";
    }

    return displayResults.join('');
}

async function generateMessageContent(endTime, resultsText, characters) {
    let header = `:hourglass_flowing_sand: Time remaining: **${formatTime(endTime - Date.now())}**\n\n`;
    let body = resultsText || characters.map((char, i) => {
        const name = char.replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️');
        return `${emojis[i]} \`    0.00   ${name.padEnd(30)} \` \n`;
    }).join('');
    
    return header + body + `\nDiscord weighted vote + Website poll results\n\n:point_down: Click the thread below for character images & discussion!`;
}

/**
 * Generates the final "Poll ended" message (for manual stop)
 * @param {string} pollList - The raw character list stored in auto_resume
 * @returns {Promise<string>} The final message content
 */
async function getFinalPollMessageContent(pollList) {
    // Parse characters from the stored poll list (same as in startpoll.js)
    const characters = pollList
        .split(/(?=:female_sign:|:male_sign:|♀️|♂️)/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    // Get the formatted results (scores, spoilers for winners)
    const resultsString = await getPollResults(null, characters);

    return `🛑 **Poll has ended.**\n\n${resultsString}\n\nDiscord weighted vote + Website poll results\n\n:point_down: Click the thread below for character images & discussion!`;
}

function runPollInterval(pollMessage, endTime, characters) {
    const timer = setInterval(async () => {
        const now = Date.now();
        if (now >= endTime) {
            clearInterval(timer);
            try {
                const results = await getPollResults(pollMessage, characters);
                const content = await generateMessageContent(endTime, results, characters);
                await pollMessage.edit({ content: content.replace(/:hourglass_flowing_sand: .*/, "⌛ **Poll Ended**") });
            } catch (e) {
                console.error("Error ending poll:", e);
            }
            // Cleanup: clear auto_resume but keep votes_discord for history/audit if desired
            await supabase.from('auto_resume').delete().eq('message_id', pollMessage.id);
        } else {
            try {
                const results = await getPollResults(pollMessage, characters);
                const content = await generateMessageContent(endTime, results, characters);
                await pollMessage.edit({ content });
            } catch (e) {
                if (e.code === 10008) { // Message deleted
                    clearInterval(timer);
                    await supabase.from('auto_resume').delete().eq('message_id', pollMessage.id);
                }
            }
        }
    }, 10000); // 10s interval
}

module.exports = { getPollResults, generateMessageContent, runPollInterval, getFinalPollMessageContent };
