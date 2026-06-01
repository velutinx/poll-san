// utils/supabaseCircuitBreaker.js
let consecutiveFailures = 0;
let blockUntil = 0;
const MAX_BACKOFF = 5 * 60 * 1000; // 5 minutes max pause

function isSupabaseDown(err) {
    const msg = err?.message || String(err);
    return msg.includes('522') || msg.includes('<!DOCTYPE html>');
}

async function guardQuery(fn) {
    // If we are in a cool‑down period, throw immediately so the caller can back off
    if (Date.now() < blockUntil) {
        throw new Error('Supabase circuit breaker active – skipping query');
    }

    try {
        const result = await fn();
        // Success – reset failure count
        consecutiveFailures = 0;
        blockUntil = 0;
        return result;
    } catch (err) {
        if (isSupabaseDown(err)) {
            consecutiveFailures++;
            const delay = Math.min(1000 * Math.pow(2, consecutiveFailures), MAX_BACKOFF);
            blockUntil = Date.now() + delay;
            console.warn(`Supabase down – pausing queries for ${delay / 1000}s`);
        }
        throw err;
    }
}

module.exports = { guardQuery };
