// events/reactions.js

const supabase = require('../services/supabase');
const helpers = require('../utils/helpers');
const { reactIds, weights } = helpers;
const pollService = require('../services/pollService');

module.exports = async (reaction, user, action = 'add') => {
    if (user.bot) return;

    if (reaction.partial) {
        try { await reaction.fetch(); } catch (e) { return; }
    }

    const { message } = reaction;

    // 1. Check if this is an active poll – using centralized table name
    const { data: activePoll, error: pollError } = await supabase
        .from(helpers.tables.POLL_AUTO_RESUME)
        .select('*')
        .eq('message_id', message.id)
        .single();

    if (pollError || !activePoll) return;

    // 2. Map Emoji to Option ID (1-8)
    const emojiKey = reaction.emoji.id || reaction.emoji.name;
    const optionId = reactIds.indexOf(emojiKey) + 1;
    if (optionId < 1) return;

    try {
        if (action === 'remove') {
            // Delete vote from database – using centralized table name
            await supabase
                .from(helpers.tables.POLL_VOTING_DISCORD)
                .delete()
                .eq('user_id', user.id)
                .eq('poll_id', 'character_poll_new')
                .eq('option_id', optionId);
            
            //console.log(`🗑️ Vote Removed: ${user.username} for Option ${optionId}`);
        } else {
            // --- ADD VOTE (with weight calculation) ---
            const member = await message.guild.members.fetch(user.id).catch(() => null);
            let weight = 1.0;
            let baseWeight = 1.0;

            if (member) {
                const hasMemberRole = member.roles.cache.has(helpers.ids.roles.member);
                if (hasMemberRole) {
                    baseWeight = 0.9;
                } else {
                    let highestTier = 1.0;
                    for (const [roleId, multiplier] of Object.entries(weights.tiers)) {
                        if (member.roles.cache.has(roleId)) {
                            if (multiplier > highestTier) highestTier = multiplier;
                        }
                    }
                    baseWeight = highestTier;
                }
                weight = baseWeight;

                if (member.roles.cache.has(weights.booster)) weight += 0.5;

                const { data: xpData } = await supabase
                    .from(helpers.tables.USER_XP)
                    .select('level')
                    .eq('user_id', user.id)
                    .eq('guild_id', message.guild.id)
                    .single();
                if (xpData?.level) weight += (xpData.level * weights.xpFactor);
            }

            // Fetch character name for the option
            const { data: charData } = await supabase
                .from(helpers.tables.POLL_VOTES_FINAL)
                .select('character_name')
                .eq('poll_id', 'character_poll_new')
                .eq('option_id', optionId)
                .maybeSingle();

            const characterName = charData?.character_name || null;

            await supabase.from(helpers.tables.POLL_VOTING_DISCORD).upsert({
                user_id: user.id,
                poll_id: 'character_poll_new',
                option_id: optionId,
                weight: parseFloat(weight.toFixed(2)),
                discord_username: user.username,
                time_voted: new Date().toISOString(),
                character_name: characterName
            });

            console.log(`🗳️ Vote Recorded: ${user.username} for Option ${optionId} (Weight: ${weight.toFixed(2)}) - Character: ${characterName || 'unknown'}`);
        }

        // --- AFTER ANY VOTE CHANGE, FULLY RECALCULATE THE POLL MESSAGE ---
        const characters = activePoll.poll_list
            .split(/(?=:female_sign:|:male_sign:|♀️|♂️|\n)/)
            .map(s => s.trim())
            .filter(s => s.length > 1);

        const endTimeMs = new Date(activePoll.ends_at).getTime();
        await pollService.refreshPollMessage(message, characters, endTimeMs);

        // 5. Cleanup other reactions visually (only on add)
        if (action !== 'remove') {
            const otherReactions = message.reactions.cache.filter(r => {
                const rId = r.emoji.id || r.emoji.name;
                return rId !== emojiKey;
            });
            otherReactions.forEach(r => r.users.remove(user.id).catch(() => {}));
        }

    } catch (err) {
        console.error("Error in reaction handling:", err);
    }
};
