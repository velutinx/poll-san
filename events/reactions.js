// events/reactions.js
const db = require('../services/database');
const helpers = require('../utils/helpers');
const { reactIds, weights } = helpers;
const pollService = require('../services/pollService');

module.exports = async (reaction, user, action = 'add') => {
    if (user.bot) return;

    if (reaction.partial) {
        try { await reaction.fetch(); } catch (e) { return; }
    }

    const { message } = reaction;

    // 1. Check if this is an active poll
    const activePoll = await db.query(
        `SELECT * FROM ${helpers.tables.POLL_AUTO_RESUME} WHERE message_id = ?`,
        [message.id],
        true
    );
    if (!activePoll) return;

    // 2. Map emoji to option ID
    const emojiKey = reaction.emoji.id || reaction.emoji.name;
    const optionId = reactIds.indexOf(emojiKey) + 1;
    if (optionId < 1) return;

    try {
        if (action === 'remove') {
            // Delete vote
            await db.query(
                `DELETE FROM ${helpers.tables.POLL_VOTING_DISCORD}
                 WHERE user_id = ? AND poll_id = ? AND option_id = ?`,
                [user.id, 'character_poll_new', optionId]
            );
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

                const xpData = await db.query(
                    `SELECT level FROM ${helpers.tables.USER_XP}
                     WHERE user_id = ? AND guild_id = ?`,
                    [user.id, message.guild.id],
                    true
                );
                if (xpData?.level) weight += (xpData.level * weights.xpFactor);
            }

            // Fetch character name for the option
            const charData = await db.query(
                `SELECT character_name FROM ${helpers.tables.POLL_VOTES_FINAL}
                 WHERE poll_id = ? AND option_id = ?`,
                ['character_poll_new', optionId],
                true
            );
            const characterName = charData?.character_name || null;

            await db.query(
                `INSERT OR REPLACE INTO ${helpers.tables.POLL_VOTING_DISCORD}
                 (user_id, poll_id, option_id, weight, discord_username, time_voted, character_name)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    user.id,
                    'character_poll_new',
                    optionId,
                    parseFloat(weight.toFixed(2)),
                    user.username,
                    new Date().toISOString(),
                    characterName
                ]
            );

            console.log(`🗳️ Vote Recorded: ${user.username} for Option ${optionId} (Weight: ${weight.toFixed(2)}) - Character: ${characterName || 'unknown'}`);
        }

        const characters = activePoll.poll_list
            .split(/(?=:female_sign:|:male_sign:|♀️|♂️|\n)/)
            .map(s => s.trim())
            .filter(s => s.length > 1);

        const endTimeMs = new Date(activePoll.ends_at).getTime();
        await pollService.refreshPollMessage(message, characters, endTimeMs);

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
