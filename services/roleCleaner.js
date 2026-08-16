// services/roleCleaner.js

const { ids } = require('../utils/helpers');
let isRunning = false;

const DELAY_MS = 1000;                // delay between individual role removals
const BATCH_SIZE = 2;                 // number of removals before a longer pause
const BATCH_PAUSE_MS = 3000;
const FETCH_CHUNK_SIZE = 100;         // number of members to fetch per request
const MAX_FETCH_RETRIES = 3;
const MAX_MEMBER_RETRIES = 3;

// ─── Fetch a single chunk of members with retry ──────────────────────
async function fetchMembersChunk(guild, after, limit) {
    let lastError;
    let delay = 2000;
    for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
        try {
            return await guild.members.fetch({ limit, after });
        } catch (err) {
            lastError = err;
            if (err.code === 429) {
                const wait = (err.retryAfter || 5) * 1000 + 500;
                console.warn(`[RoleCleaner] Rate limited on member chunk fetch, waiting ${wait}ms...`);
                await new Promise(resolve => setTimeout(resolve, wait));
                continue;
            }
            if (attempt < MAX_FETCH_RETRIES) {
                console.warn(`[RoleCleaner] Member chunk fetch attempt ${attempt} failed: ${err.message}, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
            }
            throw err;
        }
    }
    throw lastError || new Error('Failed to fetch member chunk after retries');
}

// ─── Clean roles ──────────────────────────────────────────────────────
async function cleanRoles(guild) {
    if (isRunning) {
        console.log('[RoleCleaner] ⏭️ Skipping – already running.');
        return;
    }
    isRunning = true;

    try {
        const TARGET_ROLES = ids.roles.restricted;
        const CREATOR_ROLE = ids.roles.creator;
        const membersToProcess = [];

        let lastId = '0';
        let chunkCount = 0;
        let totalMembers = 0;

        // ─── Paginated fetch ────────────────────────────────────────────
        while (true) {
            let chunk;
            try {
                chunk = await fetchMembersChunk(guild, lastId, FETCH_CHUNK_SIZE);
            } catch (err) {
                console.error(`[RoleCleaner] ❌ Failed to fetch chunk after retries:`, err.message);
                break;
            }

            if (chunk.size === 0) break;

            chunkCount++;
            totalMembers += chunk.size;
            console.log(`[RoleCleaner] Fetched chunk ${chunkCount} (${chunk.size} members, total: ${totalMembers})`);

            // Process this chunk
            for (const [, member] of chunk) {
                if (member.user.bot) continue;
                if (member.roles.cache.has(CREATOR_ROLE)) continue;

                const rolesToRemove = member.roles.cache.filter(role => TARGET_ROLES.includes(role.id));
                if (rolesToRemove.size > 0) {
                    membersToProcess.push({ member, rolesToRemove });
                }
            }

            // Get the last key for next iteration
            const lastKey = chunk.lastKey();
            if (!lastKey || lastKey === lastId) break;
            lastId = lastKey;
        }

        console.log(`[RoleCleaner] Fetched ${totalMembers} members across ${chunkCount} chunks. Found ${membersToProcess.length} members needing role cleanup.`);

        if (membersToProcess.length === 0) {
            console.log('[RoleCleaner] No members need role removal.');
            return;
        }

        // ─── Process role removals ──────────────────────────────────────
        let processed = 0;
        let removedCount = 0;
        let batchCounter = 0;
        let errors = 0;

        for (const { member, rolesToRemove } of membersToProcess) {
            let removed = false;
            for (let attempt = 1; attempt <= MAX_MEMBER_RETRIES; attempt++) {
                try {
                    await member.roles.remove(rolesToRemove);
                    removedCount += rolesToRemove.size;
                    removed = true;
                    break;
                } catch (err) {
                    if (err.code === 429) {
                        const wait = (err.retryAfter || 5) * 1000 + 500;
                        console.warn(`[RoleCleaner] ⏳ Rate limited on ${member.user.tag}, waiting ${wait}ms...`);
                        await new Promise(resolve => setTimeout(resolve, wait));
                        continue;
                    } else {
                        errors++;
                        console.error(`❌ Failed to remove roles from ${member.user.tag} (attempt ${attempt}):`, err.message);
                        break;
                    }
                }
            }
            if (!removed) {
                errors++;
            }

            processed++;
            batchCounter++;
            if (batchCounter >= BATCH_SIZE) {
                await new Promise(resolve => setTimeout(resolve, BATCH_PAUSE_MS));
                batchCounter = 0;
            } else {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }

        console.log(`[RoleCleaner] Done. Processed ${processed} members, removed ${removedCount} roles, ${errors} errors.`);

    } catch (err) {
        console.error("[RoleCleaner] ❌ Fatal error:", err);
    } finally {
        isRunning = false;
    }
}

module.exports = { cleanRoles };
