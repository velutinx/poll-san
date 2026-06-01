// services/database.js
const h = require('../utils/helpers');

const WORKER_URL = h.urls.CLOUDFLARE_D1_WORKER;

/**
 * Execute a SQL query against Cloudflare D1.
 * @param {string} sql - SQL statement with ? placeholders
 * @param {any[]} [params] - Array of parameter values
 * @param {boolean} [single=false] - If true, returns the first row (or null); else returns an array
 * @returns {Promise<any>} Query result
 */
async function query(sql, params = [], single = false) {
    if (!WORKER_URL || WORKER_URL === 'https://your-worker-name.your-subdomain.workers.dev') {
        throw new Error('CLOUDFLARE_D1_WORKER is not configured. Set it in helpers.js urls.');
    }

    const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params })
    });

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
}

module.exports = { query };
