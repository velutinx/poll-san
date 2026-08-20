// services/pollService.js

const db = require('./database');
const h = require('../utils/helpers');
const CURRENT_POLL_ID = 'character_poll_new';
const UPDATE_INTERVAL = h.POLL_UPDATE_INTERVAL_MS || 30000;
let activePollTimer = null;
let pollCache = {
    results: null,
    timestamp: 0,
    lastError: null,
};
const CACHE_TTL_MS = 30000; // 30 seconds (was 10s)

// ─── NEW: Cache for active poll status ──────────────────────────────
let activePollCache = {
    active: false,
    timestamp: 0,
};
const ACTIVE_POLL_CACHE_TTL = 30000; // 30 seconds

let pollKv = null;
const KV_CACHE_KEY = 'poll_results_cache';
const KV_CACHE_TTL = 30;

function setPollKv(kv) {
    pollKv = kv;
}

async function queryWithRetry(sql, params = [], method = 'all', maxRetries = 3) {
    let lastError;
    let delay = 500;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await db.query(sql, params, method === 'first' ? true : false);
            if (method === 'first') {
                return result;
            }
            return result;
        } catch (err) {
            lastError = err;
            const msg = err.message || '';
            if (msg.includes('timeout') || msg.includes('reset') || msg.includes('storage operation') ||
                msg.includes('ECONNRESET') || msg.includes('fetch failed') || err.name === 'AbortError') {
                console.log(`⚠️ D1 ${method} error (attempt ${attempt}), retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
            }
            throw err;
        }
    }
    throw lastError;
}

async function invalidatePollCache() {
    pollCache.results = null;
    pollCache.timestamp = 0;
    if (pollKv) {
        try {
            await pollKv.delete(KV_CACHE_KEY);
            console.log(`🗑️ Poll KV cache invalidated.`);
        } catch (err) {
            console.warn('Failed to delete poll KV cache:', err.message);
        }
    }
}

async function isPollActive(messageId) {
    const now = Date.now();
    if (activePollCache.active && (now - activePollCache.timestamp) < ACTIVE_POLL_CACHE_TTL) {
        return activePollCache.active;
    }

    try {
        const row = await db.query(
            `SELECT message_id FROM ${h.tables.POLL_AUTO_RESUME} WHERE message_id = ? AND ends_at > datetime('now')`,
            [messageId],
            true
        );
        const active = !!row;
        activePollCache.active = active;
        activePollCache.timestamp = now;
        return active;
    } catch (err) {
        console.warn(`[PollService] Failed to check poll active status for ${messageId}:`, err.message);
        // If cache is stale, return cached value if exists
        if (activePollCache.active !== undefined) {
            return activePollCache.active;
        }
        return false;
    }
}

async function getPollResults(message, characters) {
    const now = Date.now();

    if (pollCache.results && (now - pollCache.timestamp) < CACHE_TTL_MS) {
        return pollCache.results;
    }

    if (pollKv) {
        try {
            const cached = await pollKv.get(KV_CACHE_KEY, 'json');
            if (cached && cached.results && (now - cached.timestamp) < KV_CACHE_TTL * 1000) {
                pollCache.results = cached.results;
                pollCache.timestamp = now;
                return cached.results;
            }
        } catch (err) {
            console.warn('KV cache read failed, falling back to D1:', err.message);
        }
    }

    try {
        // ─── Added ORDER BY option_id ASC with LIMIT 12 (only 12 options) ──
        const discordRows = await queryWithRetry(
            `SELECT option_id, COALESCE(SUM(weight), 0) as score
             FROM ${h.tables.POLL_VOTING_DISCORD}
             WHERE poll_id = ?
             GROUP BY option_id`,
            [CURRENT_POLL_ID],
            'all'
        );

        const websiteRows = await queryWithRetry(
            `SELECT option_id, COUNT(*) as count
             FROM ${h.tables.POLL_VOTING_WEBSITE}
             WHERE poll_id = ?
             GROUP BY option_id`,
            [CURRENT_POLL_ID],
            'all'
        );

        const winnerRows = await queryWithRetry(
            `SELECT option_id
             FROM ${h.tables.POLL_VOTES_FINAL}
             WHERE poll_id = ? AND selected_at IS NOT NULL`,
            [CURRENT_POLL_ID],
            'all'
        );

        const discordMap = {};
        discordRows.forEach(r => { discordMap[r.option_id] = parseFloat(r.score) || 0; });
        const websiteMap = {};
        websiteRows.forEach(r => { websiteMap[r.option_id] = parseInt(r.count, 10) || 0; });
        const winnerSet = new Set(winnerRows.map(r => r.option_id));
        const displayResults = [];
        const rawDataForDB = [];
        for (let i = 0; i < characters.length; i++) {
            const optionId = i + 1;
            const discordScore = discordMap[optionId] || 0;
            const websiteCount = websiteMap[optionId] || 0;
            const totalScore = discordScore + websiteCount;
            const isWinner = winnerSet.has(optionId);

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

        // ─── Only update poll_votes_final if there are changes ──────────
        const currentRows = await queryWithRetry(
            `SELECT option_id, score FROM ${h.tables.POLL_VOTES_FINAL} WHERE poll_id = ? ORDER BY option_id ASC LIMIT 12`,
            [CURRENT_POLL_ID],
            'all'
        );
        const currentScores = {};
        currentRows.forEach(r => { currentScores[r.option_id] = r.score; });

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

        if (changed && rawDataForDB.length > 0) {
            // Use batch upsert
            const columns = ['poll_id', 'option_id', 'character_name', 'score', 'selected_at'];
            const valuesArray = rawDataForDB.map(row => [
                row.poll_id,
                row.option_id,
                row.character_name,
                row.score,
                row.selected_at
            ]);
            await db.batchInsertOrReplace(h.tables.POLL_VOTES_FINAL, columns, valuesArray);
        }

        const resultString = displayResults.join('');

        pollCache.results = resultString;
        pollCache.timestamp = now;
        pollCache.lastError = null;

        if (pollKv) {
            pollKv.put(KV_CACHE_KEY, JSON.stringify({
                results: resultString,
                timestamp: now
            }), { expirationTtl: KV_CACHE_TTL }).catch(err => {
                console.warn('Failed to store poll results in KV:', err.message);
            });
        }

        return resultString;

    } catch (err) {
        console.error("Error calculating poll results:", err);
        pollCache.lastError = err;
        if (pollCache.results) {
            return pollCache.results;
        }

        if (pollKv) {
            try {
                const stale = await pollKv.get(KV_CACHE_KEY, 'json');
                if (stale && stale.results) {
                    console.log('[PollCache] Returning stale KV results due to error.');
                    pollCache.results = stale.results;
                    pollCache.timestamp = Date.now();
                    return stale.results;
                }
            } catch (_) {}
        }

        return "Error loading results...";
    }
}

// ─── The rest of the file (generateMessageContent, runPollInterval, etc.) remains unchanged ──
// But we'll add a LIMIT to the refresh query and increase interval.

// In runPollInterval, we already have an interval of UPDATE_INTERVAL (which is 30s or 60s).
// We'll increase the default to 60 seconds in helpers.js.

// In refreshPollMessage, we use getPollResults which now caches for 30s.

// Force stop function remains the same.

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
    const pollRecord = await queryWithRetry(
        `SELECT arrow_message_id FROM ${h.tables.POLL_AUTO_RESUME} WHERE message_id = ?`,
        [pollMessage.id],
        'first'
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
        const active = await isPollActive(pollMessage.id);
        if (!active) {
            console.log(`[PollInterval] Poll ${pollMessage.id} is no longer active. Stopping interval.`);
            forceStopPoll();
            return;
        }

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
                await db.query(`DELETE FROM ${h.tables.POLL_AUTO_RESUME} WHERE message_id = ?`, [pollMessage.id]);
                await db.query(`DELETE FROM ${h.tables.POLL_VOTING_DISCORD} WHERE poll_id = 'character_poll_new'`);
                await db.query(`DELETE FROM ${h.tables.POLL_VOTING_WEBSITE} WHERE poll_id = 'character_poll_new'`);
                await db.query(`DELETE FROM ${h.tables.POLL_VOTES_FINAL} WHERE poll_id = 'character_poll_new'`);
                await invalidatePollCache();
            }
        } catch (e) {
            if (e.code === 10008 || e.message?.includes('Unknown Message')) {
                console.warn('[PollInterval] Poll message gone – stopping interval.');
                forceStopPoll();
                await db.query(`DELETE FROM ${h.tables.POLL_AUTO_RESUME} WHERE message_id = ?`, [pollMessage.id]).catch(() => {});
            } else {
                console.error('[PollInterval] Error (will retry):', e.message);
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
    refreshPollMessage,
    setPollKv,
    invalidatePollCache,
};
