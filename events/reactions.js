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

    const activePoll = await db.query(
        `SELECT * FROM ${helpers.tables.POLL_AUTO_RESUME} WHERE message_id = ?`,
        [message.id],
        true
    );
    if (!activePoll) return;

    const emojiKey = reaction.emoji.id || reaction.emoji.name;
    const optionId = reactIds.indexOf(emojiKey) + 1;
    if (optionId < 1) return;

    const characters = activePoll.poll_list
        .split(/(?=:female_sign:|:male_sign:|♀️|♂️)/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
    if (optionId > characters.length) return;
    const characterNameRaw = characters[optionId - 1];
    const cleanName = characterNameRaw.replace(/:female_sign:|:male_sign:|♀️|♂️/g, '').trim();

    try {
        if (action === 'remove') {
            await db.query(
                `DELETE FROM ${helpers.tables.POLL_VOTING_DISCORD}
                 WHERE user_id = ? AND poll_id = ? AND option_id = ?`,
                [user.id, 'character_poll_new', optionId]
            );
            console.log(`🗳️ Vote Removed: ${user.username} from Option ${optionId} (${cleanName})`);
        } else {
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

                const antiquityRow = await db.query(
                    `SELECT membership_antiquity FROM ${helpers.tables.PURCHASE_MEMBERSHIP_ANTIQUITY}
                     WHERE discord_id = ?`,
                    [user.id],
                    true
                );
                if (antiquityRow?.membership_antiquity) {
                    const antiquity = parseInt(antiquityRow.membership_antiquity, 10) || 0;
                    const antiquityBonus = antiquity * 0.1;
                    weight += antiquityBonus;
                    console.log(`📈 Added antiquity bonus +${antiquityBonus.toFixed(2)} for ${user.username} (${antiquity} months)`);
                }
            }

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
                    cleanName
                ]
            );
            console.log(`🗳️ Vote Recorded: ${user.username} for Option ${optionId} (Weight: ${weight.toFixed(2)}) - Character: ${cleanName}`);
        }

        const charactersList = activePoll.poll_list
            .split(/(?=:female_sign:|:male_sign:|♀️|♂️)/)
            .map(s => s.trim())
            .filter(s => s.length > 0);
        const endTimeMs = new Date(activePoll.ends_at).getTime();
        await pollService.refreshPollMessage(message, charactersList, endTimeMs);

        if (action !== 'remove') {
            const otherReactions = message.reactions.cache.filter(r => {
                const rId = r.emoji.id || r.emoji.name;
                return rId !== emojiKey;
            });
            for (const other of otherReactions.values()) {
                await other.users.remove(user.id).catch(() => {});
            }
        }
    } catch (err) {
        console.error("Error in reaction handling:", err);
    }
};
