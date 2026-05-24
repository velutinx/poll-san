// events/guildMemberAdd.js

const supabase = require('../services/supabase');
const h = require('../utils/helpers');

module.exports = async (member) => {
    try {
        const supporterRoleId = h.ids.roles.supporter;
        const unverifiedRoleId = h.ids.roles.unverified;
        
        if (member.user.bot) return;
        if (member.roles.cache.has(h.ids.roles.creator)) {
            console.log(`⏭️ Skipped all role management for ${member.user.tag} (Creator, exempt)`);
            return;
        }
        
        const hasSupporter = member.roles.cache.has(supporterRoleId);
        if (!hasSupporter) {
            const unverifiedRole = member.guild.roles.cache.get(unverifiedRoleId);
            if (unverifiedRole) {
                await member.roles.add(unverifiedRole);
                console.log(`✅ Assigned Unverified role to ${member.user.tag}`);
            } else {
                console.error(`❌ Unverified role not found (ID: ${unverifiedRoleId})`);
            }
        } else {
            console.log(`⏭️ Skipped Unverified role for ${member.user.tag} (already Supporter)`);
        }
    } catch (err) {
        console.error('Error assigning Unverified role:', err);
    }

    setTimeout(async () => {
        try {
            const freshMember = await member.guild.members.fetch(member.id).catch(() => null);
            if (!freshMember) return;

            const restrictedRoles = h.ids.roles.restricted;
            
            if (restrictedRoles && Array.isArray(restrictedRoles)) {
                const rolesToRemove = freshMember.roles.cache.filter(role => 
                    restrictedRoles.includes(role.id)
                );

                if (rolesToRemove.size > 0) {
                    await freshMember.roles.remove(rolesToRemove);
                    console.log(`⚡ Instant-removed ${rolesToRemove.size} restricted roles from ${freshMember.user.tag}`);
                }
            }
        } catch (e) {
            if (e.code === 50013) {
                console.error('❌ Permission Error: Poll-san role must be higher than the restricted roles.');
            } else {
                console.error('Role Removal Error (Instant):', e);
            }
        }
    }, 10000); 
};
