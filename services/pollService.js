// services/pollService.js – Optimized to reduce D1 writes

const db = require('./database');
const h = require('../utils/helpers');

const CURRENT_POLL_ID = 'character_poll_new';
const UPDATE_INTERVAL = h.POLL_UPDATE_INTERVAL_MS || 30000;

let activePollTimer = null;

async function getPollResults(message, characters) {
    try {
        // ── 1. Fetch raw votes from all sources ──
        const batch = await db.query(`
            SELECT 'discord' as source, option_id, weight, NULL as selected_at
            FROM ${h.tables.POLL_VOTING_DISCORD}
            WHERE poll_id = ?
            UNION ALL
            SELECT 'website' as source, option_id, 1 as weight, NULL as selected_at
            FROM ${h.tables.POLL_VOTING_WEBSITE}
            WHERE poll_id = ?
            UNION ALL
            SELECT 'winner' as source, option_id, NULL as weight, selected_at
            FROM ${h.tables.POLL_VOTES_FINAL}
            WHERE poll_id = ? AND selected_at IS NOT NULL
        `, [CURRENT_POLL_ID, CURRENT_POLL_ID, CURRENT_POLL_ID]);

        const discordVotes = [];
        const websiteVotes = [];
        const winnerMap = {};

        for (const row of batch) {
            if (row.source === 'discord') {
                discordVotes.push({ option_id: row.option_id, weight: row.weight });
            } else if (row.source === 'website') {
                websiteVotes.push({ option_id: row.option_id });
            } else if (row.source === 'winner') {
                winnerMap[row.option_id] = true;
            }
        }

        // ── 2. Calculate new scores ──
        const displayResults = [];
        const rawDataForDB = [];

        for (let i = 0; i < characters.length; i++) {
            const optionId = i + 1;
            const discordScore = discordVotes
                .filter(v => v.option_id === optionId)
                .reduce((sum, v) => sum + parseFloat(v.weight || 0), 0);
            const websiteScore = websiteVotes.filter(v => v.option_id === optionId).length;
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
                selected_at: isWinner ? new Date().toISOString() : null
            });
        }

        // ── 3. Check if scores have changed ──
        const currentRows = await db.query(
            `SELECT option_id, score FROM ${h.tables.POLL_VOTES_FINAL} WHERE poll_id = ?`,
            [CURRENT_POLL_ID]
        );
        const currentScores = {};
        for (const row of currentRows) {
            currentScores[row.option_id] = row.score;
        }

        let changed = false;
        if (Object.keys(currentScores).length !== rawDataForDB.length) {
            changed = true;
        } else {
            for (const row of rawDataForDB) {
                if (currentScores[row.option_id] === undefined || currentScores[row.option_id] !== row.score) {
                    changed = true;
                    break;
                }
            }
        }

        // ── 4. Only write if scores changed ──
        if (changed) {
            // Delete all existing rows for this poll
            await db.query(
                `DELETE FROM ${h.tables.POLL_VOTES_FINAL} WHERE poll_id = ?`,
                [CURRENT_POLL_ID]
            );
            // Insert all rows with new scores
            for (const row of rawDataForDB) {
                await db.query(
                    `INSERT INTO ${h.tables.POLL_VOTES_FINAL} (poll_id, option_id, character_name, score, selected_at)
                     VALUES (?, ?, ?, ?, ?)`,
                    [row.poll_id, row.option_id, row.character_name, row.score, row.selected_at]
                );
            }
        }

        return displayResults.join('');
    } catch (err) {
        console.error("Error calculating poll results:", err);
        return "Error loading results...";
    }
}

// ── The rest of the file stays unchanged ──

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

async function updateArrowMessage(pollMessage) {
    const pollRecord = await db.query(
        `SELECT arrow_message_id FROM ${h.tables.POLL_AUTO_RESUME} WHERE message_id = ?`,
        [pollMessage.id],
        true
    );
    if (!pollRecord?.arrow_message_id) return;

    const thread = pollMessage.thread;
    if (!thread) return;

    try {
        const channel = pollMessage.channel;
        const webhooks = await channel.fetchWebhooks();
        const pollWebhook = webhooks.find(w => w.name === 'Poll');
        if (!pollWebhook) {
            console.warn("Could not find Poll webhook to edit arrow message");
            return;
        }
        const upArrows = h.releaseEmojis.UP_ARROWS || [];
        const randomUpArrow = upArrows.length ? upArrows[Math.floor(Math.random() * upArrows.length)] : '⬆️';
        await pollWebhook.editMessage(pollRecord.arrow_message_id, {
            content: `${randomUpArrow} Character images for the poll above!`,
            threadId: thread.id
        });
    } catch (e) {
        console.warn("Failed to update arrow message:", e.message);
    }
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

            await updateArrowMessage(pollMessage);

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
    await updateArrowMessage(pollMessage);
}

module.exports = {
    getPollResults,
    generateMessageContent,
    runPollInterval,
    getFinalPollMessageContent,
    forceStopPoll,
    refreshPollMessage
};
