// web/routes/giveaway.js
const h = require('../../utils/helpers');
const db = require('../../services/database');
const { EmbedBuilder } = require('discord.js');

function parseCharacterList(pollList) {
    if (!pollList) return [];
    const lines = pollList.split(/\r?\n/).filter(line => line.trim().length > 0);
    return lines.map(line => line.trim().replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️'));
}

// Helper to get or create the "Giveaway" webhook
async function getGiveawayWebhook(channel) {
    let webhook = (await channel.fetchWebhooks()).find(w => w.name === 'Giveaway');
    if (!webhook) {
        webhook = await channel.createWebhook({
            name: 'Giveaway',
            avatar: h.urls.LOGO_URL
        });
    }
    return webhook;
}

module.exports = function setupGiveawayRoutes(app, client, getGuildMembers) {

    // ────────────────────────────────────────────────
    // GET active giveaway and entrants with full details
    // ────────────────────────────────────────────────
    app.get('/api/giveaway/active', async (req, res) => {
        try {
            const now = new Date().toUTCString();
            // Fetch active giveaway
const giveaway = await db.query(
    `SELECT * FROM ${h.tables.GIVEAWAYS}
     WHERE ended = 0
     ORDER BY julianday(end_time) ASC
     LIMIT 1`,
    [],
    true
);

// Don't try to end the giveaway here - the bot handles that
if (!giveaway) {
    return res.json({ active: false });
}

// Then filter in JavaScript - commented out because endGiveaway isn't defined here
// if (giveaway && new Date(giveaway.end_time) <= new Date()) {
//     // It's expired, process end - this would happen automatically via the bot's timer
//     return res.json({ active: false });
// }
            if (!giveaway) {
                return res.json({ active: false });
            }

            // ---------- REMINDER LOGIC (≤24h left, only once) ----------
            const endTimeDate = new Date(giveaway.end_time);
            const nowDate = new Date();
            const msLeft = endTimeDate - nowDate;
            const hoursLeft = msLeft / (1000 * 60 * 60);
            if (!giveaway.reminder_sent && hoursLeft <= 24 && hoursLeft > 0) {
                try {
                    const channel = await client.channels.fetch(giveaway.channel_id);
                    const roleMention = `<@&${h.ids.roles.giveaway_notify_role}>`;
                    const webhook = await getGiveawayWebhook(channel);
                    const reminderMsg = await webhook.send({
                        content: `${h.releaseEmojis.ALERT} **Last day in the current giveaway!** ${roleMention}`,
                        username: 'Giveaway',
                        avatarURL: h.urls.LOGO_URL
                    });
                    await db.query(
                        `UPDATE ${h.tables.GIVEAWAYS}
                         SET reminder_sent = 1, reminder_message_id = ?
                         WHERE message_id = ?`,
                        [reminderMsg.id, giveaway.message_id]
                    );
                    console.log(`✅ Reminder sent for giveaway ${giveaway.message_id}`);
                } catch (reminderErr) {
                    console.error('Failed to send giveaway reminder:', reminderErr);
                }
            }
            // ------------------------------------------------------------

            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const entrants = JSON.parse(giveaway.entrants || '[]');
            const entrantsDetails = [];

            // Get active poll data for vote info
            const activePoll = await db.query(
                `SELECT poll_list FROM ${h.tables.POLL_AUTO_RESUME}
                 ORDER BY id DESC
                 LIMIT 1`,
                [],
                true
            );
            let characterList = [];
            if (activePoll && activePoll.poll_list) {
                characterList = parseCharacterList(activePoll.poll_list);
            }

            // Get votes for current poll
            const votes = await db.query(
                `SELECT user_id, option_id FROM ${h.tables.POLL_VOTING_DISCORD}
                 WHERE poll_id = ?`,
                ['character_poll_new']
            );
            const voteMap = {};
            if (votes) {
                for (const v of votes) {
                    const optId = v.option_id;
                    let characterName = null;
                    if (characterList.length >= optId && optId >= 1) {
                        characterName = characterList[optId - 1];
                    }
                    voteMap[v.user_id] = { option_id: optId, characterName };
                }
            }

            // Build entrants details with live member data
            for (const userId of entrants) {
                let member = null;
                let leftServer = false;
                let isSupporter = false;
                let nickname = userId;
                let username = userId;
                let accountAge = null;

                try {
                    member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
                    if (!member) {
                        leftServer = true;
                    } else {
                        nickname = member.nickname || member.user.username;
                        username = member.user.username;
                        accountAge = member.user.createdTimestamp
                            ? Math.floor((Date.now() - member.user.createdTimestamp) / (24 * 60 * 60 * 1000))
                            : null;
                        isSupporter = member.roles.cache.has(h.ids.roles.supporter);
                    }
                } catch (err) {
                    console.warn(`Failed to fetch member ${userId}:`, err.message);
                    leftServer = true;
                }

                const vote = voteMap[userId] || null;
                entrantsDetails.push({
                    userId,
                    username: leftServer ? `[LEFT] ${userId}` : username,
                    nickname: leftServer ? `[LEFT] ${userId}` : nickname,
                    accountAge,
                    voted: !!vote,
                    voteCharacter: vote ? vote.characterName : null,
                    isSupporter,
                    leftServer
                });
            }

            res.json({
                active: true,
                prize: giveaway.prize,
                endTime: giveaway.end_time,
                winnersCount: giveaway.winners_count,
                entrants: entrantsDetails
            });
        } catch (err) {
            console.error('Giveaway active endpoint error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ────────────────────────────────────────────────
    // POST – Adjust giveaway end time by hours (+/-)
    // ────────────────────────────────────────────────
    app.post('/api/giveaway/adjust-time', async (req, res) => {
        const { hours } = req.body;
        if (typeof hours !== 'number' || isNaN(hours)) {
            return res.status(400).json({ error: 'Invalid hours value' });
        }

        try {
            const now = new Date().toISOString();
            const giveaway = await db.query(
                `SELECT * FROM ${h.tables.GIVEAWAYS}
                 WHERE ended = 0 AND end_time > ?
                 ORDER BY end_time ASC
                 LIMIT 1`,
                [now],
                true
            );
            if (!giveaway) {
                return res.status(404).json({ error: 'No active giveaway found' });
            }

            const oldEnd = new Date(giveaway.end_time);
            const newEnd = new Date(oldEnd.getTime() + hours * 60 * 60 * 1000);
            const newEndISO = newEnd.toISOString();

            await db.query(
                `UPDATE ${h.tables.GIVEAWAYS} SET end_time = ? WHERE message_id = ?`,
                [newEndISO, giveaway.message_id]
            );

            const channel = await client.channels.fetch(giveaway.channel_id);
            const webhook = await getGiveawayWebhook(channel);
            const message = await channel.messages.fetch(giveaway.message_id);
            const oldEmbed = message.embeds[0];
            const newEmbed = new EmbedBuilder(oldEmbed.data)
                .spliceFields(0, 1, { name: 'Ends', value: `<t:${Math.floor(newEnd.getTime() / 1000)}:R>`, inline: true });

            await webhook.editMessage(message.id, { embeds: [newEmbed] });

            res.json({ success: true, newEndTime: newEndISO });
        } catch (err) {
            console.error('Giveaway time adjust error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ────────────────────────────────────────────────
    // POST – Remove a user from the active giveaway
    // ────────────────────────────────────────────────
    app.post('/api/giveaway/remove', async (req, res) => {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        try {
            const now = new Date().toISOString();
            const giveaway = await db.query(
                `SELECT * FROM ${h.tables.GIVEAWAYS}
                 WHERE ended = 0 AND end_time > ?
                 ORDER BY end_time ASC
                 LIMIT 1`,
                [now],
                true
            );
            if (!giveaway) {
                return res.status(404).json({ error: 'No active giveaway found' });
            }

            let entrants = JSON.parse(giveaway.entrants || '[]');
            if (!entrants.includes(userId)) {
                return res.status(400).json({ error: 'User is not in this giveaway' });
            }

            entrants = entrants.filter(id => id !== userId);
            await db.query(
                `UPDATE ${h.tables.GIVEAWAYS} SET entrants = ? WHERE message_id = ?`,
                [JSON.stringify(entrants), giveaway.message_id]
            );

            // Remove poll vote – safe, does nothing if no vote exists
            await db.query(
                `DELETE FROM ${h.tables.POLL_VOTING_DISCORD}
                 WHERE user_id = ? AND poll_id = ?`,
                [userId, 'character_poll_new']
            );

            res.json({ success: true, message: `Removed ${userId} from giveaway and deleted their poll votes` });
        } catch (err) {
            console.error('Giveaway remove error:', err);
            res.status(500).json({ error: err.message });
        }
    });
};
