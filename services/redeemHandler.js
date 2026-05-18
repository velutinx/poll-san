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
const { consolidateExistingClaims } = require('./seriesConsolidator');

// ---- Session cleanup for the series selection (character request) ----
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
        } else {
            console.error('❌ Could not fetch admin user.');
        }
    } catch (err) {
        console.error('❌ Failed to DM admin:', err);
    }
}

// ============ CHARACTER REQUEST ============
async function handleRedeemStart(interaction) {
    const userId = interaction.user.id;
    const cost = helpers.redeem.characterRequestCost;

    await interaction.deferReply({ flags: 64, withResponse: true });

    await consolidateExistingClaims();

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
    const cost = helpers.redeem.characterRequestCost;

    // ✅ Defer IMMEDIATELY – all later responses use editReply
    await interaction.deferReply({ flags: 64 });

    const session = activeSessions.get(userId);
    if (!session) {
        return interaction.editReply('❌ Session expired. Please start again.');
    }

    const seriesList = session.seriesList;
    if (index < 0 || index >= seriesList.length) {
        return interaction.editReply('❌ Invalid selection.');
    }

    const selectedSeries = seriesList[index];

    const { data: userData } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();
    const balance = userData?.tickets || 0;

    if (balance < cost) {
        await interaction.editReply(`❌ Insufficient tickets (need ${cost}, have ${balance}).`);
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
        await interaction.editReply('❌ Database error. Tickets not deducted.');
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
        await supabase.from(helpers.tables.GAMES_USER_DATA).update({ tickets: balance }).eq('user_id', userId);
        await interaction.editReply('❌ Failed to record your request. Tickets have been refunded.');
        activeSessions.delete(userId);
        return;
    }

    await interaction.editReply(`✅ Request recorded! You requested a character from **${selectedSeries}**.\nYour new balance: **${newBalance}** tickets.`);
    activeSessions.delete(userId);

    await notifyAdmin(interaction, `🎁 <@${userId}> (${interaction.user.tag}) requested a character from **${selectedSeries}**.\nBalance: ${newBalance} tickets.`);
}

async function handleRedeemCancel(interaction) {
    // ✅ Defer first
    await interaction.deferReply({ flags: 64 });
    activeSessions.delete(interaction.user.id);
    await interaction.editReply('Request cancelled.');
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
        await supabase.from(helpers.tables.GAMES_USER_DATA).update({ tickets: balance }).eq('user_id', userId);
        return interaction.editReply('❌ Failed to record your boost. Tickets have been refunded.');
    }

    await interaction.editReply(`✅ **Vote Boost activated!** Your poll votes will count double for 7 days.\nNew balance: **${newBalance}** tickets.`);

    await notifyAdmin(interaction, `🗳️ <@${userId}> (${interaction.user.tag}) purchased a **Vote Boost** (7 days). Balance: ${newBalance} tickets.`);
}

// ============ SUGGEST CHARACTER ============
async function handleRedeemSuggestCharacter(interaction) {
    const userId = interaction.user.id;
    const cost = helpers.redeem.suggestCost;

    // ✅ Defer first, then check tickets. If insufficient, editReply. If OK, show modal (which is fine after defer? Actually showModal can't be used after defer. We need to check tickets BEFORE deferring or use a different flow.)
    // So we must do the ticket check WITHOUT deferring, but we can avoid timeout by making it fast. The supabase query is quick; we'll keep the original approach but wrap in a try-catch with a fallback defer if needed.
    // However, to be safe, we can defer only if tickets are insufficient? No, because if tickets are OK we need to showModal which cannot be done after defer. So we keep the original logic: quick query, if balance < cost reply immediately (no defer). If balance >= cost, showModal directly (no defer). That's safe because both reply and showModal are immediate responses. The only risk is if the supabase query takes >3s, but that's rare. We'll leave it as is.
    
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

    // ✅ Defer the modal submission to avoid timeout
    await interaction.deferReply({ flags: 64 });

    const characterName = interaction.fields.getTextInputValue('suggest_character_name')?.trim();
    const series = interaction.fields.getTextInputValue('suggest_character_series')?.trim() || 'Not provided';

    if (!characterName) {
        return interaction.editReply('❌ Character name is required.');
    }

    const { data: userData } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();
    const balance = userData?.tickets || 0;

    if (balance < cost) {
        return interaction.editReply(`❌ Insufficient tickets (need ${cost}, have ${balance}).`);
    }

    const newBalance = balance - cost;
    await supabase.from(helpers.tables.GAMES_USER_DATA).update({ tickets: newBalance }).eq('user_id', userId);

    await supabase.from('games_character_suggestions').insert({
        user_id: userId,
        username: interaction.user.tag,
        character_name: characterName,
        series: series
    });

    await interaction.editReply(`✅ Suggestion recorded: **${characterName}**${series !== 'Not provided' ? ` (${series})` : ''}.\nNew balance: **${newBalance}** tickets.`);

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
