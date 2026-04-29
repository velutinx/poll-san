// services/roleCleaner.js
const { ids } = require('../utils/helpers');

async function cleanRoles(guild) {
    try {
        const members = await guild.members.fetch();
        const TARGET_ROLES = ids.roles.restricted;
        const CREATOR_ROLE = ids.roles.creator; // 👈 add this
        
        for (const [, member] of members) { // use for...of to handle async properly
            // Skip if member has Creator role
            if (member.roles.cache.has(CREATOR_ROLE)) continue;
            
            const rolesToRemove = member.roles.cache.filter(role => TARGET_ROLES.includes(role.id));
            
            if (rolesToRemove.size > 0) {
                console.log(`🧹 Removing restricted roles from ${member.user.tag}`);
                await member.roles.remove(rolesToRemove).catch(err => 
                    console.error(`Failed to remove roles from ${member.user.tag}:`, err)
                );
            }
        }
    } catch (err) {
        console.error("Error in role cleaner service:", err);
    }
}
module.exports = { cleanRoles };
