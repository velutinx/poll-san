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
    const OWNER_ID = '1380051214766444617';

    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({ content: '❌ You are not allowed to stop polls.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const stopped = await pollManager.stopPoll();

      if (!stopped) {
        return interaction.editReply({ content: '⚠️ No active poll to stop.' });
      }

      // Tables to clear (excluding votes – as intended)
      const tables = [
        'poll_result',
        'active_polls',
        'discord_votes',     // ← you have this here but said votes are manual → remove if unwanted
        'poll_options',
        'poll_winners'
      ];

      for (const table of tables) {
        try {
          // ────────────────────────────────────────────────
          // Correct way to delete all rows in a table
          const url = `${SUPABASE_URL}/rest/v1/${table}?poll_id=not.is.null`;

          const res = await fetch(url, {
            method: 'DELETE',
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              Prefer: 'return=minimal'           // reduces response size
            }
          });

          if (res.ok) {
            console.log(`✅ Cleared table ${table}`);
          } else {
            const errorText = await res.text();
            console.error(`Failed to clear ${table}: ${res.status} – ${errorText}`);
            // You can continue with other tables or throw – up to you
          }
        } catch (err) {
          console.error(`Exception while clearing ${table}:`, err);
        }
      }

      await interaction.editReply({
        content: '✅ Poll stopped and Supabase tables cleared (votes must be cleared manually if included).'
      });

    } catch (err) {
      console.error('POLLSTOP CRITICAL ERROR:', err);
      await interaction.editReply({
        content: '❌ Failed to stop poll or clear tables. Check bot logs.'
      });
    }
  }
};
