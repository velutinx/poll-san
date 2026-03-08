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

      // Tables to clear (excluding discord_votes so votes stay for history)
      const tables = [
        'poll_result',
        'active_polls',
        'poll_options',
        'poll_winners'
        // 'discord_votes'  ← commented out = votes preserved (as you wanted manual clear)
      ];

      const pollId = 'character_poll_new';
      let clearedCount = 0;

      for (const table of tables) {
        try {
          const url = `${SUPABASE_URL}/rest/v1/${table}?poll_id=eq.${pollId}`;

          const res = await fetch(url, {
            method: 'DELETE',
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              Prefer: 'return=minimal'
            }
          });

          if (res.ok) {
            console.log(`✅ Cleared table ${table} for poll ${pollId}`);
            clearedCount++;
          } else {
            const errorText = await res.text();
            console.error(`Failed to clear ${table}: ${res.status} – ${errorText}`);
          }
        } catch (err) {
          console.error(`Exception while clearing ${table}:`, err);
        }
      }

      await interaction.editReply({
        content: `✅ Poll stopped.\nCleared ${clearedCount}/${tables.length} tables successfully.\n(Votes in discord_votes preserved – clear manually if needed.)`
      });

    } catch (err) {
      console.error('POLLSTOP CRITICAL ERROR:', err);
      await interaction.editReply({
        content: '❌ Failed to stop poll or clear tables. Check bot logs.'
      });
    }
  }
};
