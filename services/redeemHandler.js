// services/redeemHandler.js

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const supabase = require('./supabase');
const helpers = require('../utils/helpers');

const REDEEM_COST = 300;
const activeSessions = new Map(); // userId -> { seriesList, timestamp }

// ---- Session cleanup ----
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

// ---- Handlers ----
async function handleRedeemStart(interaction) {
    const userId = interaction.user.id;

    // Acknowledge (static UI button stays untouched)
    await interaction.deferReply({ ephemeral: true, fetchReply: true });

    // Ticket check
    const { data: userData } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();
    const balance = userData?.tickets || 0;

    if (balance < REDEEM_COST) {
        return interaction.editReply(`❌ You need **${REDEEM_COST}** tickets, but you only have **${balance}**.`);
    }

    // Fetch series from mudae claims
    const { data: claims } = await supabase
        .from(helpers.tables.GAMES_MUDAE_CLAIMS)
        .select('series')
        .eq('user_id', userId);

    if (!claims || claims.length === 0) {
        return interaction.editReply(`🤷 You haven't claimed any waifus yet. Start rolling in <#${helpers.ids.channels.mudae_roll}>.`);
    }

    const seriesSet = new Set();
    claims.forEach(c => { if (c.series) seriesSet.add(c.series); });
    const seriesList = Array.from(seriesSet);

    // Build button rows (max 5 per row)
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

    // Cancel button in its own row
    rows.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('redeem_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Danger)
        )
    );

    // Save session
    activeSessions.set(userId, { seriesList, timestamp: Date.now() });

    await interaction.editReply({
        content: `🎁 **Select the series you want to request a character from**\nThis will cost **${REDEEM_COST}** tickets.`,
        components: rows,
        ephemeral: true
    });
}

async function handleRedeemSeries(interaction, index) {
    const userId = interaction.user.id;
    const session = activeSessions.get(userId);
    if (!session) {
        return interaction.reply({ content: '❌ Session expired. Please start again.', ephemeral: true });
    }

    const seriesList = session.seriesList;
    if (index < 0 || index >= seriesList.length) {
        return interaction.reply({ content: '❌ Invalid selection.', ephemeral: true });
    }

    const selectedSeries = seriesList[index];

    // Re-check tickets
    const { data: userData } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();
    const balance = userData?.tickets || 0;

    if (balance < REDEEM_COST) {
        await interaction.reply({ content: `❌ Insufficient tickets (need ${REDEEM_COST}, have ${balance}).`, ephemeral: true });
        activeSessions.delete(userId);
        return;
    }

    // Deduct tickets
    const newBalance = balance - REDEEM_COST;
    const { error: updateError } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .update({ tickets: newBalance })
        .eq('user_id', userId);

    if (updateError) {
        console.error('Redeem deduction error:', updateError);
        await interaction.reply({ content: '❌ Database error. Tickets not deducted.', ephemeral: true });
        activeSessions.delete(userId);
        return;
    }

    // Record request
    const { error: insertError } = await supabase
        .from('games_character_requests') // ensure this table exists!
        .insert({
            user_id: userId,
            username: interaction.user.tag,
            series: selectedSeries
        });

    if (insertError) {
        console.error('Request insert error:', insertError);
        // Refund
        await supabase
            .from(helpers.tables.GAMES_USER_DATA)
            .update({ tickets: balance })
            .eq('user_id', userId);
        await interaction.reply({ content: '❌ Failed to record your request. Tickets have been refunded.', ephemeral: true });
        activeSessions.delete(userId);
        return;
    }

    // Success
    await interaction.reply({
        content: `✅ Request recorded! You requested a character from **${selectedSeries}**.\nYour new balance: **${newBalance}** tickets.`,
        ephemeral: true
    });
    activeSessions.delete(userId);


}

async function handleRedeemCancel(interaction) {
    activeSessions.delete(interaction.user.id);
    await interaction.reply({ content: 'Request cancelled.', ephemeral: true });
}

module.exports = {
    handleRedeemStart,
    handleRedeemSeries,
    handleRedeemCancel,
    startCleanup,
    stopCleanup
};
