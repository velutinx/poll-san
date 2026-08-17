// events/roleManager.js

const h = require('../utils/helpers');
const { enforceRolesForMember } = require('../services/membershipSync');
const SUPPORTER_ROLE = h.ids.roles.supporter;
const MEMBER_ROLE = h.ids.roles.member;
const UNVERIFIED_ROLE = h.ids.roles.unverified;
const CREATOR_ROLE = h.ids.roles.creator;
const TIER_ROLES = Object.values(h.weights.tierMapping);
async function enforceRoles(member) {
    if (!member) return;
    if (member.user.bot) return;
    if (member.roles.cache.has(CREATOR_ROLE)) return;
    const hasUnverified = member.roles.cache.has(UNVERIFIED_ROLE);
    const hasMember = member.roles.cache.has(MEMBER_ROLE);
    const hasSupporter = member.roles.cache.has(SUPPORTER_ROLE);
    let changes = false;
    if (hasUnverified && (hasMember || hasSupporter)) {
        await member.roles.remove(UNVERIFIED_ROLE);
        console.log(`[RoleManager] Removed Unverified from ${member.user.tag} (had Member or Supporter)`);
        changes = true;
    }
    if (hasMember && hasSupporter) {
        await member.roles.remove(MEMBER_ROLE);
        changes = true;
    }
    await enforceRolesForMember(member);
    return changes;
}
module.exports = async (oldMember, newMember) => {
    if (oldMember.roles.cache.size === newMember.roles.cache.size &&
        oldMember.roles.cache.every((role, id) => newMember.roles.cache.has(id))) {
        return;
    }
    try {
        const freshMember = await newMember.guild.members.fetch(newMember.id);
        await enforceRoles(freshMember);
    } catch (err) {
        console.error('[RoleManager] guildMemberUpdate error:', err.message);
    }
};
module.exports.handleAuditLog = async (message) => {
    const AUDIT_LOG_CHANNEL = h.ids.channels.audit_log;
    if (message.channel.id !== AUDIT_LOG_CHANNEL) return;
    if (!message.embeds || message.embeds.length === 0) return;

    if (message.webhookId) {
        try {
            const webhook = await message.client.fetchWebhook(message.webhookId);
            if (webhook.name === 'SapphireAPP') return;
        } catch (_) {}
    }
    const embed = message.embeds[0];
    const description = embed.description || '';
    const title = embed.title || '';
    const isRoleAdd = title.includes('added') || description.includes('Added:');
    const isRoleRemove = title.includes('removed') || description.includes('Removed:');
    if (!isRoleAdd && !isRoleRemove) return;
    const userIdMatch = description.match(/ID:\s*(\d{17,20})/) ||
    description.match(/@.*?\((\d{17,20})\)/);
    if (!userIdMatch) return;
    const discordId = userIdMatch[1];
    const guild = message.guild;
    if (!guild) return;
    setTimeout(async () => {
        try {
            const member = await guild.members.fetch(discordId);
            await enforceRoles(member);
        } catch (err) {
            console.log(`[RoleManager] Could not process audit log for ${discordId}:`, err.message);
        }
    }, 500);
};
