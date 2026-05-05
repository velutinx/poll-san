// services/pollService.js

const supabase = require('./supabase');
const { supabaseRetry } = require('../utils/db');
const h = require('../utils/helpers');

const CURRENT_POLL_ID = 'character_poll_new';
const UPDATE_INTERVAL = h.POLL_UPDATE_INTERVAL_MS || 10000;

let cachedPollResults = null;
let cachedPollTimestamp = 0;
const CACHE_TTL = UPDATE_INTERVAL;

let activePollTimer = null;

async function getPollResults(message, characters) {
    if (cachedPollResults && (Date.now() - cachedPollTimestamp) < CACHE_TTL) {
        return cachedPollResults;
    }

    try {
        const [{ data: discordVotes }, { data: websiteVotes }, { data: winnerData }] = await Promise.all([
            supabaseRetry(() => supabase.from(h.tables.POLL_VOTING_DISCORD).select('option_id, weight').eq('poll_id', CURRENT_POLL_ID)),
            supabaseRetry(() => supabase.from(h.tables.POLL_VOTING_WEBSITE).select('option_id').eq('poll_id', CURRENT_POLL_ID)),
            supabaseRetry(() => supabase.from(h.tables.POLL_VOTES_FINAL).select('option_id, selected_at').eq('poll_id', CURRENT_POLL_ID))
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

        await supabaseRetry(() => supabase.from(h.tables.POLL_VOTES_FINAL).upsert(rawDataForDB, { onConflict: 'poll_id,option_id' }));

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

    const footer = `\nDiscord weighted vote + ${e.LINK} **[Website poll results](https://velutinx.com/poll)**\n\n` +
                   `${randomDownArrow} Click the thread below for images & discussion!`;

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

    return `🛑 **Poll has ended.**\n\n${resultsString}\n\nDiscord weighted vote + ${e.LINK} **[Website poll results](https://velutinx.com/poll)**\n\n${randomDownArrow} Click the thread below for images & discussion!`;
}

// ----- runPollInterval -----
function runPollInterval(pollMessage, endTime, characters) {
    forceStopPoll();

    activePollTimer = setInterval(async () => {
        const now = Date.now();
        const isFinished = now >= endTime;

        try {
            const results = await getPollResults(pollMessage, characters);
            const content = await generateMessageContent(endTime, results, characters, isFinished);

            // Edit via the Poll webhook instead of the bot
            const channel = pollMessage.channel;
            const webhooks = await channel.fetchWebhooks();
            const pollWebhook = webhooks.find(w => w.name === 'Poll');
            if (pollWebhook) {
                await pollWebhook.editMessage(pollMessage.id, { content });
            } else {
                // Fallback – likely won't work if message is owned by a webhook
                await pollMessage.edit({ content }).catch(() => {});
            }

            if (isFinished) {
                forceStopPoll();
                await supabaseRetry(() =>
                    supabase.from(h.tables.POLL_AUTO_RESUME).delete().eq('message_id', pollMessage.id)
                );
            }
        } catch (e) {
            if (e.code === 10008) {
                forceStopPoll();
                await supabaseRetry(() =>
                    supabase.from(h.tables.POLL_AUTO_RESUME).delete().eq('message_id', pollMessage.id)
                );
            } else {
                console.error("Poll interval error:", e);
            }
        }
    }, UPDATE_INTERVAL);
}

// ----- refreshPollMessage (used externally, e.g. from website routes) -----
async function refreshPollMessage(pollMessage, characters, endTime) {
    const results = await getPollResults(pollMessage, characters);
    const content = await generateMessageContent(endTime, results, characters, false);

    const channel = pollMessage.channel;
    const webhooks = await channel.fetchWebhooks();
    const pollWebhook = webhooks.find(w => w.name === 'Poll');
    if (pollWebhook) {
        await pollWebhook.editMessage(pollMessage.id, { content });
    } else {
        await pollMessage.edit({ content }).catch(() => {});
    }
}

module.exports = {
    getPollResults,
    generateMessageContent,
    runPollInterval,
    getFinalPollMessageContent,
    forceStopPoll,
    refreshPollMessage
};
