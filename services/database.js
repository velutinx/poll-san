// services/database.js

const h = require('../utils/helpers');
const WORKER_URL = h.urls.CLOUDFLARE_D1_WORKER;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 90000;
const avatarFlagCache = new Map();
const AVATAR_CACHE_TTL = 60000;
function getCacheKey(sql, params) {
  return `${sql}|${JSON.stringify(params)}`;
}
function isCachedQuery(sql, params) {
  const trimmed = sql.trim().toLowerCase();
  return trimmed.includes('select value from avatar_flagged_settings') && trimmed.includes('where key = ?');
}
async function query(sql, params = [], single = false) {
    if (!WORKER_URL || WORKER_URL === "https://your-worker-name.your-subdomain.workers.dev") {
        throw new Error("CLOUDFLARE_D1_WORKER is not configured.");
    }
    if (isCachedQuery(sql, params)) {
        const key = getCacheKey(sql, params);
        const cached = avatarFlagCache.get(key);
        if (cached && Date.now() - cached.timestamp < AVATAR_CACHE_TTL) {
            const result = cached.value;
            if (single) {
                return result ?? null;
            } else {
                return result !== null && result !== undefined ? [result] : [];
            }
        }
    }
    let lastError = null;
    let delay = RETRY_DELAY_MS;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const startTime = Date.now();
        try {
            const res = await fetch(`${WORKER_URL}/query`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sql, params }),
                signal: controller.signal,
            });
            const elapsed = Date.now() - startTime;
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`D1 Worker error (${res.status}): ${text}`);
            }
            const data = await res.json();
            if (data.error) throw new Error(`D1 query error: ${data.error}`);
            const result = single ? data.results?.[0] ?? null : data.results ?? [];
            if (isCachedQuery(sql, params)) {
                const key = getCacheKey(sql, params);
                avatarFlagCache.set(key, { value: result, timestamp: Date.now() });
            }
            return result;
        } catch (err) {
            lastError = err;
            clearTimeout(timeoutId);
            const msg = err.message || '';
            const isRetryable =
                msg.includes('timeout') ||
                msg.includes('reset') ||
                msg.includes('storage operation') ||
                msg.includes('ECONNRESET') ||
                msg.includes('fetch failed') ||
                err.name === 'AbortError' ||
                msg.includes('connect') ||
                msg.includes('network');
            if (isRetryable) {
                if (attempt < MAX_RETRIES) {
                    const jitter = Math.random() * 500;
                    const wait = (delay * attempt) + jitter;
                    await new Promise(resolve => setTimeout(resolve, wait));
                    delay = Math.min(delay * 1.5, 30000);
                    continue;
                }
            } else {
                break;
            }
        } finally {
            clearTimeout(timeoutId);
        }
    }
    console.error(`[Database] Query failed after ${MAX_RETRIES} attempts:`, lastError.message);
    throw lastError;
}
function invalidateAvatarCache() {
    avatarFlagCache.clear();
}
async function upsert(table, columns, values, single = false) {
    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
    if (table === 'avatar_flagged_settings') {
        invalidateAvatarCache();
    }
    return query(sql, values, single);
}
async function batchInsertOrReplace(table, columns, valuesArray) {
    if (!valuesArray || valuesArray.length === 0) return { results: [] };
    const placeholders = columns.map(() => '?').join(', ');
    const valueGroups = valuesArray.map(vals => `(${vals.map(() => '?').join(', ')})`).join(', ');
    const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES ${valueGroups}`;
    const flatValues = valuesArray.flat();
    if (table === 'avatar_flagged_settings') {
        invalidateAvatarCache();
    }
    return query(sql, flatValues);
}
async function deleteIn(table, column, values) {
    if (!values || values.length === 0) return { results: [] };
    const placeholders = values.map(() => '?').join(', ');
    const sql = `DELETE FROM ${table} WHERE ${column} IN (${placeholders})`;
    if (table === 'avatar_flagged_settings') {
        invalidateAvatarCache();
    }
    return query(sql, values);
}
async function batchQuery(queries) {
    if (!queries || queries.length === 0) return [];
    for (const q of queries) {
        const sql = (q.sql || '').trim().toLowerCase();
        if (sql.includes('avatar_flagged_settings') && (sql.includes('insert') || sql.includes('update') || sql.includes('delete'))) {
            invalidateAvatarCache();
        }
    }
    return Promise.all(queries.map(q => query(q.sql, q.params || [])));
}
async function transaction(queries) {
    if (!queries || queries.length === 0) return [];
    await query('BEGIN TRANSACTION');
    try {
        const results = [];
        for (const q of queries) {
            const result = await query(q.sql, q.params || []);
            results.push(result);
            const sql = (q.sql || '').trim().toLowerCase();
            if (sql.includes('avatar_flagged_settings') && (sql.includes('insert') || sql.includes('update') || sql.includes('delete'))) {
                invalidateAvatarCache();
            }
        }
        await query('COMMIT');
        return results;
    } catch (err) {
        await query('ROLLBACK');
        throw err;
    }
}
module.exports = {
    query,
    upsert,
    batchInsertOrReplace,
    deleteIn,
    batchQuery,
    transaction,
    invalidateAvatarCache,
};
