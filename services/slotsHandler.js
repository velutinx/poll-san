// services/slotsHandler.js
const helpers = require('../utils/helpers');
const supabase = require('./supabase');

// Store the interaction, messageId, and timestamp to handle Discord's token expiry
const activeGames = new Map(); // key: `${userId}-${channelId}` -> { interaction, messageId, timestamp }

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

    // 1. Immediately acknowledge the static button click so it doesn't fail/load endlessly
    await interaction.deferUpdate();

    // Fetch tickets
    const { data: userData, error } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error('Slots fetch error:', error);
        await interaction.followUp({ content: '❌ Database error. Please try again later.', ephemeral: true });
        return;
    }

    const currentTickets = userData?.tickets || 0;
    if (currentTickets < betAmount) {
        await interaction.followUp({
            content: `❌ You need ${betAmount} tickets, but you have only ${currentTickets}.`,
            ephemeral: true
        });
        return;
    }

    // Deduct bet
    let newBalance = currentTickets - betAmount;
    const { error: updateError } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .update({ tickets: newBalance })
        .eq('user_id', userId);
        
    if (updateError) {
        console.error('Slots deduct error:', updateError);
        await interaction.followUp({ content: '❌ Database error. Please try again later.', ephemeral: true });
        return;
    }

    // Spin and win
    const reels = spin();
    const winAmount = calculateWin(reels, betAmount);
    let finalBalance = newBalance;
    let winMessage = '';
    
    if (winAmount > 0) {
        finalBalance = newBalance + winAmount;
        await supabase
            .from(helpers.tables.GAMES_USER_DATA)
            .update({ tickets: finalBalance })
            .eq('user_id', userId);
        winMessage = winAmount >= betAmount
            ? `**You won ${winAmount} tickets!** 🎉`
            : `**You got a small win of ${winAmount} tickets!** 🎲`;
    } else {
        winMessage = '**You lost.** Better luck next time!';
    }

    const resultLine = `${reels.join(' | ')}`;
    const embed = {
        color: winAmount > 0 ? 0x00FF00 : 0xFF0000,
        title: `🎰 ${interaction.user.displayName}'s Slots`,
        description: `${resultLine}\n\n${winMessage}\n\n**Balance:** ${finalBalance} tickets 🎫\n**Bet:** ${betAmount} tickets`,
        footer: { text: 'Click the static buttons above to spin again.' }
    };

    let game = activeGames.get(gameKey);
    let messageUpdated = false;

    // 2. Check if we have a saved game AND the original interaction token hasn't expired yet
    if (game && (Date.now() - game.timestamp < 14 * 60 * 1000)) {
        try {
            // 3. Edit the ephemeral message using the ORIGINAL interaction's webhook
            await game.interaction.webhook.editMessage(game.messageId, { embeds: [embed] });
            messageUpdated = true;
        } catch (err) {
            console.log(`Old ephemeral message missing or webhook failed, creating new one.`);
            activeGames.delete(gameKey);
        }
    }

    // 4. If we couldn't edit (it's their first time, or the old one expired/errored)
    if (!messageUpdated) {
        // Send a new ephemeral message and explicitly ask Discord for the message ID back
        const sentMsg = await interaction.followUp({ embeds: [embed], ephemeral: true, fetchReply: true });
        
        // Save the NEW interaction, its message ID, and the exact time it was created
        activeGames.set(gameKey, {
            interaction: interaction,
            messageId: sentMsg.id,
            timestamp: Date.now()
        });
    }
}

module.exports = { handleSlotsBet };
