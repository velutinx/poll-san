// services/coinTossHandler.js
const { EmbedBuilder } = require('discord.js');
const helpers = require('../utils/helpers');
const supabase = require('./supabase');

const activeGames = new Map(); // key: `${userId}-${channelId}`
const COOLDOWN_MS = 60 * 1000; // 60 seconds inactivity auto-delete

async function getCoinTossWebhook(channel) {
    let webhook = (await channel.fetchWebhooks()).find(w => w.name === 'Coin Toss');
    if (!webhook) {
        webhook = await channel.createWebhook({
            name: 'Coin Toss',
            avatar: 'https://www.velutinx.com/images/LogoDiscord.png'
        });
    }
    return webhook;
}

function tossCoin() {
    const random = Math.random();
    const isHeads = random < 0.45; // 45% chance to win
    return { isHeads, outcome: isHeads ? 'Heads' : 'Tails' };
}

async function handleCoinTossBet(interaction, betAmount) {
    const userId = interaction.user.id;
    const channel = interaction.channel;
    const gameKey = `${userId}-${channel.id}`;

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
        // Win: profit = bet amount (even money)
        winAmount = betAmount * 2;   // because we already deducted bet, adding 2×bet gives net +bet
        newBalance += winAmount;
        await supabase
            .from(helpers.tables.GAMES_USER_DATA)
            .update({ tickets: newBalance })
            .eq('user_id', userId);
        winMessage = `**You won ${betAmount} tickets!** 🎉`;   // show profit
    } else {
        winMessage = '**You lost.** Better luck next time!';
    }

    const imageUrl = isHeads
        ? 'https://www.velutinx.com/images/CoinHead.jpg'
        : 'https://www.velutinx.com/images/CoinTails.jpg';

    const embed = new EmbedBuilder()
        .setColor(isHeads ? 0x00FF00 : 0xFF0000)
        .setTitle(`🪙 ${interaction.user.displayName}'s Coin Toss`)
        .setDescription(
            `**Result:** ${outcome}\n\n` +
            `${winMessage}\n\n` +
            `**Balance:** ${newBalance} tickets 🎫\n` +
            `**Bet:** ${betAmount} tickets`
        )
        .setImage(imageUrl)
        .setFooter({ text: 'Auto‑delete after 60s of inactivity' });

    const webhook = await getCoinTossWebhook(channel);
    const existing = activeGames.get(gameKey);

    if (existing && existing.messageId) {
        await webhook.editMessage(existing.messageId, { embeds: [embed] });
        clearTimeout(existing.timeout);
    } else {
        const sentMsg = await webhook.send({
            embeds: [embed],
            username: 'Coin Toss',
            avatarURL: 'https://www.velutinx.com/images/LogoDiscord.png'
        });
        activeGames.set(gameKey, { messageId: sentMsg.id, webhook, timeout: null });
    }

    const timeout = setTimeout(async () => {
        const game = activeGames.get(gameKey);
        if (game && game.messageId && game.webhook) {
            try {
                await game.webhook.deleteMessage(game.messageId);
            } catch (err) {
                console.error('Failed to delete coin toss message:', err.message);
            }
            activeGames.delete(gameKey);
        }
    }, COOLDOWN_MS);

    const updatedGame = activeGames.get(gameKey);
    updatedGame.timeout = timeout;
    activeGames.set(gameKey, updatedGame);
}

module.exports = { handleCoinTossBet };
