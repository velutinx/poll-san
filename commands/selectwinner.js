// commands/selectwinner.js
const { SlashCommandBuilder } = require('discord.js');
const pollManager = require('../pollManager');

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '') || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('selectwinner')
    .setDescription('Mark a character as poll winner (Owner only)')
    .setDMPermission(false)
    .addIntegerOption(option =>
      option.setName('number')
        .setDescription('The number 1–12 of the winner')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(12)
    ),

  async execute(interaction) {
    const OWNER_ID = '1380051214766444617';

    // ────────────────────────────────────────────────
    //        VERY EARLY DEFER — prevents "not responding"
    // ────────────────────────────────────────────────
    try {
      await interaction.deferReply({ ephemeral: true });
      console.log(`[selectwinner] Deferred reply for user ${interaction.user.id} #${interaction.options.getInteger('number')}`);
    } catch (deferErr) {
      console.error('[selectwinner] Failed to defer:', deferErr);
      // If defer fails, we can't reply anymore — just log and exit
      return;
    }

    // Only owner can proceed
    if (interaction.user.id !== OWNER_ID) {
      return interaction.editReply({
        content: '❌ You are not allowed to select winners.'
      });
    }

    try {
      if (!pollManager.activePoll || !pollManager.activePoll.message) {
        return interaction.editReply({ content: '⚠️ No active poll.' });
      }

      const winnerNumber = interaction.options.getInteger('number');
      const { message, characters } = pollManager.activePoll;

      console.log(`[selectwinner] Processing winner #${winnerNumber}`);

      // Fetch thread — can sometimes hang → do it after defer
      let thread = null;
      try {
        thread = message.hasThread ? await message.thread.fetch() : null;
      } catch (threadErr) {
        console.warn('[selectwinner] Thread fetch failed:', threadErr.message);
        // Continue anyway — thread is optional for announcement
      }

      if (!thread) {
        console.log('[selectwinner] No thread available — will skip announcement post');
      }

      // ────────────────────────────────────────────────
      // Heavy part — only do this AFTER we already deferred
      // ────────────────────────────────────────────────
      console.log('[selectwinner] Starting calculateCounts...');
      const counts = await pollManager.calculateCounts(message).catch(err => {
        console.error('[selectwinner] calculateCounts failed:', err);
        return new Array(12).fill(0); // fallback so we don't crash
      });
      console.log('[selectwinner] calculateCounts completed');

      // Format date: "Feb 20, 04:36 PM"
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const formattedNow = `${dateStr}, ${timeStr}`;

      let resultText = `📊 Current Results (${formattedNow})\n\n`;

      // Use in-memory winners (add current one immediately)
      if (!pollManager.activePoll.winners) {
        pollManager.activePoll.winners = new Set();
      }
      pollManager.activePoll.winners.add(winnerNumber);

      for (let i = 0; i < characters.length; i++) {
        const line = `${pollManager.NUMBER_EMOJIS[i]} = ${counts[i].toFixed(1)} -- ${characters[i]}`;
        const isWinner = pollManager.activePoll.winners.has(i + 1);
        resultText += isWinner ? `||${line}||\n` : `${line}\n`;
      }

      const winnerName = characters[winnerNumber - 1] || `Option ${winnerNumber}`;
      const announcement = `**${winnerName} has been marked as a poll winner! 🎉**\n\n${resultText}`;

      // Post to thread if available
      if (thread) {
        try {
          await thread.send(announcement);
          console.log(`[selectwinner] Announcement sent to thread ${thread.id}`);
        } catch (postErr) {
          console.error('[selectwinner] Failed to post to thread:', postErr);
        }
      }

      // ────────────────────────────────────────────────
      // Update database
      // ────────────────────────────────────────────────
      const pollId = 'character_poll_new';
      const optionId = winnerNumber;
      const selectedAt = new Date().toISOString();

      console.log(`[selectwinner] Marking winner: poll_id=${pollId}, option_id=${optionId}`);

      // 1. Update poll_result.selected_at
      try {
        const updateRes = await fetch(
          `${SUPABASE_URL}/rest/v1/poll_result?poll_id=eq.${pollId}&option_id=eq.${optionId}`,
          {
            method: 'PATCH',
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal'
            },
            body: JSON.stringify({ selected_at: selectedAt })
          }
        );

        if (!updateRes.ok) {
          const errorText = await updateRes.text();
          console.error(`[selectwinner] poll_result update failed: ${updateRes.status} - ${errorText}`);
        } else {
          console.log(`[selectwinner] Updated poll_result.selected_at for option ${optionId}`);
        }
      } catch (dbErr) {
        console.error('[selectwinner] poll_result PATCH error:', dbErr);
      }

      // 2. Insert into poll_winners
      try {
        const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/poll_winners`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates'
          },
          body: JSON.stringify({
            poll_id: pollId,
            option_id: optionId,
            selected_at: selectedAt
          })
        });

        if (!insertRes.ok) {
          const errorText = await insertRes.text();
          console.error(`[selectwinner] poll_winners insert failed: ${insertRes.status} - ${errorText}`);
        } else {
          console.log(`[selectwinner] Inserted into poll_winners for option ${optionId}`);
        }
      } catch (dbErr) {
        console.error('[selectwinner] poll_winners POST error:', dbErr);
      }

      // ────────────────────────────────────────────────
      // Final success message
      // ────────────────────────────────────────────────
      await interaction.editReply({
        content: `✅ Winner #${winnerNumber} (${winnerName}) marked!` +
                 (thread ? ' Announcement posted in thread.' : ' (no thread found)')
      });

    } catch (err) {
      console.error('SELECTWINNER CRASH:', err);
      await interaction.editReply({
        content: '❌ Failed to select winner. Check bot logs for details.'
      }).catch(editErr => {
        console.error('[selectwinner] Final editReply also failed:', editErr);
      });
    }
  }
};
