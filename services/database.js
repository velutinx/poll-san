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
 * Upsert (insert or replace) a row into a table that has a PRIMARY KEY or UNIQUE constraint.
 * This builds an INSERT OR REPLACE statement automatically.
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

module.exports = {
    query,
    upsert,
};
