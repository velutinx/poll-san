// This is poll-san/commands/games/slots.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const supabase = require('../../services/supabase');

// Slot configuration
const SYMBOLS = ['🍒', '🍇', '🍊', '🍋', '7️⃣', '💎'];
const PAYOUTS = {
    threeDiamond: 10,   // 3x 💎
    threeOther: 2,      // 3x any other symbol
    twoOfKind: 0.5      // 2x any symbol
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('slots')
        .setDescription('Spin the slot machine with your tickets!')
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('Number of tickets to bet')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)), // Optional: cap to prevent huge losses

    async execute(interaction) {
        const bet = interaction.options.getInteger('bet');
        const userId = interaction.user.id;

        // 1. Check and deduct bet
        const { data: userData, error: fetchError } = await supabase
            .from('games_wordle')
            .select('ticket_count')
            .eq('discord_id', userId)
            .maybeSingle();

        if (fetchError) {
            console.error('Slot balance fetch error:', fetchError);
            return interaction.reply({ content: '❌ Error checking your ticket balance.', flags: { ephemeral: true } });
        }

        const balance = userData?.ticket_count || 0;
        if (balance < bet) {
            return interaction.reply({ content: `❌ You only have ${balance} ticket(s). You can't bet ${bet}.`, flags: { ephemeral: true } });
        }

        // Deduct bet first
        const { error: deductError } = await supabase
            .rpc('deduct_tickets', { user_id: userId, amount: bet });

        if (deductError) {
            console.error('Slot deduct error:', deductError);
            return interaction.reply({ content: '❌ Failed to place bet. Please try again.', flags: { ephemeral: true } });
        }

        // 2. Spin the reels
        const slot1 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
        const slot2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
        const slot3 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

        // 3. Determine winnings
        let winAmount = 0;
        let winDescription = '';

        if (slot1 === slot2 && slot2 === slot3) {
            if (slot1 === '💎') {
                winAmount = bet * PAYOUTS.threeDiamond;
                winDescription = `💎 JACKPOT! Three diamonds!`;
            } else {
                winAmount = bet * PAYOUTS.threeOther;
                winDescription = `🎉 Three ${slot1}!`;
            }
        } else if (slot1 === slot2 || slot2 === slot3 || slot1 === slot3) {
            winAmount = Math.floor(bet * PAYOUTS.twoOfKind); // 0.5x may give half tickets, round down
            winDescription = `✨ Pair of ${slot1 === slot2 ? slot1 : slot2 === slot3 ? slot2 : slot1}!`;
        }

        // 4. Update balance with winnings (if any)
        if (winAmount > 0) {
            // Use a custom RPC to add tickets (we'll create it below)
            const { error: addError } = await supabase
                .rpc('add_tickets', { user_id: userId, amount: winAmount });

            if (addError) {
                console.error('Slot add winnings error:', addError);
                // If this fails, the user lost their bet unfairly; we could log and manually fix.
                return interaction.reply({ content: '❌ Error awarding winnings. Please contact an admin.', flags: { ephemeral: true } });
            }
        }

        // 5. Get updated balance for reply
        const { data: newData } = await supabase
            .from('games_wordle')
            .select('ticket_count')
            .eq('discord_id', userId)
            .maybeSingle();
        const newBalance = newData?.ticket_count || 0;

        // 6. Build response embed
        const embed = new EmbedBuilder()
            .setTitle('🎰 Slot Machine')
            .setDescription(`**${slot1}  |  ${slot2}  |  ${slot3}**`)
            .setColor(winAmount > 0 ? '#00FFCC' : '#FF5555')
            .addFields(
                { name: 'Bet', value: `${bet} ticket(s)`, inline: true },
                { name: winAmount > 0 ? 'Won' : 'Lost', value: winAmount > 0 ? `+${winAmount} ticket(s)` : `-${bet} ticket(s)`, inline: true },
                { name: 'New Balance', value: `${newBalance} ticket(s)`, inline: true }
            )
            .setFooter({ text: winAmount > 0 ? winDescription : 'Better luck next time!' });

        await interaction.reply({ embeds: [embed] });
    }
};
