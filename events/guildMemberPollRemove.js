// events/guildMemberPollRemove.js
const db = require('../services/database');
const h = require('../utils/helpers');

module.exports = async (member) => {
    try {
        const now = new Date().toISOString();
        const giveaway = await db.query(
            `SELECT * FROM ${h.tables.GIVEAWAYS}
             WHERE ended = 0 AND end_time > ?
             LIMIT 1`,
            [now],
            true
        );

        if (!giveaway) return;

        let entrants = JSON.parse(giveaway.entrants || '[]');
        if (entrants.includes(member.id)) {
            entrants = entrants.filter(id => id !== member.id);
            await db.query(
                `UPDATE ${h.tables.GIVEAWAYS}
                 SET entrants = ?
                 WHERE message_id = ?`,
                [JSON.stringify(entrants), giveaway.message_id]
            );
            console.log(`Removed ${member.user.tag} from active giveaway because they left the server.`);
        }
    } catch (err) {
        console.error('Error cleaning up giveaway on member leave:', err);
    }
};
