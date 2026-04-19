// This is     poll-san/services/slotsHandler.js

const { EmbedBuilder, MessageFlags } = require('discord.js');
const supabase = require('./supabase');

const SYMBOLS = ['🍒', '🍇', '🍊', '🍋', '7️⃣', '💎'];
const PAYOUTS = {
    threeDiamond: 10,
    threeOther: 2,
    twoOfKind: 2.1
};

// Track active slot messages per user (userId -> message)
const activeSlotMessages = new Map();
const INACTIVITY_TIMEOUT = 30000; // 30 seconds

async function handleSlotsBet(interaction, betAmount) {
    const userId = interaction.user.id;
    const user = interaction.user;

    // Immediately defer the reply so Discord knows we're processing
    // We don't show anything yet—just acknowledge the interaction
    await interaction.deferUpdate();

    // Validate and deduct tickets (same as before)
    const { data: userData, error: fetchError } = await supabase
        .from('games_wordle')
        .select('ticket_count')
        .eq('discord_id', userId)
        .maybeSingle();

    if (fetchError) {
        console.error('Slot balance fetch error:', fetchError);
        return interaction.followUp({ content: '❌ Error checking your ticket balance.', flags: MessageFlags.Ephemeral });
    }

    const balance = userData?.ticket_count || 0;
    if (balance < betAmount) {
        return interaction.followUp({ content: `❌ You only have ${balance} ticket(s). You can't bet ${betAmount}.`, flags: MessageFlags.Ephemeral });
    }

    const { error: deductError } = await supabase
        .rpc('deduct_tickets', { user_id: userId, amount: betAmount });

    if (deductError) {
        console.error('Slot deduct error:', deductError);
        return interaction.followUp({ content: '❌ Failed to place bet. Please try again.', flags: MessageFlags.Ephemeral });
    }

    // Spin reels
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

    if (winAmount > 0) {
        const { error: addError } = await supabase
            .rpc('add_tickets', { user_id: userId, amount: winAmount });
        if (addError) console.error('Slot add winnings error:', addError);
    }

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

    // Check if user already has an active slot message
    const existingMessage = activeSlotMessages.get(userId);
    const channel = interaction.channel;

    try {
        let slotMessage;
        if (existingMessage) {
            // Edit the existing message
            slotMessage = await existingMessage.edit({ embeds: [embed] });
            // Reset the auto-delete timer
            clearTimeout(existingMessage._timeout);
        } else {
            // Send a new public message
            slotMessage = await channel.send({ embeds: [embed] });
        }

        // Store the message and set a timeout to delete it after inactivity
        const timeout = setTimeout(async () => {
            activeSlotMessages.delete(userId);
            try {
                await slotMessage.delete();
            } catch (err) {
                // Message already deleted
            }
        }, INACTIVITY_TIMEOUT);

        slotMessage._timeout = timeout;
        activeSlotMessages.set(userId, slotMessage);

        // Optional: send ephemeral confirmation that spin was processed (can be silent if preferred)
        // await interaction.followUp({ content: 'Spin complete!', flags: MessageFlags.Ephemeral });

    } catch (err) {
        console.error('Failed to send/edit slot message:', err);
        // Fallback to ephemeral reply if public message fails
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // Sapphire logging: we can also send a temporary public copy if needed, but the main message already serves as public log.
    // If you still want an extra flash message for Sapphire, uncomment below:
    /*
    try {
        const publicMsg = await interaction.channel.send({ embeds: [embed] });
        setTimeout(() => publicMsg.delete().catch(() => {}), 100);
    } catch (err) {}
    */
}

module.exports = { handleSlotsBet };
