// services/redeemHandler.js

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const supabase = require('./supabase');
const helpers = require('../utils/helpers');
const { getCanonicalSeries, consolidateExistingClaims } = require('./seriesConsolidator');

// ---- Session cleanup for the series selection (character request) ----
const activeSessions = new Map(); // userId -> { seriesList, timestamp }
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

// ---- Notify the bot owner (Velutinx) via DM ----
async function notifyAdmin(interaction, message) {
    try {
        const adminId = helpers.ids.users.Velutinx;
        if (!adminId) {
            console.error('❌ Admin user ID not found in helpers.ids.users.Velutinx');
            return;
        }
        const adminUser = await interaction.client.users.fetch(adminId);
        if (adminUser) {
            await adminUser.send(message);
            console.log(`📨 Admin notified: ${message.split('\n')[0]}`);
        } else {
            console.error('❌ Could not fetch admin user.');
        }
    } catch (err) {
        console.error('❌ Failed to DM admin:', err);
    }
}

// ============ CHARACTER REQUEST (existing flow) ============
async function handleRedeemStart(interaction) {
    const userId = interaction.user.id;
    const cost = helpers.redeem.characterRequestCost;

    await interaction.deferReply({ flags: 64, withResponse: true });

    const { data: userData } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();
    const balance = userData?.tickets || 0;

    if (balance < cost) {
        return interaction.editReply(`❌ You need **${cost}** tickets, but you only have **${balance}**.`);
    }

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
        content: `🎁 **Select the series you want to request a character from**\nThis will cost **${cost}** tickets.`,
        components: rows,
    });
}

async function handleRedeemSeries(interaction, index) {
    const userId = interaction.user.id;
    const session = activeSessions.get(userId);
    const cost = helpers.redeem.characterRequestCost;

    if (!session) {
        return interaction.reply({ content: '❌ Session expired. Please start again.', flags: 64 });
    }

    const seriesList = session.seriesList;
    if (index < 0 || index >= seriesList.length) {
        return interaction.reply({ content: '❌ Invalid selection.', flags: 64 });
    }

    const selectedSeries = seriesList[index];

    const { data: userData } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();
    const balance = userData?.tickets || 0;

    if (balance < cost) {
        await interaction.reply({ content: `❌ Insufficient tickets (need ${cost}, have ${balance}).`, flags: 64 });
        activeSessions.delete(userId);
        return;
    }

    const newBalance = balance - cost;
    const { error: updateError } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .update({ tickets: newBalance })
        .eq('user_id', userId);

    if (updateError) {
        console.error('Redeem deduction error:', updateError);
        await interaction.reply({ content: '❌ Database error. Tickets not deducted.', flags: 64 });
        activeSessions.delete(userId);
        return;
    }

    const { error: insertError } = await supabase
        .from('games_character_requests')
        .insert({
            user_id: userId,
            username: interaction.user.tag,
            series: selectedSeries
        });

    if (insertError) {
        console.error('Request insert error:', insertError);
        // Refund
        await supabase.from(helpers.tables.GAMES_USER_DATA).update({ tickets: balance }).eq('user_id', userId);
        await interaction.reply({ content: '❌ Failed to record your request. Tickets have been refunded.', flags: 64 });
        activeSessions.delete(userId);
        return;
    }

    await interaction.reply({
        content: `✅ Request recorded! You requested a character from **${selectedSeries}**.\nYour new balance: **${newBalance}** tickets.`,
        flags: 64
    });
    activeSessions.delete(userId);

    // DM admin
    await notifyAdmin(interaction, `🎁 <@${userId}> (${interaction.user.tag}) requested a character from **${selectedSeries}**.\nBalance: ${newBalance} tickets.`);
}

async function handleRedeemCancel(interaction) {
    activeSessions.delete(interaction.user.id);
    await interaction.reply({ content: 'Request cancelled.', flags: 64 });
}

