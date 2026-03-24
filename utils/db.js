const supabase = require('../services/supabase');

/**
 * Executes a Supabase query with retries.
 * @param {Function} queryFn - Async function that performs the Supabase operation.
 * @param {number} maxRetries - Maximum number of retry attempts.
 * @param {number} baseDelay - Base delay in ms (exponential backoff).
 * @returns {Promise<any>} Result of the query.
 */
async function supabaseRetry(queryFn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const result = await queryFn();
            return result;
        } catch (err) {
            lastError = err;
            console.warn(`Supabase query failed (attempt ${attempt + 1}/${maxRetries}):`, err.message);
            if (attempt === maxRetries - 1) break;
            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

module.exports = { supabaseRetry };
