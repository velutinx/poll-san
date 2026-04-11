// this is poll-san/events/guildMemberAdd.js

const supabase = require('../services/supabase');
const { parseMessage } = require('../services/parserService');
const h = require('../utils/helpers'); // Switch to your new helpers file

module.exports = async (member) => {
    // --- 1. WELCOME MESSAGE LOGIC ---
    try {
        const { data: settings } = await supabase
            .from('server_settings')
            .select('welcome_channel_id, welcome_message')
            .eq('guild_id', member.guild.id)
            .single();

        if (settings && settings.welcome_channel_id && settings.welcome_message) {
            const channel = await member.guild.channels.fetch(settings.welcome_channel_id);
            if (channel) {
                const finalMessage = parseMessage(settings.welcome_message, member);
                
                const sent = await channel.send(finalMessage);
                
                await sent.react('👋').catch(err => console.error("Failed to react:", err));
            }
        }
    } catch (err) {
        console.error('Welcome Message Error:', err);
    }

    // --- 2. INSTANT ROLE CLEANER (10s Delay) ---
    setTimeout(async () => {
        try {
            const freshMember = await member.guild.members.fetch(member.id).catch(() => null);
            if (!freshMember) return;

            // Updated to use h.ids.roles.restricted from your helpers.js
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
