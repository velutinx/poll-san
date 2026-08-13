// services/roleCleaner.js

const { ids } = require('../utils/helpers');
let isRunning = false;
const DELAY_MS = 250;
const BATCH_SIZE = 5;
const BATCH_PAUSE_MS = 2000;
async function cleanRoles(guild) {
    if (isRunning) {
        console.log('[RoleCleaner] ⏭️ Skipping – already running.');
        return;
    }
    isRunning = true;
    try {
        const members = await guild.members.fetch();
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
            try {
                await member.roles.remove(rolesToRemove);
                removedCount += rolesToRemove.size;
            } catch (err) {
                if (err.code === 429) {
                    const waitTime = (err.retryAfter || 5) * 1000 + 500;
                    console.warn(`[RoleCleaner] ⏳ Rate limited on ${member.user.tag}, waiting ${waitTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    try {
                        await member.roles.remove(rolesToRemove);
                        removedCount += rolesToRemove.size;
                    } catch (retryErr) {
                        errors++;
                        console.error(`❌ Retry failed for ${member.user.tag}:`, retryErr.message);
                    }
                } else {
                    errors++;
                    console.error(`❌ Failed to remove roles from ${member.user.tag}:`, err.message);
                }
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
