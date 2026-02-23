// commands/pollstop.js
const { SlashCommandBuilder } = require('discord.js');
const pollManager = require('../pollManager');

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '') || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pollstop')
    .setDescription('Stop the current poll and clear most related Supabase tables (Owner only) — votes cleared manually')
    .setDMPermission(false),

  async execute(interaction) {
    try {
      const OWNER_ID = '1380051214766444617';

      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({
          content: '❌ You are not allowed to stop polls.',
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const stopped = await pollManager.stopPoll();

      if (!stopped) {
        return interaction.editReply({
          content: '⚠️ No active poll to stop.'
        });
      }

      // Clear all related tables EXCEPT votes
      const tableFilters = [
        { table: 'poll_result',    filter: 'poll_id=neq.invalid' },
        { table: 'active_polls',   filter: 'poll_id=neq.invalid' },
        { table: 'discord_votes',  filter: 'poll_id=neq.invalid' },
        { table: 'poll_options',   filter: 'poll_id=neq.invalid' },
        { table: 'poll_winners',   filter: 'poll_id=neq.invalid' }
        // votes intentionally excluded — clear manually in Supabase
      ];

      for (const { table, filter } of tableFilters) {
        try {
          const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}`;
          const res = await fetch(url, {
            method: 'DELETE',
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`
            }
          });

          if (res.ok) {
            console.log(`Successfully cleared table ${table}`);
          } else {
            const text = await res.text();
            console.error(`Failed to clear table ${table}: ${res.status} - ${text}`);
          }
        } catch (err) {
          console.error(`Error clearing table ${table}:`, err);
        }
      }

      await interaction.editReply({
        content: '✅ Poll stopped and most Supabase tables cleared (votes must be cleared manually).'
      });

    } catch (err) {
      console.error('POLLSTOP ERROR:', err);
      await interaction.editReply({
        content: '❌ An error occurred while stopping the poll.'
      });
    }
  }
};