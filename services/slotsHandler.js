// services/slotsHandler.js
const supabase = require('./supabase');

const activeGames = new Map();

// 5 symbols with different frequencies and multipliers
// More common symbols have lower multipliers, rarer symbols have higher multipliers
const SYMBOLS = [
    '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', // 10 cherries
    '🍋', '🍋', '🍋', '🍋', '🍋', '🍋', '🍋',                     // 7 lemons
    '🍊', '🍊', '🍊', '🍊', '🍊',                                 // 5 oranges
    '💎', '💎', '💎',                                             // 3 diamonds
    '7️⃣', '7️⃣'                                                  // 2 sevens (jackpot)
]; // total 27 symbols

const PAYOUTS = {
    '🍒': 2,   // triple cherry pays 2x bet
    '🍋': 3,   // triple lemon pays 3x
    '🍊': 5,   // triple orange pays 5x
    '💎': 10,  // triple diamond pays 10x
    '7️⃣': 50   // triple sevens pays 50x (jackpot)
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
        const multiplier = PAYOUTS[a];
        if (multiplier) return Math.floor(bet * multiplier);
    }
    return 0; // no win
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
        await interaction.followUp({ content: `❌ You need ${betAmount} tickets, but you have only ${currentTickets}.`, ephemeral: true });
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
    let winMessage = '';
    if (winAmount > 0) {
        finalBalance = newBalance + winAmount;
        await supabase
            .from('games_user_data')
            .update({ tickets: finalBalance })
            .eq('user_id', userId);
        winMessage = `**You won ${winAmount} tickets!** 🎉`;
    } else {
        winMessage = '**You lost.** Better luck next time!';
    }

    // Build embed
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
