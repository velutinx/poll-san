// web/routes/giveaway.js
const h = require('../../utils/helpers');
const db = require('../../services/database');
const { EmbedBuilder } = require('discord.js');
const GIVEAWAY_KV_PREFIX = 'giveaway:';

function getEntrantsKey(messageId) {
    return `${GIVEAWAY_KV_PREFIX}${messageId}:entrants`;
}
function getGiveawayKey(messageId) {
    return `${GIVEAWAY_KV_PREFIX}${messageId}:data`;
}
function getKv(client) {
    return client?.kv || null;
}

async function getEntrants(messageId, client) {
    const kv = getKv(client);
    if (kv) {
        try {
            const cached = await kv.get(getEntrantsKey(messageId), 'json');
            if (cached) {
                console.log(`✅ [API] Entrants for ${messageId} served from KV.`);
                return cached;
            }
        } catch (err) {
            console.warn('KV read failed, falling back to D1:', err.message);
        }
    }
    const row = await db.query(
        `SELECT entrants FROM ${h.tables.GIVEAWAYS} WHERE message_id = ?`,
        [messageId],
        true
    );
    return row ? JSON.parse(row.entrants || '[]') : [];
}

async function setEntrants(messageId, entrants, client) {
    const kv = getKv(client);
    const entrantsJson = JSON.stringify(entrants);
    await db.query(
        `UPDATE ${h.tables.GIVEAWAYS} SET entrants = ? WHERE message_id = ?`,
        [entrantsJson, messageId]
    );
    if (kv) {
        try {
            await kv.put(getEntrantsKey(messageId), entrantsJson, { expirationTtl: 3600 });
            console.log(`✅ [API] Entrants for ${messageId} stored in KV.`);
        } catch (err) {
            console.warn('KV write failed:', err.message);
        }
    }
}

async function invalidateGiveawayCache(messageId, client) {
    const kv = getKv(client);
    if (kv) {
        try {
            await kv.delete(getEntrantsKey(messageId));
            await kv.delete(getGiveawayKey(messageId));
            console.log(`🗑️ [API] Giveaway ${messageId} cache invalidated.`);
        } catch (err) {
            console.warn('KV delete failed:', err.message);
        }
    }
}

function parseCharacterList(pollList) {
    if (!pollList) return [];
    const lines = pollList.split(/\r?\n/).filter(line => line.trim().length > 0);
    return lines.map(line => line.trim().replace(/:female_sign:|:male_sign:/g, m => m === ':female_sign:' ? '♀️' : '♂️'));
}

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

async function getBlacklistIds() {
    const rows = await db.query(
        `SELECT user_id FROM ${h.tables.GIVEAWAY_BLACKLIST}`
    );
    return rows.map(r => r.user_id);
}

module.exports = function setupGiveawayRoutes(app, client, getGuildMembers) {

    app.get('/api/giveaway/active', async (req, res) => {
        try {
            const now = new Date().toUTCString();
            const giveaway = await db.query(
                `SELECT * FROM ${h.tables.GIVEAWAYS}
                 WHERE ended = 0
                 ORDER BY end_time ASC
                 LIMIT 1`,
                [],
                true
            );

            if (!giveaway) {
                return res.json({ active: false });
            }

            const endTimeDate = new Date(giveaway.end_time);
            const nowDate = new Date();
            const msLeft = endTimeDate - nowDate;
            const hoursLeft = msLeft / (1000 * 60 * 60);

            // ─── Send reminder only if within 24h and not yet sent ───
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

                    // ─── Store the reminder message ID with retry ───
                    try {
                        await db.query(
                            `UPDATE ${h.tables.GIVEAWAYS}
                             SET reminder_sent = 1, reminder_message_id = ?
                             WHERE message_id = ?`,
                            [reminderMsg.id, giveaway.message_id]
                        );
                        console.log(`✅ Reminder sent and stored for giveaway ${giveaway.message_id}`);
                    } catch (updateErr) {
                        console.error(`❌ Failed to store reminder ID for ${giveaway.message_id}:`, updateErr.message);
                        // We still sent the message; we'll log the ID so we can manually delete if needed.
                        console.log(`📌 Reminder message ID was ${reminderMsg.id} (not stored in DB)`);
                    }
                } catch (reminderErr) {
                    console.error('Failed to send giveaway reminder:', reminderErr);
                }
            }

            // ─── Rest of the endpoint (same as before) ──────────────
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const entrants = await getEntrants(giveaway.message_id, client);
            const entrantsDetails = [];
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

            const blacklistIds = await getBlacklistIds();
            const blacklistSet = new Set(blacklistIds);
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
                    leftServer,
                    isBlacklisted: blacklistSet.has(userId)
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

    // ─── The rest of the routes (adjust-time, remove, blacklist) unchanged ───
    app.post('/api/giveaway/adjust-time', async (req, res) => {
        const { hours } = req.body;
        if (typeof hours !== 'number' || isNaN(hours)) {
            return res.status(400).json({ error: 'Invalid hours value' });
        }

        try {
            const giveaway = await db.query(
                `SELECT * FROM ${h.tables.GIVEAWAYS}
                 WHERE ended = 0
                 ORDER BY end_time ASC
                 LIMIT 1`,
                [],
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

            let entrants = await getEntrants(giveaway.message_id, client);
            if (!entrants.includes(userId)) {
                return res.status(400).json({ error: 'User is not in this giveaway' });
            }

            entrants = entrants.filter(id => id !== userId);

            await setEntrants(giveaway.message_id, entrants, client);
            await db.query(
                `DELETE FROM ${h.tables.POLL_VOTING_DISCORD}
                 WHERE user_id = ? AND poll_id = ?`,
                [userId, 'character_poll_new']
            );
            await invalidateGiveawayCache(giveaway.message_id, client);
            res.json({ success: true, message: `Removed ${userId} from giveaway and deleted their poll votes` });
        } catch (err) {
            console.error('Giveaway remove error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/giveaway/blacklist', async (req, res) => {
        try {
            const rows = await db.query(
                `SELECT user_id, discord_tag, added_at
                 FROM ${h.tables.GIVEAWAY_BLACKLIST}
                 ORDER BY added_at DESC`
            );
            res.json(rows);
        } catch (err) {
            console.error('Blacklist fetch error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/giveaway/blacklist/add', async (req, res) => {
        const { userId, discordTag } = req.body;
        if (!userId || !discordTag) {
            return res.status(400).json({ error: 'Missing userId or discordTag' });
        }
        try {
            await db.query(
                `INSERT OR IGNORE INTO ${h.tables.GIVEAWAY_BLACKLIST} (user_id, discord_tag)
                 VALUES (?, ?)`,
                [userId, discordTag]
            );
            res.json({ success: true });
        } catch (err) {
            console.error('Add blacklist error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/giveaway/blacklist/remove', async (req, res) => {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'Missing userId' });
        }
        try {
            await db.query(
                `DELETE FROM ${h.tables.GIVEAWAY_BLACKLIST} WHERE user_id = ?`,
                [userId]
            );
            res.json({ success: true });
        } catch (err) {
            console.error('Remove blacklist error:', err);
            res.status(500).json({ error: err.message });
        }
    });
};
