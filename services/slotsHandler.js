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
const INACTIVITY_MS = 60 * 1000; // 60 seconds

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

    // 1. Acknowledge the button click (no reply yet)
    await interaction.deferUpdate();

    // 2. Fetch user tickets
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

    // 3. Deduct bet
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

    // 4. Spin
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

    // 5. Build embed
    const resultLine = `${reels.join(' | ')}`;
    const embed = {
        color: winAmount > 0 ? 0x00FF00 : 0xFF0000,
        title: `🎰 ${interaction.user.displayName}'s Slots`,
        description: `${resultLine}\n\n${winMessage}\n\n**Balance:** ${finalBalance} tickets 🎫\n**Bet:** ${betAmount} tickets`,
        footer: { text: 'Auto‑delete after 60s of inactivity' }
    };

    // 6. Send or edit ephemeral message
    const existing = activeGames.get(gameKey);
    if (existing && existing.messageId) {
        // Edit the existing ephemeral message
        const originalMsg = await interaction.channel.messages.fetch(existing.messageId).catch(() => null);
        if (originalMsg) {
            await originalMsg.edit({ embeds: [embed] });
            clearTimeout(existing.timeout);
        } else {
            // Message gone (e.g., deleted) – create a new one
            const sent = await interaction.followUp({ embeds: [embed], ephemeral: true });
            activeGames.set(gameKey, { messageId: sent.id, timeout: null });
            existing = { messageId: sent.id, timeout: null };
        }
    } else {
        // First spin – send a new ephemeral message
        const sent = await interaction.followUp({ embeds: [embed], ephemeral: true });
        activeGames.set(gameKey, { messageId: sent.id, timeout: null });
    }

    // 7. Set inactivity auto‑delete
    const newTimeout = setTimeout(async () => {
        const game = activeGames.get(gameKey);
        if (game && game.messageId) {
            try {
                const msg = await interaction.channel.messages.fetch(game.messageId);
                await msg.delete();
            } catch (err) { /* already deleted */ }
            activeGames.delete(gameKey);
        }
    }, INACTIVITY_MS);

    const updatedGame = activeGames.get(gameKey);
    updatedGame.timeout = newTimeout;
    activeGames.set(gameKey, updatedGame);
}

module.exports = { handleSlotsBet };
