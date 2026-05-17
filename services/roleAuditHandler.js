const h = require('../utils/helpers');

const SUPPORTER_ROLE = h.ids.roles.supporter;
const MEMBER_ROLE = h.ids.roles.member;
const CREATOR_ROLE = h.ids.roles.creator;
const TIER_ROLES = Object.values(h.weights.tierMapping);

// Regex to find the user ID from embed author field or field value
const USER_ID_REGEX = /@.*?\((\d{17,20})\)/;  // matches @username (123456789...)

async function enforceRoleConsistency(member) {
    // ignore creator
    if (member.roles.cache.has(CREATOR_ROLE)) return;

    try {
        const hasSupporter = member.roles.cache.has(SUPPORTER_ROLE);
        const hasMember = member.roles.cache.has(MEMBER_ROLE);
        const hasAnyPaidTier = TIER_ROLES.some(id => member.roles.cache.has(id));

        if (hasSupporter && hasMember) {
            await member.roles.remove(MEMBER_ROLE);
            console.log(`[AuditLogHandler] Removed Member from ${member.user.tag} (now Supporter).`);
        } else if (!hasSupporter && !hasMember && !hasAnyPaidTier) {
            await member.roles.add(MEMBER_ROLE);
            console.log(`[AuditLogHandler] Added Member to ${member.user.tag} (no longer Supporter).`);
        }
    } catch (err) {
        console.error(`[AuditLogHandler] Error for ${member.user.tag}:`, err);
    }
}

module.exports = function initAuditLogHandler(client) {
    const channel = client.channels.cache.get(h.ids.channels.audit_log);
    if (!channel) {
        console.error(`[AuditLogHandler] ❌ Could not find audit log channel ${h.ids.channels.audit_log}`);
        return;
    }

    client.on('messageCreate', async (message) => {
        if (message.channel.id !== h.ids.channels.audit_log) return;
        if (!message.embeds || message.embeds.length === 0) return;

        // We need the embed that contains "User roles added" or "User roles removed"
        const embed = message.embeds[0];
        const title = embed.title || '';
        const description = embed.description || '';

        // Determine if it's an add or remove event
        const isAdd = title.includes('added') || description.includes('Added:');
        const isRemove = title.includes('removed') || description.includes('Removed:');

        if (!isAdd && !isRemove) return;

        // Extract the user ID – it appears in the description like:
        // "User: @Username (ID)" or just "User: @Username" with the ID elsewhere
        const userIdMatch = description.match(/ID:\s*(\d{17,20})/) || description.match(USER_ID_REGEX);
        if (!userIdMatch) return;

        const discordId = userIdMatch[1];
        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        if (!guild) return;

        let member;
        try {
            member = await guild.members.fetch(discordId);
        } catch (err) {
            // User may have left the server
            console.log(`[AuditLogHandler] User ${discordId} not in guild, skipping.`);
            return;
        }

        // Wait a short moment for Discord to actually update the roles in cache
        await new Promise(resolve => setTimeout(resolve, 200));

        // Enforce consistency
        await enforceRoleConsistency(member);
    });

};
