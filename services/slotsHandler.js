// services/slotsHandler.js
const supabase = require('./supabase');
const helpers = require('../utils/helpers');

// Slot machine symbols and multipliers
const SYMBOLS = ['🍒', '🍒', '🍒', '💎', '💎', '🍒']; // weighted
const MULTIPLIERS = {
    '💎💎💎': 10,
    '🍒🍒🍒': 2,
    'pair': 2.1
};

function spin() {
    const reels = [
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]
    ];
    return reels;
}

function calculateWin(reels, bet) {
    const [a, b, c] = reels;
    if (a === b && b === c) {
        const key = `${a}${b}${c}`;
        const multiplier = MULTIPLIERS[key] || 0;
        return Math.floor(bet * multiplier);
    }
    if (a === b || b === c || a === c) {
        return Math.floor(bet * MULTIPLIERS.pair);
    }
    return 0;
}

async function handleSlotsBet(interaction, betAmount) {
    const userId = interaction.user.id;

    // Fetch current tickets from Supabase
    const { data: userData, error } = await supabase
        .from('games_user_data')
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error('Slots fetch error:', error);
        return interaction.reply({ content: '❌ Error fetching ticket balance.', ephemeral: true });
    }

    const currentTickets = userData?.tickets || 0;
    if (currentTickets < betAmount) {
        return interaction.reply({ content: `❌ You don't have enough tickets! You have ${currentTickets} tickets.`, ephemeral: true });
    }

    // Deduct bet
    const newBalance = currentTickets - betAmount;
    const { error: updateError } = await supabase
        .from('games_user_data')
        .update({ tickets: newBalance })
        .eq('user_id', userId);

    if (updateError) {
        console.error('Slots deduct error:', updateError);
        return interaction.reply({ content: '❌ Database error. Please try again later.', ephemeral: true });
    }

    // Perform spin
    const reels = spin();
    const winAmount = calculateWin(reels, betAmount);
    let finalBalance = newBalance;

    if (winAmount > 0) {
        finalBalance = newBalance + winAmount;
        await supabase
            .from('games_user_data')
            .update({ tickets: finalBalance })
            .eq('user_id', userId);
    }

    // Build result message
    const resultText = `${reels.join(' | ')}`;
    let winText = '';
    if (winAmount > 0) {
        winText = `\n\n**You won ${winAmount} tickets!** 🎉`;
    } else {
        winText = `\n\n**You lost.** Better luck next time!`;
    }

    const embed = {
        color: 0xFFD700,
        title: '🎰 Slot Machine',
        description: `${resultText}${winText}\n\n**New balance:** ${finalBalance} tickets 🎫`,
        footer: { text: `Bet: ${betAmount} tickets` }
    };

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = { handleSlotsBet };
