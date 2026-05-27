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

async function notifyAdmin(interaction, message) {
    try {
        const adminChannelId = helpers.ids.channels.admin_channel;
        const adminChannel = await interaction.client.channels.fetch(adminChannelId);
        await adminChannel.send({
            content: message,
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

    const { data: userData } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();
    const balance = userData?.tickets || 0;

    if (balance < cost) {
        return interaction.editReply(
            `${helpers.releaseEmojis.BATSU} You need **${cost}** tickets, but you only have **${balance}**.`
        );
    }

    const { data: claims } = await supabase
        .from(helpers.tables.GAMES_MUDAE_CLAIMS)
        .select('series')
        .eq('user_id', userId);

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
    const { data: userData } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();
    const balance = userData?.tickets || 0;

    if (balance < cost) {
        await interaction.editReply(
            `${helpers.releaseEmojis.BATSU} Insufficient tickets (need ${cost}, have ${balance}).`
        );
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
        await interaction.editReply(
            `${helpers.releaseEmojis.BATSU} Database error. Tickets not deducted.`
        );
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
        await supabase
            .from(helpers.tables.GAMES_USER_DATA)
            .update({ tickets: balance })
            .eq('user_id', userId);
        await interaction.editReply(
            `${helpers.releaseEmojis.BATSU} Failed to record your request. Tickets have been refunded.`
        );
        activeSessions.delete(userId);
        return;
    }

    await interaction.editReply(
        `${helpers.releaseEmojis.getRandomVerify()} Request recorded! You requested a character from **${selectedSeries}**.\nYour new balance: **${newBalance}** tickets.`
    );
    activeSessions.delete(userId);

    await notifyAdmin(
        interaction,
        `${helpers.getRandomPresent()} <@${userId}> (${interaction.user.tag}) requested a character from **${selectedSeries}**.\nBalance: ${newBalance} tickets.`
    );
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
    const { data: userData } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();
    const balance = userData?.tickets || 0;

    if (balance < cost) {
        return interaction.editReply(
            `${helpers.releaseEmojis.BATSU} You need **${cost}** tickets, but you only have **${balance}**.`
        );
    }

    // 2. Deduct tickets
    const newBalance = balance - cost;
    const { error: updateError } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .update({ tickets: newBalance })
        .eq('user_id', userId);
    if (updateError) {
        console.error('Vote boost deduction error:', updateError);
        return interaction.editReply(
            `${helpers.releaseEmojis.BATSU} Database error. Please try again.`
        );
    }

    // 3. Upsert the vote boost (extend existing, or create new)
    const now = new Date();
    const { data: existingBoost } = await supabase
        .from('games_vote_boosts')
        .select('id, expires_at')
        .eq('user_id', userId)
        .gt('expires_at', now.toISOString())
        .maybeSingle();

    let newExpiresAt;
    if (existingBoost) {
        const currentExpiry = new Date(existingBoost.expires_at);
        currentExpiry.setDate(currentExpiry.getDate() + helpers.redeem.voteBoostDurationDays);
        newExpiresAt = currentExpiry.toISOString();

        await supabase
            .from('games_vote_boosts')
            .update({ expires_at: newExpiresAt, username: interaction.user.tag })
            .eq('id', existingBoost.id);
    } else {
        newExpiresAt = new Date(
            now.getTime() + helpers.redeem.voteBoostDurationDays * 24 * 60 * 60 * 1000
        ).toISOString();

        await supabase
            .from('games_vote_boosts')
            .insert({
                user_id: userId,
                username: interaction.user.tag,
                expires_at: newExpiresAt
            });
    }

    // 4. Reply to the user (no admin notification)
    await interaction.editReply(
        `${helpers.releaseEmojis.getRandomVerify()} **Vote Boost activated!** Your poll votes will count double until **<t:${Math.floor(new Date(newExpiresAt).getTime() / 1000)}:R>**. ` +
        `\nNew balance: **${newBalance}** tickets.`
    );
    // Admin notification intentionally removed
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

    const { data: userData } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();
    const balance = userData?.tickets || 0;

    if (balance < cost) {
        return interaction.editReply(
            `${helpers.releaseEmojis.BATSU} Insufficient tickets (need ${cost}, have ${balance}).`
        );
    }

    const newBalance = balance - cost;
    await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .update({ tickets: newBalance })
        .eq('user_id', userId);
    await supabase.from('games_character_suggestions').insert({
        user_id: userId,
        username: interaction.user.tag,
        character_name: characterName,
        series: series
    });

    await interaction.editReply(
        `${helpers.releaseEmojis.getRandomVerify()} Suggestion recorded: **${characterName}**${series !== 'Not provided' ? ` (${series})` : ''}.\nNew balance: **${newBalance}** tickets.`
    );

    await notifyAdmin(
        interaction,
        `${helpers.releaseEmojis.SPEECH} <@${userId}> (${interaction.user.tag}) suggested:\n**Character:** ${characterName}\n**Series:** ${series}\nPlease consider it for the next poll.`
    );
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
