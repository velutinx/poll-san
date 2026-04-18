// This is poll-san/commands/games/slots.js

const { SlashCommandBuilder } = require('discord.js');
const supabase = require('../../services/supabase');

// Define possible items and payouts
const ITEMS = ['🍒', '🍇', '🍊', '🍋', '💎'];
const PAYOUTS = { 3: 3, 2: 1.5 }; // 3x for three of a kind, 1.5x for two

module.exports = {
    data: new SlashCommandBuilder()
        .setName('slots')
        .setDescription('Spin the slot machine!')
        .addIntegerOption(option => 
            option.setName('bet')
                .setDescription('Number of tickets to bet')
                .setRequired(true)
                .setMinValue(1)),

    async execute(interaction) {
        const bet = interaction.options.getInteger('bet');
        
        // 1. Check if user has enough tickets (query your games_wordle table)
        // ...
        
        // 2. Generate slot result
        const slot1 = ITEMS[Math.floor(Math.random() * ITEMS.length)];
        const slot2 = ITEMS[Math.floor(Math.random() * ITEMS.length)];
        const slot3 = ITEMS[Math.floor(Math.random() * ITEMS.length)];
        
        // 3. Determine win/loss
        let winAmount = 0;
        if (slot1 === slot2 && slot2 === slot3) {
            winAmount = bet * PAYOUTS[3];
        } else if (slot1 === slot2 || slot2 === slot3 || slot1 === slot3) {
            winAmount = bet * PAYOUTS[2];
        }
        
        // 4. Update user's ticket count in Supabase
        // ...
        
        // 5. Reply with the result
        const resultMessage = `${slot1} | ${slot2} | ${slot3}\n` +
            (winAmount > 0 ? `🎉 You won ${winAmount} tickets!` : `😢 You lost ${bet} tickets.`);
        await interaction.reply(resultMessage);
    }
};
