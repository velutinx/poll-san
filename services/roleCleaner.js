// this is poll-san/services/queueService.js

roleCleaner.js
const TARGET_ROLES = ['1468666174102442227', '1467233133362544642', '1487554855068368916'];

async function cleanRoles(guild) {
    try {
        // Fetch all members to ensure cache is up to date
        const members = await guild.members.fetch();
        
        members.forEach(async (member) => {
            const rolesToRemove = member.roles.cache.filter(role => TARGET_ROLES.includes(role.id));
            
            if (rolesToRemove.size > 0) {
                console.log(`🧹 Removing restricted roles from ${member.user.tag}`);
                await member.roles.remove(rolesToRemove).catch(err => 
                    console.error(`Failed to remove roles from ${member.user.tag}:`, err)
                );
            }
        });
    } catch (err) {
        console.error("Error in role cleaner service:", err);
    }
}

module.exports = { cleanRoles, TARGET_ROLES };
