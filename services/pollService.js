// services/pollService.js

const db = require('./database');
const h = require('../utils/helpers');

const CURRENT_POLL_ID = 'character_poll_new';
const UPDATE_INTERVAL = h.POLL_UPDATE_INTERVAL_MS || 10000;

let activePollTimer = null;

async function getPollResults(message, characters) {
    // Always fetch fresh data – no caching
    try {
        const discordVotes = await db.query(
            `SELECT option_id, weight FROM ${h.tables.POLL_VOTING_DISCORD} WHERE poll_id = ?`,
            [CURRENT_POLL_ID]
        );
        const websiteVotes = await db.query(
            `SELECT option_id FROM ${h.tables.POLL_VOTING_WEBSITE} WHERE poll_id = ?`,
            [CURRENT_POLL_ID]
        );
        const winnerData = await db.query(
            `SELECT option_id, selected_at FROM ${h.tables.POLL_VOTES_FINAL} WHERE poll_id = ?`,
            [CURRENT_POLL_ID]
        );

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
                score: totalScore,
                selected_at: winnerMap[optionId] ? new Date().toISOString() : null
            });
        }

        // Upsert the final scores into D1
        for (const row of rawDataForDB) {
            await db.query(
                `INSERT INTO ${h.tables.POLL_VOTES_FINAL} (poll_id, option_id, character_name, score, selected_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(poll_id, option_id) DO UPDATE SET
                    character_name = excluded.character_name,
                    score = excluded.score,
                    selected_at = excluded.selected_at`,
                [row.poll_id, row.option_id, row.character_name, row.score, row.selected_at]
            );
        }

        const resultString = displayResults.join('');
        return resultString;
    } catch (err) {
        console.error("Error calculating poll results:", err);
        return "Error loading results...";
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

    const footer = `\n${e.DISCORD} Discord weighted vote + ${e.LINK} **[Website poll results](<https://velutinx.com/poll>)**\n\n` +
                   `${randomDownArrow} Click the thread below for images & discussion!`;

    return header + body + footer;
}

function forceStopPoll() {
    if (activePollTimer) {
        clearInterval(activePollTimer);
        activePollTimer = null;
        // console.log("Poll interval cleared."); // silenced
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

    return `🛑 **Poll has ended.**\n\n${resultsString}\n\n${e.DISCORD} Discord weighted vote + ${e.LINK} **[Website poll results](<https://velutinx.com/poll>)**\n\n${randomDownArrow} Click the thread below for images & discussion!`;
}

function runPollInterval(pollMessage, endTime, characters) {
    forceStopPoll();

    activePollTimer = setInterval(async () => {
        const now = Date.now();
        const isFinished = now >= endTime;

        try {
            const results = await getPollResults(pollMessage, characters);
            const content = await generateMessageContent(endTime, results, characters, isFinished);

            const channel = pollMessage.channel;
            const webhooks = await channel.fetchWebhooks();
            const pollWebhook = webhooks.find(w => w.name === 'Poll');
            if (pollWebhook) {
                await pollWebhook.editMessage(pollMessage.id, { content });
            } else {
                await pollMessage.edit({ content }).catch(() => {});
            }

            if (isFinished) {
                forceStopPoll();
                await db.query(
                    `DELETE FROM ${h.tables.POLL_AUTO_RESUME} WHERE message_id = ?`,
                    [pollMessage.id]
                );
            }
        } catch (e) {
            if (e.code === 10008) {
                forceStopPoll();
                await db.query(
                    `DELETE FROM ${h.tables.POLL_AUTO_RESUME} WHERE message_id = ?`,
                    [pollMessage.id]
                );
            } else {
                console.error("Poll interval error:", e);
            }
        }
    }, UPDATE_INTERVAL);
}

async function refreshPollMessage(pollMessage, characters, endTime) {
    // This function is called immediately after a vote or time adjustment
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
