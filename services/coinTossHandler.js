// services/coinTossHandler.js
const { EmbedBuilder } = require('discord.js');
const helpers = require('../utils/helpers');
const db = require('./database');

const activeGames = new Map();

function tossCoin() {
    const random = Math.random();
    const isHeads = random < 0.45;
    return { isHeads, outcome: isHeads ? 'Heads' : 'Tails' };
}

async function handleCoinTossBet(interaction, betAmount) {
    const userId = interaction.user.id;
    const channel = interaction.channel;
    const gameKey = `${userId}-${channel.id}`;

    try {
        await interaction.deferUpdate();
    } catch (error) {
        return;
    }

    let currentTickets = 0;
    try {
        const row = await db.query(
            `SELECT tickets FROM ${helpers.tables.GAMES_USER_DATA} WHERE user_id = ?`,
            [userId],
            true
        );
        currentTickets = row?.tickets || 0;
    } catch (error) {
        console.error('Coin toss fetch error:', error);
        return;
    }

    if (currentTickets < betAmount) {
        return interaction.followUp({
            content: `${helpers.releaseEmojis?.BATSU || '❌'} You need ${betAmount} tickets, but you only have ${currentTickets}.`,
            ephemeral: true
        });
    }

    let newBalance = currentTickets - betAmount;
    try {
        await db.query(
            `UPDATE ${helpers.tables.GAMES_USER_DATA} SET tickets = ? WHERE user_id = ?`,
            [newBalance, userId]
        );
    } catch (updateError) {
        console.error('Coin toss deduct error:', updateError);
        return interaction.followUp({
            content: `${helpers.releaseEmojis?.BATSU || '❌'} Database error. Please try again later.`,
            ephemeral: true
        });
    }

    const { isHeads, outcome } = tossCoin();
    let winAmount = 0;
    let winMessage = '';

    const confettiEmoji = helpers.releaseEmojis?.CONFETTI || '<a:confetti:1491689074002755664>';

    if (isHeads) {
        winAmount = betAmount * 2;
        newBalance += winAmount;
        try {
            await db.query(
                `UPDATE ${helpers.tables.GAMES_USER_DATA} SET tickets = ? WHERE user_id = ?`,
                [newBalance, userId]
            );
        } catch (err) {
            console.error('Coin toss update after win error:', err);
            // The bet was already deducted, but the win addition failed.
            // This is a rare situation; log it and continue showing the old balance.
            newBalance -= winAmount; // revert for display
        }
        winMessage = `**You won ${betAmount} tickets!** ${confettiEmoji}`;
    } else {
        winMessage = '**You lost.** Better luck next time!';
    }

    const imageUrl = isHeads
        ? 'https://www.velutinx.com/images/CoinHead.jpg'
        : 'https://www.velutinx.com/images/CoinTails.jpg';

    const titleEmoji = helpers.releaseEmojis?.CATCOIN || '🪙';
    const outcomeEmoji = isHeads ? (helpers.releaseEmojis?.YOSHICOIN || '🪙') : '🪙';
    const ticketEmoji = helpers.releaseEmojis?.TICKET || '🎫';

    const embed = new EmbedBuilder()
        .setColor(isHeads ? 0x00FF00 : 0xFF0000)
        .setTitle(`${titleEmoji} Velutinx's Coin Toss`)
        .setDescription(
            `**Result:** ${outcomeEmoji} ${outcome}\n\n` +
            `${winMessage}\n\n` +
            `**Balance:** ${newBalance} tickets ${ticketEmoji}\n` +
            `**Bet:** ${betAmount} tickets`
        )
        .setImage(imageUrl);

    let game = activeGames.get(gameKey);

    if (game && (Date.now() - game.timestamp < 14 * 60 * 1000)) {
        try {
            await game.interaction.webhook.deleteMessage(game.messageId);
        } catch (err) {
        }
    }

    try {
        const sentMsg = await interaction.followUp({
            embeds: [embed],
            ephemeral: true,
            fetchReply: true
        });

        activeGames.set(gameKey, {
            interaction: interaction,
            messageId: sentMsg.id,
            timestamp: Date.now()
        });
    } catch (err) {
        console.error('Failed to send followUp for coin toss:', err.message);
    }
}

module.exports = { handleCoinTossBet };
