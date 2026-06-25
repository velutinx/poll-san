// services/pollService.js – Optimized with aggregated SQL query

const db = require('./database');
const h = require('../utils/helpers');

const CURRENT_POLL_ID = 'character_poll_new';
const UPDATE_INTERVAL = h.POLL_UPDATE_INTERVAL_MS || 30000;

let activePollTimer = null;

async function getPollResults(message, characters) {
    try {
        // ── 1. Aggregated query – returns one row per option ──
        const aggregated = await db.query(`
            WITH all_options AS (
              SELECT option_id FROM ${h.tables.POLL_VOTING_DISCORD} WHERE poll_id = ?
              UNION
              SELECT option_id FROM ${h.tables.POLL_VOTING_WEBSITE} WHERE poll_id = ?
              UNION
              SELECT option_id FROM ${h.tables.POLL_VOTES_FINAL} WHERE poll_id = ? AND selected_at IS NOT NULL
            ),
            discord_scores AS (
              SELECT option_id, COALESCE(SUM(weight), 0) as score
              FROM ${h.tables.POLL_VOTING_DISCORD}
              WHERE poll_id = ?
              GROUP BY option_id
            ),
            website_counts AS (
              SELECT option_id, COUNT(*) as count
              FROM ${h.tables.POLL_VOTING_WEBSITE}
              WHERE poll_id = ?
              GROUP BY option_id
            ),
            winner_flags AS (
              SELECT option_id, 1 as is_winner
              FROM ${h.tables.POLL_VOTES_FINAL}
              WHERE poll_id = ? AND selected_at IS NOT NULL
            )
            SELECT 
              ao.option_id,
              COALESCE(ds.score, 0) + COALESCE(wc.count, 0) as total_score,
              CASE WHEN wf.is_winner IS NOT NULL THEN 1 ELSE 0 END as is_winner,
              (SELECT character_name FROM ${h.tables.POLL_VOTES_FINAL} WHERE poll_id = ? AND option_id = ao.option_id LIMIT 1) as character_name
            FROM all_options ao
            LEFT JOIN discord_scores ds ON ao.option_id = ds.option_id
            LEFT JOIN website_counts wc ON ao.option_id = wc.option_id
            LEFT JOIN winner_flags wf ON ao.option_id = wf.option_id
            ORDER BY ao.option_id
        `, [CURRENT_POLL_ID, CURRENT_POLL_ID, CURRENT_POLL_ID, CURRENT_POLL_ID, CURRENT_POLL_ID, CURRENT_POLL_ID, CURRENT_POLL_ID]);

        // ── 2. Build display results and prepare data for DB ──
        const displayResults = [];
        const rawDataForDB = [];

        // Build a map for quick lookup
        const scoreMap = {};
        for (const row of aggregated) {
            scoreMap[row.option_id] = {
                total_score: parseFloat(row.total_score) || 0,
                is_winner: row.is_winner === 1,
                character_name: row.character_name || null
            };
        }

        for (let i = 0; i < characters.length; i++) {
            const optionId = i + 1;
            const data = scoreMap[optionId] || { total_score: 0, is_winner: false, character_name: null };
            const totalScore = data.total_score;
            const isWinner = data.is_winner;
            const rawName = characters[i].replace(/:female_sign:|:male_sign:/g, m =>
                m === ':female_sign:' ? '♀️' : '♂️'
            );

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

        // ── 4. Only write if scores changed (using INSERT OR REPLACE) ──
        if (changed) {
            for (const row of rawDataForDB) {
                await db.query(
                    `INSERT OR REPLACE INTO ${h.tables.POLL_VOTES_FINAL} 
                     (poll_id, option_id, character_name, score, selected_at)
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
