// services/redeemHandler.js

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const db = require('./database');
const helpers = require('../utils/helpers');
const { consolidateExistingClaims } = require('./seriesConsolidator');

const activeSessions = new Map();
let cleanupInterval = null;

function startCleanup() {
    if (cleanupInterval) return;
    cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [key, value] of activeSessions) {
            if (now - value.timestamp > 60_000) activeSessions.delete(key);
        }
    }, 30_000);
}

function stopCleanup() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
    }
}

async function notifyAdmin(interaction, message, isError = false) {
    try {
        const adminChannelId = helpers.ids.channels.admin_channel;
        const adminChannel = await interaction.client.channels.fetch(adminChannelId);
        const prefix = isError ? '⚠️ **ERROR**' : '📨';
        await adminChannel.send({
            content: `${prefix} ${message}`,
            allowedMentions: { users: [] }
        });
    } catch (err) {
        console.error(`${helpers.releaseEmojis.BATSU} Failed to send to admin channel:`, err.message);
    }
}

// ============ CHARACTER REQUEST ============
async function handleRedeemStart(interaction) {
    const userId = interaction.user.id;
    const cost = helpers.redeem.characterRequestCost;

    await interaction.deferReply({ flags: 64, withResponse: true });
    await consolidateExistingClaims();

    let balance = 0;
    try {
        const userRow = await db.query(
            `SELECT tickets FROM ${helpers.tables.GAMES_USER_DATA} WHERE user_id = ?`,
            [userId],
            true
        );
        balance = userRow?.tickets || 0;
    } catch (err) {
        console.error('Redeem start fetch error:', err);
        return interaction.editReply(`${helpers.releaseEmojis.BATSU} Database error.`);
    }

    if (balance < cost) {
        return interaction.editReply(
            `${helpers.releaseEmojis.BATSU} You need **${cost}** tickets, but you only have **${balance}**.`
        );
    }

    let claims;
    try {
        claims = await db.query(
            `SELECT series FROM ${helpers.tables.GAMES_MUDAE_CLAIMS} WHERE user_id = ?`,
            [userId]
        );
    } catch (err) {
        console.error('Claims fetch error:', err);
        return interaction.editReply(`${helpers.releaseEmojis.BATSU} Database error.`);
    }

    if (!claims || claims.length === 0) {
        return interaction.editReply(
            `${helpers.releaseEmojis.BATSU} You haven't claimed any waifus yet. Start rolling in <#${helpers.ids.channels.mudae_roll}>.`
        );
    }

    const seriesSet = new Set();
    claims.forEach(c => { if (c.series) seriesSet.add(c.series); });
    const seriesList = Array.from(seriesSet);

    const rows = [];
    let currentRow = new ActionRowBuilder();
    for (const [idx, series] of seriesList.entries()) {
        if (currentRow.components.length >= 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`redeem_series_${idx}`)
                .setLabel(series)
                .setStyle(ButtonStyle.Secondary)
        );
    }
    if (currentRow.components.length > 0) rows.push(currentRow);

    rows.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('redeem_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Danger)
        )
    );

    activeSessions.set(userId, { seriesList, timestamp: Date.now() });

    await interaction.editReply({
        content: `${helpers.getRandomPresent()} **Select the series you want to request a character from**\nThis will cost **${cost}** tickets.`,
        components: rows,
    });
}

