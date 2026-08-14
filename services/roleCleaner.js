// services/roleCleaner.js
const { ids } = require('../utils/helpers');

// ─── Mutex to prevent concurrent runs ──────────────────────────────
let isRunning = false;

// ─── Configuration ───────────────────────────────────────────────────
const DELAY_MS = 1000;                 // 1 second between members
const BATCH_SIZE = 2;                  // 2 members per batch
const BATCH_PAUSE_MS = 3000;           // 3 second pause after each batch
const MAX_FETCH_RETRIES = 3;
const MAX_MEMBER_RETRIES = 3;

async function fetchMembersWithRetry(guild) {
    let lastError;
    let delay = 2000;
    for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
        try {
            return await guild.members.fetch();
        } catch (err) {
            lastError = err;
            if (err.code === 429) {
                const wait = (err.retryAfter || 5) * 1000 + 500;
                console.warn(`[RoleCleaner] Rate limited on member fetch, waiting ${wait}ms...`);
                await new Promise(resolve => setTimeout(resolve, wait));
                continue;
            }
            // If not rate limit, retry with delay
            if (attempt < MAX_FETCH_RETRIES) {
                console.warn(`[RoleCleaner] Member fetch attempt ${attempt} failed: ${err.message}, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
            }
            throw err;
        }
    }
    throw lastError || new Error('Failed to fetch members after retries');
}

async function cleanRoles(guild) {
    // ─── Prevent concurrent runs ────────────────────────────────────
    if (isRunning) {
        console.log('[RoleCleaner] ⏭️ Skipping – already running.');
        return;
    }
    isRunning = true;

    try {
        console.log(`🧹 Starting role cleanup for guild: ${guild.name}`);
        
        // ─── Fetch members with retry ──────────────────────────────
        let members;
        try {
            members = await fetchMembersWithRetry(guild);
        } catch (err) {
            console.error('[RoleCleaner] ❌ Failed to fetch members after retries:', err.message);
            return;
        }

        const TARGET_ROLES = ids.roles.restricted;
        const CREATOR_ROLE = ids.roles.creator;
        
        // ─── Pre‑filter: only process members who actually have restricted roles ──
        const membersToProcess = [];
        for (const [, member] of members) {
            if (member.user.bot) continue;
            if (member.roles.cache.has(CREATOR_ROLE)) continue;
            
            const rolesToRemove = member.roles.cache.filter(role => TARGET_ROLES.includes(role.id));
            if (rolesToRemove.size > 0) {
                membersToProcess.push({ member, rolesToRemove });
            }
        }

        console.log(`[RoleCleaner] Found ${membersToProcess.length} members with restricted roles (out of ${members.size} total).`);

        if (membersToProcess.length === 0) {
            console.log('[RoleCleaner] ✅ No restricted roles found – nothing to do.');
            return;
        }

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
                    console.log(`✅ Removed ${rolesToRemove.size} restricted role(s) from ${member.user.tag}`);
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

            // ─── Batch pause ──────────────────────────────────────────
            if (batchCounter >= BATCH_SIZE) {
                await new Promise(resolve => setTimeout(resolve, BATCH_PAUSE_MS));
                batchCounter = 0;
            } else {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }

        console.log(`✅ Role cleanup finished. Processed ${processed} members, removed ${removedCount} restricted roles. Errors: ${errors}`);

    } catch (err) {
        console.error("[RoleCleaner] ❌ Fatal error:", err);
    } finally {
        isRunning = false;
    }
}

module.exports = { cleanRoles };
