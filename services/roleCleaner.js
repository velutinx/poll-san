// services/roleCleaner.js
const { ids } = require('../utils/helpers');

// ─── Mutex to prevent concurrent runs ──────────────────────────────
let isRunning = false;

// ─── Configuration ───────────────────────────────────────────────────
const DELAY_MS = 250;                 // 250ms between members
const BATCH_SIZE = 5;                 // 5 members per batch
const BATCH_PAUSE_MS = 2000;          // 2 second pause after each batch

async function cleanRoles(guild) {
    // ─── Prevent concurrent runs ────────────────────────────────────
    if (isRunning) {
        console.log('[RoleCleaner] ⏭️ Skipping – already running.');
        return;
    }
    isRunning = true;

    try {
        console.log(`🧹 Starting role cleanup for guild: ${guild.name}`);
        const members = await guild.members.fetch();
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
            try {
                await member.roles.remove(rolesToRemove);
                removedCount += rolesToRemove.size;
                console.log(`✅ Removed ${rolesToRemove.size} restricted role(s) from ${member.user.tag}`);
            } catch (err) {
                // ─── Handle rate limits with retry ─────────────────────
                if (err.code === 429) {
                    const waitTime = (err.retryAfter || 5) * 1000 + 500;
                    console.warn(`[RoleCleaner] ⏳ Rate limited on ${member.user.tag}, waiting ${waitTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    try {
                        await member.roles.remove(rolesToRemove);
                        removedCount += rolesToRemove.size;
                        console.log(`✅ Retry succeeded for ${member.user.tag}`);
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
