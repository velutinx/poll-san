// commands/games/slots.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const supabase = require('../../services/supabase');
const h = require('../../utils/helpers');   // for centralized tables

const SYMBOLS = ['🍒', '🍇', '🍊', '🍋', '7️⃣', '💎'];
const PAYOUTS = {
    threeDiamond: 10,
    threeOther: 2,
    twoOfKind: 0.5
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
                .setMaxValue(100)),

    async execute(interaction) {
        const bet = interaction.options.getInteger('bet');
        const userId = interaction.user.id;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // 1. Check balance using centralized table name
        const { data: userData, error: fetchError } = await supabase
            .from(h.tables.GAMES_WORDLE)   // 👈 uses helper constant
            .select('ticket_count')
            .eq('discord_id', userId)
            .maybeSingle();

        if (fetchError) {
            console.error('Slot balance fetch error:', fetchError);
            return interaction.editReply({ content: '❌ Error checking your ticket balance.' });
        }

        const balance = userData?.ticket_count || 0;
        if (balance < bet) {
            return interaction.editReply({ content: `❌ You only have ${balance} ticket(s). You can't bet ${bet}.` });
        }

        const { error: deductError } = await supabase
            .rpc('deduct_tickets', { user_id: userId, amount: bet });

        if (deductError) {
            console.error('Slot deduct error:', deductError);
            return interaction.editReply({ content: '❌ Failed to place bet. Please try again.' });
        }

        // 2. Spin
        const slot1 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
        const slot2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
        const slot3 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

        // 3. Win calculation
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
            winAmount = Math.floor(bet * PAYOUTS.twoOfKind);
            winDescription = `✨ Pair of ${slot1 === slot2 ? slot1 : slot2 === slot3 ? slot2 : slot1}!`;
        }

        // 4. Update balance
        if (winAmount > 0) {
            const { error: addError } = await supabase
                .rpc('add_tickets', { user_id: userId, amount: winAmount });
            if (addError) {
                console.error('Slot add winnings error:', addError);
                return interaction.editReply({ content: '❌ Error awarding winnings. Please contact an admin.' });
            }
        }

        // 5. Get new balance
        const { data: newData } = await supabase
            .from(h.tables.GAMES_WORDLE)
            .select('ticket_count')
            .eq('discord_id', userId)
            .maybeSingle();
        const newBalance = newData?.ticket_count || 0;

        // 6. Build embed
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

        await interaction.editReply({ embeds: [embed] });

        // Optional: brief public log (deleted after 3s)
        try {
            const publicMsg = await interaction.channel.send({ embeds: [embed] });
            setTimeout(() => publicMsg.delete().catch(() => {}), 3000);
        } catch (err) {
            console.error('Failed to send public slots log:', err);
        }
    }
};
