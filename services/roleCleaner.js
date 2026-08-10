// services/roleCleaner.js
const { ids } = require('../utils/helpers');
const DELAY_MS = 150;
const BATCH_SIZE = 10;
const BATCH_PAUSE_MS = 1000;
async function cleanRoles(guild) {
    try {
        console.log(`🧹 Starting role cleanup for guild: ${guild.name}`);
        const members = await guild.members.fetch();
        const TARGET_ROLES = ids.roles.restricted;
        const CREATOR_ROLE = ids.roles.creator;
        let processed = 0;
        let removedCount = 0;
        let batchCounter = 0;
        for (const [, member] of members) {
            if (member.roles.cache.has(CREATOR_ROLE)) continue;

            const rolesToRemove = member.roles.cache.filter(role => TARGET_ROLES.includes(role.id));
            if (rolesToRemove.size > 0) {
                try {
                    await member.roles.remove(rolesToRemove);
                    removedCount += rolesToRemove.size;
                } catch (err) {
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
        console.error("Error in role cleaner service:", err);
    }
}
module.exports = { cleanRoles };
