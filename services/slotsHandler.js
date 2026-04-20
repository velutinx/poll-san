// services/slotsHandler.js
const supabase = require('./supabase');
const helpers = require('../utils/helpers');

// In‑memory store for active slot games
// Key: `${userId}-${channelId}` → { message, timeout }
const activeGames = new Map();

const SYMBOLS = ['🍒', '🍒', '🍒', '💎', '💎', '🍒'];
const MULTIPLIERS = {
    '💎💎💎': 10,
    '🍒🍒🍒': 2,
    'pair': 2.1
};

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
    const channelId = interaction.channel.id;
    const gameKey = `${userId}-${channelId}`;

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

    // Build result message content
    const resultLine = `${reels.join(' | ')}`;
    const winLine = winAmount > 0 ? `**You won ${winAmount} tickets!** 🎉` : '**You lost.** Better luck next time!';
    const embed = {
        color: 0xFFD700,
        title: `🎰 ${interaction.user.displayName}'s Slots`,
        description: `${resultLine}\n\n${winLine}\n\n**Balance:** ${finalBalance} tickets 🎫\n**Bet:** ${betAmount} tickets`,
        footer: { text: 'This message will auto‑delete after 60 seconds of inactivity.' }
    };

    // Check if there is already an active game message for this user
    const existing = activeGames.get(gameKey);
    if (existing && existing.message) {
        // Update existing message
        await existing.message.edit({ embeds: [embed] });
        // Clear previous timeout
        clearTimeout(existing.timeout);
    } else {
        // Send new message (non‑ephemeral)
        const sentMsg = await interaction.channel.send({ embeds: [embed] });
        activeGames.set(gameKey, { message: sentMsg, timeout: null });
    }

    // Set a new timeout to delete the message after 60 seconds
    const timeout = setTimeout(async () => {
        const game = activeGames.get(gameKey);
        if (game && game.message) {
            try {
                await game.message.delete();
            } catch (err) {
                console.error('Failed to delete slot message:', err.message);
            }
            activeGames.delete(gameKey);
        }
    }, 60 * 1000);

    // Store the new timeout
    activeGames.set(gameKey, { message: existing?.message || (await activeGames.get(gameKey)?.message), timeout });

    // Acknowledge the interaction (but we already sent a message, so just defer? Actually we need to reply to the button click)
    // The button click requires a reply, but we already sent a channel message. We can reply ephemerally that the game started/continued.
    // To avoid double‑posting, we reply with a short ephemeral confirmation that disappears.
    if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `🎲 Spin placed! Check the slot machine above.`, flags: 64 });
        // Auto‑delete that ephemeral after 3 seconds? Not necessary, but can be done.
    }
}

module.exports = { handleSlotsBet };
