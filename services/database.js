// services/database.js
const h = require('../utils/helpers');

const WORKER_URL = h.urls.CLOUDFLARE_D1_WORKER;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 15000; // 15 seconds

/**
 * Execute a SQL query against Cloudflare D1 with automatic retries.
 * @param {string} sql - SQL statement with ? placeholders
 * @param {any[]} [params] - Array of parameter values
 * @param {boolean} [single=false] - If true, returns the first row (or null); else returns an array
 * @returns {Promise<any>} Query result
 */
async function query(sql, params = [], single = false) {
    if (!WORKER_URL || WORKER_URL === 'https://your-worker-name.your-subdomain.workers.dev') {
        throw new Error('CLOUDFLARE_D1_WORKER is not configured. Set it in helpers.js urls.');
    }

    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

            const res = await fetch(`${WORKER_URL}/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql, params }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
                const text = await res.text();
                throw new Error(`D1 Worker error (${res.status}): ${text}`);
            }

            const data = await res.json();

            if (data.error) {
                throw new Error(`D1 query error: ${data.error}`);
            }

            if (single) {
                return data.results?.[0] ?? null;
            }
            return data.results ?? [];

        } catch (err) {
            lastError = err;
            console.warn(`[Database] Query attempt ${attempt}/${MAX_RETRIES} failed:`, err.message);
            if (attempt < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            }
        }
    }

    throw lastError;
}

module.exports = { query };
