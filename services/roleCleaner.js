// services/roleCleaner.js

const { ids } = require('../utils/helpers');
let isRunning = false;
const DELAY_MS = 1000;
const BATCH_SIZE = 2;
const BATCH_PAUSE_MS = 3000;
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
    if (isRunning) {
        console.log('[RoleCleaner] ⏭️ Skipping – already running.');
        return;
    }
    isRunning = true;
    try {
        let members;
        try {
            members = await fetchMembersWithRetry(guild);
        } catch (err) {
            console.error('[RoleCleaner] ❌ Failed to fetch members after retries:', err.message);
            return;
        }
        const TARGET_ROLES = ids.roles.restricted;
        const CREATOR_ROLE = ids.roles.creator;
        const membersToProcess = [];
        for (const [, member] of members) {
            if (member.user.bot) continue;
            if (member.roles.cache.has(CREATOR_ROLE)) continue;
            const rolesToRemove = member.roles.cache.filter(role => TARGET_ROLES.includes(role.id));
            if (rolesToRemove.size > 0) {
                membersToProcess.push({ member, rolesToRemove });
            }
        }
        if (membersToProcess.length === 0) {
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
    } catch (err) {
        console.error("[RoleCleaner] ❌ Fatal error:", err);
    } finally {
        isRunning = false;
    }
}
module.exports = { cleanRoles };
