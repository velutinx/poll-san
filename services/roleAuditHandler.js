const h = require('../utils/helpers');

const SUPPORTER_ROLE = h.ids.roles.supporter;
const MEMBER_ROLE = h.ids.roles.member;
const CREATOR_ROLE = h.ids.roles.creator;
const TIER_ROLES = Object.values(h.weights.tierMapping);

// Audit messages are sent by webhooks. We’ll ignore our own bot’s webhook.
const OWN_WEBHOOK_NAME = 'SapphireAPP';   // your bot’s name used for audit logs

// Regex to extract role IDs from the embed’s description
// Example: "Added: @Supporter, @✨ Bronze" or "Removed: @Supporter"
const ROLE_MENTION_REGEX = /<@&(\d{17,20})>/g;

function extractRoleIds(text) {
    const ids = new Set();
    let match;
    while ((match = ROLE_MENTION_REGEX.exec(text)) !== null) {
        ids.add(match[1]);
    }
    return ids;
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

        // Ignore messages from our own webhook to prevent loops
        if (message.webhookId) {
            try {
                const webhook = await client.fetchWebhook(message.webhookId);
                if (webhook.name === OWN_WEBHOOK_NAME) return;
            } catch (_) { /* ignore if can't fetch */ }
        }

        const embed = message.embeds[0];
        const description = embed.description || '';
        const title = embed.title || '';

        const isAdd = title.includes('added') || description.includes('Added:');
        const isRemove = title.includes('removed') || description.includes('Removed:');

        if (!isAdd && !isRemove) return;

        // Extract the user ID from description (e.g., "User: @Pete (12345)" or "ID: 12345")
        const userIdMatch = description.match(/ID:\s*(\d{17,20})/) ||
                            description.match(/@.*?\((\d{17,20})\)/);
        if (!userIdMatch) return;

        const discordId = userIdMatch[1];
        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        if (!guild) return;

        let member;
        try {
            member = await guild.members.fetch(discordId);
        } catch (err) {
            console.log(`[AuditLogHandler] User ${discordId} not in guild, skipping.`);
            return;
        }

        // Find out exactly which roles were added/removed from the embed
        const changedRoleIds = extractRoleIds(description);

        // ---- CASE: Supporter was ADDED ----
        if (isAdd && changedRoleIds.has(SUPPORTER_ROLE)) {
            // Remove Member and Unverified if they still exist
            if (member.roles.cache.has(MEMBER_ROLE)) {
                await member.roles.remove(MEMBER_ROLE);
                console.log(`[AuditLogHandler] Removed Member from ${member.user.tag} (Supporter added).`);
            }
            if (member.roles.cache.has(h.ids.roles.unverified)) {
                await member.roles.remove(h.ids.roles.unverified);
                console.log(`[AuditLogHandler] Removed Unverified from ${member.user.tag} (Supporter added).`);
            }
            return;
        }

        // ---- CASE: Supporter was REMOVED ----
        if (isRemove && changedRoleIds.has(SUPPORTER_ROLE)) {
            // Wait a short time for Discord to propagate the role change
            await new Promise(resolve => setTimeout(resolve, 500));
            // Re-fetch to get definitive roles
            const freshMember = await guild.members.fetch(discordId).catch(() => null);
            if (!freshMember) return;

            const hasAnyPaidTier = TIER_ROLES.some(roleId => freshMember.roles.cache.has(roleId));
            if (!hasAnyPaidTier && !freshMember.roles.cache.has(MEMBER_ROLE)) {
                await freshMember.roles.add(MEMBER_ROLE);
                console.log(`[AuditLogHandler] Added Member to ${freshMember.user.tag} (Supporter removed).`);
            }
            return;
        }
    });

    console.log(`[AuditLogHandler] ✅ Watching audit log channel ${h.ids.channels.audit_log}`);
};
