// services/slotsHandler.js
const helpers = require('../utils/helpers');
const supabase = require('./supabase');

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

    const { data: userData, error } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('tickets')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error('Slots fetch error:', error);
        return interaction.followUp({ content: '❌ Database error. Please try again later.', ephemeral: true });
    }

    const currentTickets = userData?.tickets || 0;
    if (currentTickets < betAmount) {
        return interaction.followUp({
            content: `❌ You need ${betAmount} tickets, but you have only ${currentTickets}.`,
            ephemeral: true
        });
    }

    let newBalance = currentTickets - betAmount;
    const { error: updateError } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .update({ tickets: newBalance })
        .eq('user_id', userId);
        
    if (updateError) {
        console.error('Slots deduct error:', updateError);
        return interaction.followUp({ content: '❌ Database error. Please try again later.', ephemeral: true });
    }

    const reels = spin();
    const winAmount = calculateWin(reels, betAmount);
    let finalBalance = newBalance;
    let winMessage = '';
    
    const confettiEmoji = helpers.releaseEmojis?.CONFETTI || '<a:confetti:1491689074002755664>';
    const ticketEmoji = helpers.releaseEmojis?.TICKET || '🎫';

    if (winAmount > 0) {
        finalBalance = newBalance + winAmount;
        await supabase
            .from(helpers.tables.GAMES_USER_DATA)
            .update({ tickets: finalBalance })
            .eq('user_id', userId);
        winMessage = winAmount >= betAmount
            ? `**You won ${winAmount} tickets!** ${confettiEmoji}`
            : `**You got a small win of ${winAmount} tickets!** 🎲`;
    } else {
        winMessage = '**You lost.** Better luck next time!';
    }

    const resultLine = `${reels.join(' | ')}`;
    const embed = {
        color: winAmount > 0 ? 0x00FF00 : 0xFF0000,
        title: `🎰 ${interaction.user.displayName}'s Slots`,
        description: `${resultLine}\n\n${winMessage}\n\n**Balance:** ${finalBalance} tickets ${ticketEmoji}\n**Bet:** ${betAmount} tickets`
    };

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
            ephemeral: true, 
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
