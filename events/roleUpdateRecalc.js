// events/roleUpdateRecalc.js
const h = require('../utils/helpers');
const supabase = require('../services/supabase');
const WEIGHTED_ROLES = Object.values(h.weights.tiers);

module.exports = async (oldMember, newMember) => {
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    const gainedWeightedRole = addedRoles.some(role => WEIGHTED_ROLES.includes(role.id));
    if (!gainedWeightedRole) return;

    const userId = newMember.id;
    const guildId = newMember.guild.id;

    try {
        // Find the active poll
        const { data: activePoll } = await supabase
            .from(h.tables.POLL_AUTO_RESUME)
            .select('*')
            .gt('ends_at', new Date().toISOString())
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!activePoll) return;

        const { data: existingVote } = await supabase
            .from(h.tables.POLL_VOTING_DISCORD)
            .select('*')
            .eq('poll_id', activePoll.message_id)
            .eq('user_id', userId)
            .maybeSingle();

        if (!existingVote) return;

        const member = newMember;
        let weight = 0.9;

        for (const [roleId, roleWeight] of Object.entries(h.weights.tiers)) {
            if (member.roles.cache.has(roleId)) {
                weight = roleWeight;
                break;
            }
        }

        if (weight === existingVote.weight) return;

        await supabase
            .from(h.tables.POLL_VOTING_DISCORD)
            .update({ weight })
            .eq('id', existingVote.id);

        console.log(`🔄 Updated vote weight for ${newMember.user.tag} from ${existingVote.weight} to ${weight}`);

        if (global.refreshPollDashboard) {
            global.refreshPollDashboard();
        }

    } catch (err) {
        console.error('Role update recalc error:', err);
    }
};
