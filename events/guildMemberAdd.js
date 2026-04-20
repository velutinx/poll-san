// this is poll-san/events/guildMemberAdd.js

const supabase = require('../services/supabase');
const { parseMessage } = require('../services/parserService');
const h = require('../utils/helpers');

module.exports = async (member) => {
    // --- 0. ASSIGN UNVERIFIED ROLE (skip if supporter or bot) ---
    try {
        const supporterRoleId = h.ids.roles.supporter;
        const unverifiedRoleId = h.ids.roles.unverified;
        
        // Skip bots
        if (member.user.bot) return;
        
        // Check if member already has Supporter role (from external sync like Patreon)
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
                // Parse the template and clean up duplication
                const parsedContent = parseMessage(settings.welcome_message, member);
                let cleanedContent = parsedContent;
                const username = member.user.username;
                if (cleanedContent.startsWith(username)) {
                    cleanedContent = cleanedContent.slice(username.length).trimStart();
                }

                const finalMessage = `<@${member.id}> ${cleanedContent}`;
                
                // Send the message and store the sent message object
                const sent = await channel.send(finalMessage);
                
                // React with the animated wave
                await sent.react(h.releaseEmojis.waveId).catch(err => console.error("Failed to react:", err));
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
