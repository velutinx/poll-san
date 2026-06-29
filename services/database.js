// services/database.js
const h = require('../utils/helpers');

const WORKER_URL = h.urls.CLOUDFLARE_D1_WORKER;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 60000;

async function query(sql, params = [], single = false) {
    if (
        !WORKER_URL ||
        WORKER_URL ===
            "https://your-worker-name.your-subdomain.workers.dev"
    ) {
        throw new Error(
            "CLOUDFLARE_D1_WORKER is not configured. Set it in helpers.js urls."
        );
    }

    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(
            () => controller.abort(),
            REQUEST_TIMEOUT_MS
        );

        const startTime = Date.now();

        try {
            const res = await fetch(`${WORKER_URL}/query`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    sql,
                    params,
                }),
                signal: controller.signal,
            });

            const elapsed = Date.now() - startTime;

            if (!res.ok) {
                const text = await res.text();
                throw new Error(
                    `D1 Worker error (${res.status}): ${text}`
                );
            }

            const data = await res.json();

            if (data.error) {
                throw new Error(`D1 query error: ${data.error}`);
            }

            // Log slow queries (threshold now 2s)
            if (elapsed > 2000) {
                console.log(
                    `[Database] Slow query (${elapsed}ms, attempt ${attempt}): ${sql.substring(
                        0,
                        100
                    )}`
                );
            }

            return single
                ? data.results?.[0] ?? null
                : data.results ?? [];
        } catch (err) {
            lastError = err;

            const elapsed = Date.now() - startTime;

            if (err.name === "AbortError") {
                console.warn(
                    `[Database] Query attempt ${attempt}/${MAX_RETRIES} timed out after ${elapsed}ms`
                );
            } else {
                console.warn(
                    `[Database] Query attempt ${attempt}/${MAX_RETRIES} failed`
                );
            }

            console.warn({
                attempt,
                errorName: err.name,
                message: err.message,
                elapsed,
                sql:
                    sql.length > 200
                        ? sql.substring(0, 200) + "..."
                        : sql,
                params,
            });

            if (attempt < MAX_RETRIES) {
                // Exponential backoff with jitter
                const jitter = Math.random() * 500;
                const delay = (RETRY_DELAY_MS * attempt) + jitter;
                console.log(`[Database] Retrying in ${Math.round(delay)}ms...`);
                await new Promise((resolve) =>
                    setTimeout(resolve, delay)
                );
            }
        } finally {
            clearTimeout(timeoutId);
        }
    }

    throw lastError;
}

/**
 * Upsert (insert or replace) a single row.
 * @param {string} table - Table name
 * @param {string[]} columns - Array of column names
 * @param {any[]} values - Array of values in the same order as columns
 * @param {boolean} single - Return single result?
 * @returns {Promise<any>}
 */
async function upsert(table, columns, values, single = false) {
    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
    return query(sql, values, single);
}

/**
 * Batch insert or replace multiple rows in a single SQL statement.
 * All rows must have the same columns (uses first row's columns).
 *
 * @param {string} table - Table name
 * @param {string[]} columns - Array of column names (same for all rows)
 * @param {any[][]} valuesArray - Array of value arrays, each corresponding to a row
 * @returns {Promise<any>} - Returns the result of the query (usually an array of results)
 */
async function batchInsertOrReplace(table, columns, valuesArray) {
    if (!valuesArray || valuesArray.length === 0) {
        return { results: [] };
    }
    const placeholders = columns.map(() => '?').join(', ');
    const valueGroups = valuesArray.map(vals => `(${vals.map(() => '?').join(', ')})`).join(', ');
    const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES ${valueGroups}`;
    const flatValues = valuesArray.flat();
    return query(sql, flatValues);
}

/**
 * Delete rows where column IN (values) in a single query.
 *
 * @param {string} table - Table name
 * @param {string} column - Column name for the IN clause
 * @param {any[]} values - Array of values to match
 * @returns {Promise<any>}
 */
async function deleteIn(table, column, values) {
    if (!values || values.length === 0) {
        return { results: [] };
    }
    const placeholders = values.map(() => '?').join(', ');
    const sql = `DELETE FROM ${table} WHERE ${column} IN (${placeholders})`;
    return query(sql, values);
}

/**
 * Execute multiple queries in parallel (reduces total time, but does not reduce D1 query count).
 * Useful for SELECTs that cannot be batched.
 *
 * @param {Array<{sql: string, params?: any[]}>} queries
 * @returns {Promise<any[]>} - Array of results in the same order
 */
async function batchQuery(queries) {
    if (!queries || queries.length === 0) return [];
    return Promise.all(
        queries.map(q => query(q.sql, q.params || []))
    );
}

module.exports = {
    query,
    upsert,
    batchInsertOrReplace,
    deleteIn,
    batchQuery,
};
