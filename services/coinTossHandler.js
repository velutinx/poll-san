// services/coinTossHandler.js
const { EmbedBuilder } = require('discord.js');
const helpers = require('../utils/helpers');
const supabase = require('./supabase');

// key: `${userId}-${channelId}` -> { interaction, messageId, timestamp }
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

    // 1. Acknowledge the static button click
    await interaction.deferUpdate();

    // Fetch user tickets
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
            content: `❌ You need ${betAmount} tickets, but you only have ${currentTickets}.`,
            ephemeral: true
        });
    }

    // Deduct bet
    let newBalance = currentTickets - betAmount;
    const { error: updateError } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .update({ tickets: newBalance })
        .eq('user_id', userId);

    if (updateError) {
        console.error('Coin toss deduct error:', updateError);
        return interaction.followUp({ content: '❌ Database error. Please try again later.', ephemeral: true });
    }

    // Toss
    const { isHeads, outcome } = tossCoin();
    let winAmount = 0;
    let winMessage = '';

    if (isHeads) {
        winAmount = betAmount * 2;
        newBalance += winAmount;
        await supabase
            .from(helpers.tables.GAMES_USER_DATA)
            .update({ tickets: newBalance })
            .eq('user_id', userId);
        winMessage = `**You won ${betAmount} tickets!** 🎉`;
    } else {
        winMessage = '**You lost.** Better luck next time!';
    }

    const imageUrl = isHeads
        ? 'https://www.velutinx.com/images/CoinHead.jpg'
        : 'https://www.velutinx.com/images/CoinTails.jpg';

    const titleEmoji = helpers.releaseEmojis.CATCOIN;               // <a:catcoin:...>
    const outcomeEmoji = isHeads ? helpers.releaseEmojis.YOSHICOIN : '🪙';
    const ticketEmoji = helpers.releaseEmojis.TICKET;               // <a:ticket:...>

    const embed = new EmbedBuilder()
        .setColor(isHeads ? 0x00FF00 : 0xFF0000)
        .setTitle(`${titleEmoji} Velutinx's Coin Toss`)
        .setDescription(
            `**Result:** ${outcomeEmoji} ${outcome}\n\n` +
            `${winMessage}\n\n` +
            `**Balance:** ${newBalance} tickets ${ticketEmoji}\n` +
            `**Bet:** ${betAmount} tickets`
        )
        .setImage(imageUrl)
        .setFooter({ text: `${outcomeEmoji} Velutinx's Coin Toss\nOld messages are cleared to keep chat clean.` });

    let game = activeGames.get(gameKey);

    // 2. Delete the old ephemeral message to prevent clutter
    if (game && (Date.now() - game.timestamp < 14 * 60 * 1000)) {
        try {
            // Attempt to delete the previous ephemeral message
            await game.interaction.webhook.deleteMessage(game.messageId);
        } catch (err) {
            // Silently ignore: The user likely dismissed it manually, or the token expired.
        }
    }

    // 3. ALWAYS send a brand new ephemeral message tied to the current click
    const sentMsg = await interaction.followUp({ 
        embeds: [embed], 
        ephemeral: true, 
        fetchReply: true 
    });

    // 4. Update the active game cache with the NEW message details
    activeGames.set(gameKey, {
        interaction: interaction,
        messageId: sentMsg.id,
        timestamp: Date.now()
    });
}

module.exports = { handleCoinTossBet };
