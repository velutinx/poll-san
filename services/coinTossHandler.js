// services/coinTossHandler.js
const { EmbedBuilder } = require('discord.js');
const helpers = require('../utils/helpers');
const supabase = require('./supabase');
const activeGames = new Map(); 

function tossCoin() {
    const random = Math.random();
    const isHeads = random < 0.45; // 45% chance to win
    return { isHeads, outcome: isHeads ? 'Heads' : 'Tails' };
}

async function handleCoinTossBet(interaction, betAmount) {
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
        console.error('Coin toss fetch error:', error);
        return;
    }

    const currentTickets = userData?.tickets || 0;
    if (currentTickets < betAmount) {
        return interaction.followUp({
            content: `${helpers.releaseEmojis?.BATSU || '❌'} You need ${betAmount} tickets, but you only have ${currentTickets}.`,
            ephemeral: true
        });
    }

    let newBalance = currentTickets - betAmount;
    const { error: updateError } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .update({ tickets: newBalance })
        .eq('user_id', userId);

    if (updateError) {
        console.error('Coin toss deduct error:', updateError);
        return interaction.followUp({ content: `${helpers.releaseEmojis?.BATSU || '❌'} Database error. Please try again later.`, ephemeral: true });
    }

    const { isHeads, outcome } = tossCoin();
    let winAmount = 0;
    let winMessage = '';

    const confettiEmoji = helpers.releaseEmojis?.CONFETTI || '<a:confetti:1491689074002755664>';

    if (isHeads) {
        winAmount = betAmount * 2;
        newBalance += winAmount;
        await supabase
            .from(helpers.tables.GAMES_USER_DATA)
            .update({ tickets: newBalance })
            .eq('user_id', userId);
        winMessage = `**You won ${betAmount} tickets!** ${confettiEmoji}`;
    } else {
        winMessage = '**You lost.** Better luck next time!';
    }

    const imageUrl = isHeads
        ? 'https://www.velutinx.com/images/CoinHead.jpg'
        : 'https://www.velutinx.com/images/CoinTails.jpg';

    const titleEmoji = helpers.releaseEmojis?.CATCOIN || '🪙';
    const outcomeEmoji = isHeads ? (helpers.releaseEmojis?.YOSHICOIN || '🪙') : '🪙';
    const ticketEmoji = helpers.releaseEmojis?.TICKET || '🎫';

    const embed = new EmbedBuilder()
        .setColor(isHeads ? 0x00FF00 : 0xFF0000)
        .setTitle(`${titleEmoji} Velutinx's Coin Toss`)
        .setDescription(
            `**Result:** ${outcomeEmoji} ${outcome}\n\n` +
            `${winMessage}\n\n` +
            `**Balance:** ${newBalance} tickets ${ticketEmoji}\n` +
            `**Bet:** ${betAmount} tickets`
        )
        .setImage(imageUrl);

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
        console.error('Failed to send followUp for coin toss:', err.message);
    }
}

module.exports = { handleCoinTossBet };
