// This is poll-san/commands/tickets/balance.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const supabase = require('../../services/supabase');
const h = require('../../utils/helpers');  // 👈 import helpers

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tickets')
        .setDescription('Check your ticket balance'),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const { data, error } = await supabase
            .from(h.tables.GAMES_WORDLE)   // 👈 changed from 'games_wordle'
            .select('ticket_count, last_win_at')
            .eq('discord_id', interaction.user.id)
            .maybeSingle();

        if (error) {
            console.error('Balance fetch error:', error);
            return interaction.editReply('❌ Error fetching your tickets.');
        }

        const count = data?.ticket_count || 0;
        const lastWin = data?.last_win_at 
            ? `<t:${Math.floor(new Date(data.last_win_at).getTime() / 1000)}:R>` 
            : 'Never';

        await interaction.editReply({
            content: `🎟️ **Your Tickets:** ${count}\n📅 Last win: ${lastWin}`,
            flags: MessageFlags.Ephemeral
        });
    }
};
