// services/slotsHandler.js
const helpers = require('../utils/helpers');
const supabase = require('./supabase');

const activeGames = new Map();

// Symbol frequencies (total 27)
const SYMBOLS = [
    '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', // 10 cherries
    '🍋', '🍋', '🍋', '🍋', '🍋', '🍋', '🍋',                     // 7 lemons
    '🍊', '🍊', '🍊', '🍊', '🍊',                                 // 5 oranges
    '💎', '💎', '💎',                                             // 3 diamonds
    '7️⃣', '7️⃣'                                                  // 2 sevens
];

// Triple payouts (multiplier)
const TRIPLE_PAYOUTS = {
    '🍒': 2,
    '🍋': 3,
    '🍊': 5,
    '💎': 10,
    '7️⃣': 50
};

// Pair payout (multiplier) – win back 40% of bet
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

async function getSlotsWebhook(channel) {
    let webhook = (await channel.fetchWebhooks()).find(w => w.name === 'Slots');
    if (!webhook) {
        webhook = await channel.createWebhook({
            name: 'Slots',
            avatar: 'https://www.velutinx.com/images/LogoDiscord.png'
        });
    }
    return webhook;
}

async function handleSlotsBet(interaction, betAmount) {
    const userId = interaction.user.id;
    const channel = interaction.channel;
    const gameKey = `${userId}-${channel.id}`;

    await interaction.deferUpdate();

    // Fetch tickets using centralized table name
    const { data: userData, error } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)   // 👈 changed
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error('Slots fetch error:', error);
        return;
    }

    const currentTickets = userData?.tickets || 0;
    if (currentTickets < betAmount) {
        await interaction.followUp({ content: `❌ You need ${betAmount} tickets, but you have only ${currentTickets}.`, ephemeral: true });
        return;
    }

    // Deduct bet
    let newBalance = currentTickets - betAmount;
    const { error: updateError } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)   // 👈 changed
        .update({ tickets: newBalance })
        .eq('user_id', userId);
    if (updateError) {
        console.error('Slots deduct error:', updateError);
        await interaction.followUp({ content: '❌ Database error. Please try again later.', ephemeral: true });
        return;
    }

    // Spin
    const reels = spin();
    const winAmount = calculateWin(reels, betAmount);
    let finalBalance = newBalance;
    let winMessage = '';
    if (winAmount > 0) {
        finalBalance = newBalance + winAmount;
        await supabase
            .from(helpers.tables.GAMES_USER_DATA)   // 👈 changed
            .update({ tickets: finalBalance })
            .eq('user_id', userId);
        if (winAmount >= betAmount) {
            winMessage = `**You won ${winAmount} tickets!** 🎉`;
        } else {
            winMessage = `**You got a small win of ${winAmount} tickets!** 🎲`;
        }
    } else {
        winMessage = '**You lost.** Better luck next time!';
    }

    const resultLine = `${reels.join(' | ')}`;
    const embed = {
        color: 0xFFD700,
        title: `🎰 ${interaction.user.displayName}'s Slots`,
        description: `${resultLine}\n\n${winMessage}\n\n**Balance:** ${finalBalance} tickets 🎫\n**Bet:** ${betAmount} tickets`,
        footer: { text: 'Auto‑delete after 60s of inactivity' }
    };

    const webhook = await getSlotsWebhook(channel);
    const existing = activeGames.get(gameKey);

    if (existing && existing.messageId) {
        await webhook.editMessage(existing.messageId, { embeds: [embed] });
        clearTimeout(existing.timeout);
    } else {
        const sentMsg = await webhook.send({ embeds: [embed], username: 'Slots', avatarURL: 'https://www.velutinx.com/images/LogoDiscord.png' });
        activeGames.set(gameKey, { messageId: sentMsg.id, webhook, timeout: null });
    }

    const timeout = setTimeout(async () => {
        const game = activeGames.get(gameKey);
        if (game && game.messageId && game.webhook) {
            try {
                await game.webhook.deleteMessage(game.messageId);
            } catch (err) {
                console.error('Failed to delete slot message:', err.message);
            }
            activeGames.delete(gameKey);
        }
    }, 60 * 1000);

    const updatedGame = activeGames.get(gameKey);
    updatedGame.timeout = timeout;
    activeGames.set(gameKey, updatedGame);
}

module.exports = { handleSlotsBet };
