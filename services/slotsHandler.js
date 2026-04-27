// services/slotsHandler.js
const helpers = require('../utils/helpers');
const supabase = require('./supabase');

const activeGames = new Map(); // key: `${userId}-${channelId}` -> { messageId, timeout }

const SYMBOLS = [
    '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒',
    '🍋', '🍋', '🍋', '🍋', '🍋', '🍋', '🍋',
    '🍊', '🍊', '🍊', '🍊', '🍊',
    '💎', '💎', '💎',
    '7️⃣', '7️⃣'
];

const TRIPLE_PAYOUTS = {
    '🍒': 2,
    '🍋': 3,
    '🍊': 5,
    '💎': 10,
    '7️⃣': 50
};
const PAIR_PAYOUT = 0.8;
const INACTIVITY_MS = 60 * 1000;

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

    // 1. Acknowledge button click
    await interaction.deferUpdate();

    // 2. Fetch and update tickets
    const { data: userData, error } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error('Slots fetch error:', error);
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

    // 3. Spin and calculate win
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

    // 4. Build embed
    const resultLine = `${reels.join(' | ')}`;
    const embed = {
        color: winAmount > 0 ? 0x00FF00 : 0xFF0000,
        title: `🎰 ${interaction.user.displayName}'s Slots`,
        description: `${resultLine}\n\n${winMessage}\n\n**Balance:** ${finalBalance} tickets 🎫\n**Bet:** ${betAmount} tickets`,
        footer: { text: 'Auto‑delete after 60s of inactivity' }
    };

    // 5. Send or edit existing ephemeral message
    let game = activeGames.get(gameKey);
    if (game && game.messageId) {
        // Edit existing message
        try {
            const msg = await channel.messages.fetch(game.messageId);
            await msg.edit({ embeds: [embed] });
            // Clear old timeout
            if (game.timeout) clearTimeout(game.timeout);
        } catch (err) {
            // Message missing – create new one
            const sent = await interaction.followUp({ embeds: [embed], ephemeral: true });
            game = { messageId: sent.id, timeout: null };
        }
    } else {
        // First spin – create new ephemeral message
        const sent = await interaction.followUp({ embeds: [embed], ephemeral: true });
        game = { messageId: sent.id, timeout: null };
    }

    // 6. Set new timeout for auto‑delete
    const timeout = setTimeout(async () => {
        const currentGame = activeGames.get(gameKey);
        if (currentGame && currentGame.messageId) {
            try {
                const msg = await channel.messages.fetch(currentGame.messageId);
                await msg.delete();
            } catch (err) { /* ignore */ }
            activeGames.delete(gameKey);
        }
    }, INACTIVITY_MS);

    game.timeout = timeout;
    activeGames.set(gameKey, game);
}

module.exports = { handleSlotsBet };