async function handleRedeemSeries(interaction, index) {
    await interaction.deferReply({ flags: 64 });

    const userId = interaction.user.id;
    const session = activeSessions.get(userId);
    const cost = helpers.redeem.characterRequestCost;

    if (!session) {
        return interaction.editReply(
            `${helpers.releaseEmojis.BATSU} Session expired. Please start again.`
        );
    }

    const seriesList = session.seriesList;
    if (index < 0 || index >= seriesList.length) {
        return interaction.editReply(
            `${helpers.releaseEmojis.BATSU} Invalid selection.`
        );
    }

    const selectedSeries = seriesList[index];

    // Fetch current balance
    let balance = 0;
    try {
        const userRow = await db.query(
            `SELECT tickets FROM ${helpers.tables.GAMES_USER_DATA} WHERE user_id = ?`,
            [userId],
            true
        );
        balance = userRow?.tickets || 0;
    } catch (err) {
        console.error('Redeem series fetch error:', err);
        return interaction.editReply(`${helpers.releaseEmojis.BATSU} Database error.`);
    }

    if (balance < cost) {
        await interaction.editReply(
            `${helpers.releaseEmojis.BATSU} Insufficient tickets (need ${cost}, have ${balance}).`
        );
        activeSessions.delete(userId);
        return;
    }

    const newBalance = balance - cost;

    // ─── Use a transaction ──────────────────────────────────────────
    try {
        await db.transaction([
            {
                sql: `UPDATE ${helpers.tables.GAMES_USER_DATA} SET tickets = ? WHERE user_id = ?`,
                params: [newBalance, userId]
            },
            {
                sql: `INSERT INTO ${helpers.tables.GAMES_CHARACTER_REQUESTS} (user_id, username, series) VALUES (?, ?, ?)`,
                params: [userId, interaction.user.tag, selectedSeries]
            }
        ]);

        await interaction.editReply(
            `${helpers.releaseEmojis.getRandomVerify()} Request recorded! You requested a character from **${selectedSeries}**.\nYour new balance: **${newBalance}** tickets.`
        );
        activeSessions.delete(userId);

        await notifyAdmin(
            interaction,
            `${helpers.getRandomPresent()} <@${userId}> (${interaction.user.tag}) requested a character from **${selectedSeries}**.\nBalance: ${newBalance} tickets.`
        );

    } catch (err) {
        console.error('Redeem series transaction error:', err);
        // Transaction rolled back automatically; user's tickets are unchanged.
        await interaction.editReply(
            `${helpers.releaseEmojis.BATSU} Failed to record your request. Your tickets have not been deducted. Please try again later.`
        );
        await notifyAdmin(
            interaction,
            `❌ **Transaction failed** for <@${userId}> (${interaction.user.tag}) requesting **${selectedSeries}**.\nError: ${err.message}`,
            true
        );
        activeSessions.delete(userId);
    }
}

async function handleRedeemCancel(interaction) {
    activeSessions.delete(interaction.user.id);
    await interaction.reply({ content: 'Request cancelled.', flags: 64 }).catch(() => {});
}

// ============ VOTE BOOST ============
async function handleRedeemVoteBoost(interaction) {
    const userId = interaction.user.id;
    const cost = helpers.redeem.voteBoostCost;

    await interaction.deferReply({ flags: 64, withResponse: true });

    // 1. Check balance
    let balance = 0;
    try {
        const userRow = await db.query(
            `SELECT tickets FROM ${helpers.tables.GAMES_USER_DATA} WHERE user_id = ?`,
            [userId],
            true
        );
        balance = userRow?.tickets || 0;
    } catch (err) {
        console.error('Vote boost fetch error:', err);
        return interaction.editReply(`${helpers.releaseEmojis.BATSU} Database error.`);
    }

    if (balance < cost) {
        return interaction.editReply(
            `${helpers.releaseEmojis.BATSU} You need **${cost}** tickets, but you only have **${balance}**.`
        );
    }

    const newBalance = balance - cost;

    // 2. Deduct tickets and upsert vote boost in a transaction
    const now = new Date();
    let newExpiresAt;

    try {
        // First check if an existing boost exists
        const existing = await db.query(
            `SELECT id, expires_at FROM ${helpers.tables.GAMES_VOTE_BOOSTS}
             WHERE user_id = ? AND expires_at > ?`,
            [userId, now.toISOString()],
            true
        );

        if (existing) {
            const currentExpiry = new Date(existing.expires_at);
            currentExpiry.setDate(currentExpiry.getDate() + helpers.redeem.voteBoostDurationDays);
            newExpiresAt = currentExpiry.toISOString();

            await db.transaction([
                {
                    sql: `UPDATE ${helpers.tables.GAMES_USER_DATA} SET tickets = ? WHERE user_id = ?`,
                    params: [newBalance, userId]
                },
                {
                    sql: `UPDATE ${helpers.tables.GAMES_VOTE_BOOSTS} SET expires_at = ?, username = ? WHERE id = ?`,
                    params: [newExpiresAt, interaction.user.tag, existing.id]
                }
            ]);
        } else {
            newExpiresAt = new Date(
                now.getTime() + helpers.redeem.voteBoostDurationDays * 24 * 60 * 60 * 1000
            ).toISOString();

            await db.transaction([
                {
                    sql: `UPDATE ${helpers.tables.GAMES_USER_DATA} SET tickets = ? WHERE user_id = ?`,
                    params: [newBalance, userId]
                },
                {
                    sql: `INSERT INTO ${helpers.tables.GAMES_VOTE_BOOSTS} (user_id, username, expires_at) VALUES (?, ?, ?)`,
                    params: [userId, interaction.user.tag, newExpiresAt]
                }
            ]);
        }

        await interaction.editReply(
            `${helpers.releaseEmojis.getRandomVerify()} **Vote Boost activated!** Your poll votes will count double until **<t:${Math.floor(new Date(newExpiresAt).getTime() / 1000)}:R>**. ` +
            `\nNew balance: **${newBalance}** tickets.`
        );

    } catch (err) {
        console.error('Vote boost transaction error:', err);
        await interaction.editReply(
            `${helpers.releaseEmojis.BATSU} Failed to activate vote boost. Your tickets have not been deducted. Please try again later.`
        );
        await notifyAdmin(
            interaction,
            `❌ **Vote boost failed** for <@${userId}> (${interaction.user.tag}).\nError: ${err.message}`,
            true
        );
    }
}