// ============ VOTE BOOST ============
async function handleRedeemVoteBoost(interaction) {
    const userId = interaction.user.id;
    const cost = helpers.redeem.voteBoostCost;

    await interaction.deferReply({ flags: 64, withResponse: true });

    const { data: userData } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();
    const balance = userData?.tickets || 0;

    if (balance < cost) {
        return interaction.editReply(`❌ You need **${cost}** tickets, but you only have **${balance}**.`);
    }

    const newBalance = balance - cost;
    const { error: updateError } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .update({ tickets: newBalance })
        .eq('user_id', userId);

    if (updateError) {
        console.error('Vote boost deduction error:', updateError);
        return interaction.editReply('❌ Database error. Please try again.');
    }

    const expiresAt = new Date(Date.now() + helpers.redeem.voteBoostDurationDays * 24 * 60 * 60 * 1000).toISOString();
    const { error: insertError } = await supabase
        .from('games_vote_boosts')
        .insert({
            user_id: userId,
            username: interaction.user.tag,
            expires_at: expiresAt
        });

    if (insertError) {
        console.error('Vote boost insert error:', insertError);
        // Refund
        await supabase.from(helpers.tables.GAMES_USER_DATA).update({ tickets: balance }).eq('user_id', userId);
        return interaction.editReply('❌ Failed to record your boost. Tickets have been refunded.');
    }

    await interaction.editReply(`✅ **Vote Boost activated!** Your poll votes will count double for 7 days.\nNew balance: **${newBalance}** tickets.`);

    // DM admin
    await notifyAdmin(interaction, `🗳️ <@${userId}> (${interaction.user.tag}) purchased a **Vote Boost** (7 days). Balance: ${newBalance} tickets.`);
}

// ============ SUGGEST CHARACTER ============
async function handleRedeemSuggestCharacter(interaction) {
    const userId = interaction.user.id;
    const cost = helpers.redeem.suggestCost;

    // Quick ticket check before showing modal
    const { data: userData } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();
    const balance = userData?.tickets || 0;

    if (balance < cost) {
        return interaction.reply({
            content: `❌ You need **${cost}** tickets, but you only have **${balance}**.`,
            flags: 64
        });
    }

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

    const row1 = new ActionRowBuilder().addComponents(nameInput);
    const row2 = new ActionRowBuilder().addComponents(seriesInput);

    modal.addComponents(row1, row2);

    await interaction.showModal(modal);
}

async function handleSuggestModalSubmit(interaction) {
    const userId = interaction.user.id;
    const cost = helpers.redeem.suggestCost;
    const characterName = interaction.fields.getTextInputValue('suggest_character_name')?.trim();
    const series = interaction.fields.getTextInputValue('suggest_character_series')?.trim() || 'Not provided';

    if (!characterName) {
        return interaction.reply({ content: '❌ Character name is required.', flags: 64 });
    }

    // Re-check tickets
    const { data: userData } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();
    const balance = userData?.tickets || 0;

    if (balance < cost) {
        return interaction.reply({ content: `❌ Insufficient tickets (need ${cost}, have ${balance}).`, flags: 64 });
    }

    // Deduct
    const newBalance = balance - cost;
    await supabase.from(helpers.tables.GAMES_USER_DATA).update({ tickets: newBalance }).eq('user_id', userId);

    // Record suggestion
    await supabase.from('games_character_suggestions').insert({
        user_id: userId,
        username: interaction.user.tag,
        character_name: characterName,
        series: series
    });

    await interaction.reply({
        content: `✅ Suggestion recorded: **${characterName}**${series !== 'Not provided' ? ` (${series})` : ''}.\nNew balance: **${newBalance}** tickets.`,
        flags: 64
    });

    // DM admin
    await notifyAdmin(interaction, `💬 <@${userId}> (${interaction.user.tag}) suggested:\n**Character:** ${characterName}\n**Series:** ${series}\nPlease consider it for the next poll.`);
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
