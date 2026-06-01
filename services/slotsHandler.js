// services/slotsHandler.js
const { EmbedBuilder, MessageFlags } = require('discord.js');
const helpers = require('../utils/helpers');
const db = require('./database');

const activeGames = new Map();

const SYMBOLS = [
    '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒',
    '🍋', '🍋', '🍋', '🍋', '🍋', '🍋', '🍋',
    '🍊', '🍊', '🍊', '🍊', '🍊',
    '💎', '💎', '💎',
    '7️⃣', '7️⃣'
];

const TRIPLE_PAYOUTS = {
    '🍒': 2, '🍋': 3, '🍊': 5, '💎': 10, '7️⃣': 50
};
const PAIR_PAYOUT = 0.8;

function spin() {
    return [
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]
    ];
}

function calculateWin(reels, bet) {
    const [a, b, c] = reels;
    if (a === b && b === c) {
        const multiplier = TRIPLE_PAYOUTS[a];
        if (multiplier) return Math.floor(bet * multiplier);
    }
    if (a === b || b === c || a === c) {
        return Math.floor(bet * PAIR_PAYOUT);
    }
    return 0;
}

async function handleSlotsBet(interaction, betAmount) {
    const userId = interaction.user.id;
    const channel = interaction.channel;
    const gameKey = `${userId}-${channel.id}`;

    try {
        await interaction.deferUpdate();
    } catch (error) {
        return;
    }

    // Fetch current tickets
    let currentTickets = 0;
    try {
        const row = await db.query(
            `SELECT tickets FROM ${helpers.tables.GAMES_USER_DATA} WHERE user_id = ?`,
            [userId],
            true
        );
        currentTickets = row?.tickets || 0;
    } catch (error) {
        console.error('Slots fetch error:', error);
        return interaction.followUp({ 
            content: `${helpers.releaseEmojis?.BATSU || '❌'} Database error. Please try again later.`, 
            flags: MessageFlags.Ephemeral 
        });
    }

    if (currentTickets < betAmount) {
        return interaction.followUp({
            content: `${helpers.releaseEmojis?.BATSU || '❌'} You need ${betAmount} tickets, but you have only ${currentTickets}.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Deduct bet amount
    let newBalance = currentTickets - betAmount;
    try {
        await db.query(
            `UPDATE ${helpers.tables.GAMES_USER_DATA} SET tickets = ? WHERE user_id = ?`,
            [newBalance, userId]
        );
    } catch (updateError) {
        console.error('Slots deduct error:', updateError);
        return interaction.followUp({ 
            content: `${helpers.releaseEmojis?.BATSU || '❌'} Database error. Please try again later.`, 
            flags: MessageFlags.Ephemeral 
        });
    }

    const reels = spin();
    const winAmount = calculateWin(reels, betAmount);
    let finalBalance = newBalance;
    let winMessage = '';

    if (winAmount > 0) {
        finalBalance = newBalance + winAmount;
        try {
            await db.query(
                `UPDATE ${helpers.tables.GAMES_USER_DATA} SET tickets = ? WHERE user_id = ?`,
                [finalBalance, userId]
            );
        } catch (err) {
            console.error('Slots win update error:', err);
            // Continue with the displayed balance anyway
        }
        winMessage = winAmount >= betAmount
            ? `**You won ${winAmount} tickets!** ${helpers.releaseEmojis?.CONFETTI || '🎉'}`
            : `**You got a small win of ${winAmount} tickets!** ${helpers.releaseEmojis?.DICE || '🎲'}`;
    } else {
        winMessage = '**You lost.** Better luck next time!';
    }

    const resultLine = `${reels.join(' | ')}`;
    
    const embed = new EmbedBuilder()
        .setColor(winAmount > 0 ? 0x00FF00 : 0xFF0000)
        .setTitle(`🎰 ${interaction.user.displayName}'s Slots`)
        .setDescription(
            `${resultLine}\n\n${winMessage}\n\n` +
            `**Balance:** ${finalBalance} tickets ${helpers.releaseEmojis?.TICKET || '🎫'}\n` +
            `**Bet:** ${betAmount} tickets`
        );

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
            flags: MessageFlags.Ephemeral, 
            fetchReply: true 
        });
        
        activeGames.set(gameKey, {
            interaction: interaction,
            messageId: sentMsg.id,
            timestamp: Date.now()
        });
    } catch (err) {
        console.error('Failed to send followUp for slots:', err.message);
    }
}

module.exports = { handleSlotsBet };
