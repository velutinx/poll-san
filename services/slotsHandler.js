// This is     poll-san/services/slotsHandler.js

const { EmbedBuilder, MessageFlags } = require('discord.js');
const supabase = require('./supabase');

const SYMBOLS = ['🍒', '🍇', '🍊', '🍋', '7️⃣', '💎'];
const PAYOUTS = {
    threeDiamond: 10,
    threeOther: 2,
    twoOfKind: 0.5
};

/**
 * Handle the modal submission for slot machine bets
 */
async function handleSlotsModal(interaction) {
    const betAmount = parseInt(interaction.fields.getTextInputValue('bet_amount'));
    const userId = interaction.user.id;

    // Validate bet
    if (isNaN(betAmount) || betAmount < 1 || betAmount > 100) {
        return interaction.reply({ content: '❌ Please enter a valid number between 1 and 100.', flags: MessageFlags.Ephemeral });
    }

    // Check balance
    const { data: userData, error: fetchError } = await supabase
        .from('games_wordle')
        .select('ticket_count')
        .eq('discord_id', userId)
        .maybeSingle();

    if (fetchError) {
        console.error('Slot balance fetch error:', fetchError);
        return interaction.reply({ content: '❌ Error checking your ticket balance.', flags: MessageFlags.Ephemeral });
    }

    const balance = userData?.ticket_count || 0;
    if (balance < betAmount) {
        return interaction.reply({ content: `❌ You only have ${balance} ticket(s). You can't bet ${betAmount}.`, flags: MessageFlags.Ephemeral });
    }

    // Deduct bet
    const { error: deductError } = await supabase
        .rpc('deduct_tickets', { user_id: userId, amount: betAmount });

    if (deductError) {
        console.error('Slot deduct error:', deductError);
        return interaction.reply({ content: '❌ Failed to place bet. Please try again.', flags: MessageFlags.Ephemeral });
    }

    // Spin the reels
    const slot1 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    const slot2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    const slot3 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

    let winAmount = 0;
    let winDescription = '';

    if (slot1 === slot2 && slot2 === slot3) {
        if (slot1 === '💎') {
            winAmount = betAmount * PAYOUTS.threeDiamond;
            winDescription = `💎 JACKPOT! Three diamonds!`;
        } else {
            winAmount = betAmount * PAYOUTS.threeOther;
            winDescription = `🎉 Three ${slot1}!`;
        }
    } else if (slot1 === slot2 || slot2 === slot3 || slot1 === slot3) {
        winAmount = Math.floor(betAmount * PAYOUTS.twoOfKind);
        winDescription = `✨ Pair of ${slot1 === slot2 ? slot1 : slot2 === slot3 ? slot2 : slot1}!`;
    }

    // Add winnings if any
    if (winAmount > 0) {
        const { error: addError } = await supabase
            .rpc('add_tickets', { user_id: userId, amount: winAmount });
        if (addError) console.error('Slot add winnings error:', addError);
    }

    // Get updated balance
    const { data: newData } = await supabase
        .from('games_wordle')
        .select('ticket_count')
        .eq('discord_id', userId)
        .maybeSingle();
    const newBalance = newData?.ticket_count || 0;

    const embed = new EmbedBuilder()
        .setTitle('🎰 Slot Machine')
        .setDescription(`**${slot1}  |  ${slot2}  |  ${slot3}**`)
        .setColor(winAmount > 0 ? '#00FFCC' : '#FF5555')
        .addFields(
            { name: 'Bet', value: `${betAmount} ticket(s)`, inline: true },
            { name: winAmount > 0 ? 'Won' : 'Lost', value: winAmount > 0 ? `+${winAmount} ticket(s)` : `-${betAmount} ticket(s)`, inline: true },
            { name: 'New Balance', value: `${newBalance} ticket(s)`, inline: true }
        )
        .setFooter({ text: winAmount > 0 ? winDescription : 'Better luck next time!' });

    // Send ephemeral reply to user
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    // Send temporary public message for logging (Sapphire)
    try {
        const publicMsg = await interaction.channel.send({ embeds: [embed] });
        setTimeout(() => publicMsg.delete().catch(() => {}), 100);
    } catch (err) {
        // ignore
    }
}

module.exports = { handleSlotsModal };
