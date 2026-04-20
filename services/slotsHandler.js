// services/slotsHandler.js
const supabase = require('./supabase');

const activeGames = new Map();

// ========== TUNABLE SLOT MACHINE SETTINGS ==========
// Symbol weights (total 100)
const SYMBOL_WEIGHTS = {
    '🍒': 20,   // cherry – low payout
    '💎': 15,   // diamond – high payout
    '⭐': 65    // star – losing symbol (pairs pay nothing)
};

// Payout multipliers (times bet)
const PAYOUTS = {
    '💎💎💎': 8,   // three diamonds
    '🍒🍒🍒': 2,   // three cherries
    'pair': 1.5    // pair of cherries or diamonds (net +0.5x)
};

// Build symbol array from weights
const SYMBOLS = [];
for (const [sym, weight] of Object.entries(SYMBOL_WEIGHTS)) {
    for (let i = 0; i < weight; i++) SYMBOLS.push(sym);
}
// ===============================================

function spin() {
    return [
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]
    ];
}

function calculateWin(reels, bet) {
    const [a, b, c] = reels;
    // Triple check
    if (a === b && b === c) {
        const key = `${a}${b}${c}`;
        const multiplier = PAYOUTS[key];
        if (multiplier) return Math.floor(bet * multiplier);
        return 0; // triple star pays nothing
    }
    // Pair check – only cherries or diamonds pay
    if (a === b || b === c || a === c) {
        const matched = (a === b) ? a : (b === c) ? b : c;
        if (matched === '🍒' || matched === '💎') {
            return Math.floor(bet * PAYOUTS.pair);
        }
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

    // Fetch tickets
    const { data: userData, error } = await supabase
        .from('games_user_data')
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error('Slots fetch error:', error);
        return;
    }

    const currentTickets = userData?.tickets || 0;
    if (currentTickets < betAmount) {
        await interaction.followUp({ content: `❌ You need ${betAmount} tickets, but you only have ${currentTickets}.`, ephemeral: true });
        return;
    }

    // Deduct bet
    let newBalance = currentTickets - betAmount;
    const { error: updateError } = await supabase
        .from('games_user_data')
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
    if (winAmount > 0) {
        finalBalance = newBalance + winAmount;
        await supabase
            .from('games_user_data')
            .update({ tickets: finalBalance })
            .eq('user_id', userId);
    }

    // Build embed
    const resultLine = `${reels.join(' | ')}`;
    const winLine = winAmount > 0 ? `**You won ${winAmount} tickets!** 🎉` : '**You lost.** Better luck next time!';
    const embed = {
        color: 0xFFD700,
        title: `🎰 ${interaction.user.displayName}'s Slots`,
        description: `${resultLine}\n\n${winLine}\n\n**Balance:** ${finalBalance} tickets 🎫\n**Bet:** ${betAmount} tickets`,
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
