const supabase = require('../services/supabase');
const { reactIds } = require('../utils/helpers');

// Weight Configuration
const LEVEL_MULTIPLIER_PER_LEVEL = 0.02;
const TIER_WEIGHTS = {
  '1465444240845963326': 1.2,
  '1465670134743044139': 1.5,
  '1465904476417163457': 1.8,
  '1465904548320378956': 2.0,
  '1465952085026541804': 2.3
};
const BOOSTER_ROLE_ID = '1469284491456548976';

module.exports = async (reaction, user, action = 'add') => {
    if (user.bot) return;

    if (reaction.partial) {
        try { await reaction.fetch(); } catch (e) { return; }
    }

    const { message } = reaction;

    // 1. Check if this is an active poll
    const { data: activePoll } = await supabase
        .from('auto_resume')
        .select('message_id')
        .eq('message_id', message.id)
        .single();

    if (!activePoll) return;

    // 2. Map Emoji to Option ID (1-12)
    const emojiKey = reaction.emoji.id || reaction.emoji.name;
    const optionId = reactIds.indexOf(emojiKey) + 1;
    if (optionId < 1) return;

    try {
        if (action === 'remove') {
            // Delete vote from database
            await supabase
                .from('votes_discord')
                .delete()
                .eq('user_id', user.id)
                .eq('poll_id', 'character_poll_new')
                .eq('option_id', optionId);
            console.log(`🗑️ Vote Removed: ${user.username} for Option ${optionId}`);
            return;
        }

        // Otherwise, handle add (with weight calculation)
        const member = await message.guild.members.fetch(user.id).catch(() => null);
        let weight = 1.0;

        if (member) {
            // Find highest Tier Weight
            let highestTier = 1.0;
            for (const [roleId, multiplier] of Object.entries(TIER_WEIGHTS)) {
                if (member.roles.cache.has(roleId)) {
                    if (multiplier > highestTier) highestTier = multiplier;
                }
            }
            weight = highestTier;

            // Add Booster Bonus (+0.5)
            if (member.roles.cache.has(BOOSTER_ROLE_ID)) {
                weight += 0.5;
            }

            // Add Level Bonus (Level * 0.02)
            const { data: xpData } = await supabase
                .from('user_xp')
                .select('level')
                .eq('user_id', user.id)
                .eq('guild_id', message.guild.id)
                .single();

            if (xpData?.level) {
                weight += (xpData.level * LEVEL_MULTIPLIER_PER_LEVEL);
            }
        }

        // 4. Record/Update Vote in Supabase
        await supabase.from('votes_discord').upsert({
            user_id: user.id,
            poll_id: 'character_poll_new',
            option_id: optionId,
            weight: parseFloat(weight.toFixed(2)),
            discord_username: user.username,
            time_voted: new Date().toISOString()
        });

        console.log(`🗳️ Vote Recorded: ${user.username} for Option ${optionId} (Weight: ${weight.toFixed(2)})`);

        // 5. Cleanup other reactions visually
        const otherReactions = message.reactions.cache.filter(r => {
            const rId = r.emoji.id || r.emoji.name;
            return rId !== emojiKey;
        });

        otherReactions.forEach(r => r.users.remove(user.id).catch(() => {}));

    } catch (err) {
        console.error("Error in reaction weight calculation:", err);
    }
};
