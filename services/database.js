// services/database.js
const h = require('../utils/helpers');
const WORKER_URL = h.urls.CLOUDFLARE_D1_WORKER;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 90000;
async function query(sql, params = [], single = false) {
    if (!WORKER_URL || WORKER_URL === "https://your-worker-name.your-subdomain.workers.dev") {
        throw new Error("CLOUDFLARE_D1_WORKER is not configured.");
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

            if (elapsed > 5000) {
                console.log(`[Database] Slow query (${elapsed}ms, attempt ${attempt}): ${sql.substring(0, 100)}`);
            }

            return single ? data.results?.[0] ?? null : data.results ?? [];

        } catch (err) {
            lastError = err;
            clearTimeout(timeoutId);
            const msg = err.message || '';
            if (msg.includes('timeout') || msg.includes('reset') || msg.includes('storage operation')) {
                if (attempt < MAX_RETRIES) {
                    const jitter = Math.random() * 500;
                    const wait = (delay * attempt) + jitter;
                    console.log(`⚠️ D1 timeout (attempt ${attempt}), retrying in ${wait}ms...`);
                    await new Promise(resolve => setTimeout(resolve, wait));
                    continue;
                }
            }

            break;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    console.error(`[Database] Query failed after ${MAX_RETRIES} attempts:`, lastError.message);
    throw lastError;
}

async function upsert(table, columns, values, single = false) {
    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
    return query(sql, values, single);
}

async function batchInsertOrReplace(table, columns, valuesArray) {
    if (!valuesArray || valuesArray.length === 0) return { results: [] };
    const placeholders = columns.map(() => '?').join(', ');
    const valueGroups = valuesArray.map(vals => `(${vals.map(() => '?').join(', ')})`).join(', ');
    const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES ${valueGroups}`;
    const flatValues = valuesArray.flat();
    return query(sql, flatValues);
}

async function deleteIn(table, column, values) {
    if (!values || values.length === 0) return { results: [] };
    const placeholders = values.map(() => '?').join(', ');
    const sql = `DELETE FROM ${table} WHERE ${column} IN (${placeholders})`;
    return query(sql, values);
}

async function batchQuery(queries) {
    if (!queries || queries.length === 0) return [];
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
};
