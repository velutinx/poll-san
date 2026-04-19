// This is     poll-san/services/slotsHandler.js

const { EmbedBuilder, MessageFlags } = require('discord.js');
const supabase = require('./supabase');

const SYMBOLS = ['🍒', '🍇', '🍊', '🍋', '7️⃣', '💎'];
const PAYOUTS = {
    threeDiamond: 10,
    threeOther: 2,
    twoOfKind: 0.5
};

// Reusable function to spin and process the bet
async function handleSlotsBet(interaction, betAmount) {
    const userId = interaction.user.id;

    // Defer reply ephemerally so only the player sees it
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Validate bet (already guaranteed by button, but double-check)
    if (isNaN(betAmount) || betAmount < 1) {
        return interaction.editReply({ content: '❌ Invalid bet amount.' });
    }

    // Check balance and deduct
    const { data: userData, error: fetchError } = await supabase
        .from('games_wordle')
        .select('ticket_count')
        .eq('discord_id', userId)
        .maybeSingle();

    if (fetchError) {
        console.error('Slot balance fetch error:', fetchError);
        return interaction.editReply({ content: '❌ Error checking your ticket balance.' });
    }

    const balance = userData?.ticket_count || 0;
    if (balance < betAmount) {
        return interaction.editReply({ content: `❌ You only have ${balance} ticket(s). You can't bet ${betAmount}.` });
    }

    const { error: deductError } = await supabase
        .rpc('deduct_tickets', { user_id: userId, amount: betAmount });

    if (deductError) {
        console.error('Slot deduct error:', deductError);
        return interaction.editReply({ content: '❌ Failed to place bet. Please try again.' });
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

    await interaction.editReply({ embeds: [embed] });

    // Public log for Sapphire (auto-delete)
    try {
        const publicMsg = await interaction.channel.send({ embeds: [embed] });
        setTimeout(() => publicMsg.delete().catch(() => {}), 100);
    } catch (err) {
        // ignore
    }
}

module.exports = { handleSlotsBet };