// ============ SUGGEST CHARACTER ============
async function handleRedeemSuggestCharacter(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('redeem_suggest_modal')
        .setTitle('Suggest a Poll Character');

    const nameInput = new TextInputBuilder()
        .setCustomId('suggest_character_name')
        .setLabel('Character Name')
        .setPlaceholder('e.g. Rimuru Tempest')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const seriesInput = new TextInputBuilder()
        .setCustomId('suggest_character_series')
        .setLabel('Series (optional)')
        .setPlaceholder('e.g. That Time I Got Reincarnated as a Slime')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(seriesInput)
    );

    await interaction.showModal(modal);
}

async function handleSuggestModalSubmit(interaction) {
    await interaction.deferReply({ flags: 64 });

    const userId = interaction.user.id;
    const cost = helpers.redeem.suggestCost;
    const characterName = interaction.fields.getTextInputValue('suggest_character_name')?.trim();
    const series = interaction.fields.getTextInputValue('suggest_character_series')?.trim() || 'Not provided';

    if (!characterName) {
        return interaction.editReply(
            `${helpers.releaseEmojis.BATSU} Character name is required.`
        );
    }

    let balance = 0;
    try {
        const userRow = await db.query(
            `SELECT tickets FROM ${helpers.tables.GAMES_USER_DATA} WHERE user_id = ?`,
            [userId],
            true
        );
        balance = userRow?.tickets || 0;
    } catch (err) {
        console.error('Suggest fetch error:', err);
        return interaction.editReply(`${helpers.releaseEmojis.BATSU} Database error.`);
    }

    if (balance < cost) {
        return interaction.editReply(
            `${helpers.releaseEmojis.BATSU} Insufficient tickets (need ${cost}, have ${balance}).`
        );
    }

    const newBalance = balance - cost;

    try {
        await db.transaction([
            {
                sql: `UPDATE ${helpers.tables.GAMES_USER_DATA} SET tickets = ? WHERE user_id = ?`,
                params: [newBalance, userId]
            },
            {
                sql: `INSERT INTO ${helpers.tables.GAMES_CHARACTER_SUGGESTIONS} (user_id, username, character_name, series) VALUES (?, ?, ?, ?)`,
                params: [userId, interaction.user.tag, characterName, series]
            }
        ]);

        await interaction.editReply(
            `${helpers.releaseEmojis.getRandomVerify()} Suggestion recorded: **${characterName}**${series !== 'Not provided' ? ` (${series})` : ''}.\nNew balance: **${newBalance}** tickets.`
        );

        await notifyAdmin(
            interaction,
            `${helpers.releaseEmojis.SPEECH} <@${userId}> (${interaction.user.tag}) suggested:\n**Character:** ${characterName}\n**Series:** ${series}\nPlease consider it for the next poll.`
        );

    } catch (err) {
        console.error('Suggestion transaction error:', err);
        await interaction.editReply(
            `${helpers.releaseEmojis.BATSU} Failed to record your suggestion. Your tickets have not been deducted. Please try again later.`
        );
        await notifyAdmin(
            interaction,
            `❌ **Suggestion failed** for <@${userId}> (${interaction.user.tag}).\nCharacter: ${characterName}\nSeries: ${series}\nError: ${err.message}`,
            true
        );
    }
}

module.exports = {
    handleRedeemStart,
    handleRedeemSeries,
    handleRedeemCancel,
    handleRedeemVoteBoost,
    handleRedeemSuggestCharacter,
    handleSuggestModalSubmit,
    startCleanup,
    stopCleanup
};
