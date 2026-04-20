// services/slotsHandler.js
const supabase = require('./supabase');
const helpers = require('../utils/helpers');

// In‑memory store for active slot games
// Key: `${userId}-${channelId}` → { messageId, webhook, timeout }
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

// Helper to get or create the "Slots" webhook in a channel
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

    // Acknowledge button click silently (no ephemeral message)
    await interaction.deferUpdate();

    // Fetch current tickets
    const { data: userData, error } = await supabase
        .from('games_user_data')
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error('Slots fetch error:', error);
        // Could send a follow-up ephemeral, but for simplicity, just log.
        return;
    }

    const currentTickets = userData?.tickets || 0;
    if (currentTickets < betAmount) {
        // Not enough tickets – send an ephemeral error (only visible to the user)
        await interaction.followUp({ content: `❌ You don't have enough tickets! You have ${currentTickets} tickets.`, ephemeral: true });
        return;
    }

    // Deduct bet
    const newBalance = currentTickets - betAmount;
    const { error: updateError } = await supabase
        .from('games_user_data')
        .update({ tickets: newBalance })
        .eq('user_id', userId);

    if (updateError) {
        console.error('Slots deduct error:', updateError);
        await interaction.followUp({ content: '❌ Database error. Please try again later.', ephemeral: true });
        return;
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

    // Build embed
    const resultLine = `${reels.join(' | ')}`;
    const winLine = winAmount > 0 ? `**You won ${winAmount} tickets!** 🎉` : '**You lost.** Better luck next time!';
    const embed = {
        color: 0xFFD700,
        title: `🎰 ${interaction.user.displayName}'s Slots`,
        description: `${resultLine}\n\n${winLine}\n\n**Balance:** ${finalBalance} tickets 🎫\n**Bet:** ${betAmount} tickets`,
        footer: { text: 'This message will auto‑delete after 60 seconds of inactivity.' }
    };

    // Get the webhook
    const webhook = await getSlotsWebhook(channel);
    const existing = activeGames.get(gameKey);

    if (existing && existing.messageId) {
        // Edit existing webhook message
        await webhook.editMessage(existing.messageId, { embeds: [embed] });
        // Clear previous timeout
        clearTimeout(existing.timeout);
    } else {
        // Send new webhook message
        const sentMsg = await webhook.send({ embeds: [embed], username: 'Slots', avatarURL: 'https://www.velutinx.com/images/LogoDiscord.png' });
        activeGames.set(gameKey, { messageId: sentMsg.id, webhook, timeout: null });
    }

    // Set new timeout to delete the message after 60 seconds
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

    // Update stored timeout
    const updatedGame = activeGames.get(gameKey);
    updatedGame.timeout = timeout;
    activeGames.set(gameKey, updatedGame);
}

module.exports = { handleSlotsBet };
