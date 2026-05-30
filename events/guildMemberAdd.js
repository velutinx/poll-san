// events/guildMemberAdd.js

const { MessageFlags } = require('discord.js');
const supabase = require('../services/supabase');
const { parseMessage } = require('../services/parserService');
const h = require('../utils/helpers');
const { processMember, NUDITY_THRESHOLD } = require('../features/avatarScanner');

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

        // Scan avatar on join – only alert me if it's flagged
        processMember(member.client, member, NUDITY_THRESHOLD, true).catch(err =>
            console.error('Avatar scan on join failed:', err)
        );

        // ----- WELCOME MESSAGE -----
        try {
            const { data: settings } = await supabase
                .from(h.tables.SERVER_SETTINGS)
                .select('welcome_channel_id, welcome_message')
                .eq('guild_id', member.guild.id)
                .single();

            if (settings && settings.welcome_channel_id && settings.welcome_message) {
                const channel = await member.guild.channels.fetch(settings.welcome_channel_id);
                if (channel) {
                    const parsedContent = parseMessage(settings.welcome_message, member);
                    let cleanedContent = parsedContent;
                    const username = member.user.username;
                    if (cleanedContent.startsWith(username)) {
                        cleanedContent = cleanedContent.slice(username.length).trimStart();
                    }

                    const finalMessage = `<@${member.id}> ${cleanedContent}`;

                    let webhook = (await channel.fetchWebhooks()).find(w => w.name === 'Welcome Bot');
                    if (!webhook) {
                        webhook = await channel.createWebhook({
                            name: 'Welcome Bot',
                            avatar: h.urls.LOGO_URL
                        });
                    }

                    const sent = await webhook.send({
                        content: finalMessage,
                        username: 'Welcome Bot',
                        avatarURL: h.urls.LOGO_URL,
                        flags: [MessageFlags.SuppressNotifications]
                    });

                    // Animated wave reaction
                    await sent.react(h.releaseEmojis.WAVE).catch(err => console.error("Failed to react:", err));
                }
            }
        } catch (err) {
            console.error('Welcome Message Error:', err);
        }

    } catch (err) {
        console.error('Error assigning Unverified role:', err);
    }

    // ==================== RESTRICTED ROLE CLEANUP ====================
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
